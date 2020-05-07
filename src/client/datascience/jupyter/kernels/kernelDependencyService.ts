// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { CancellationToken } from 'vscode';
import { IApplicationShell } from '../../../common/application/types';
import { createPromiseFromCancellation, wrapCancellationTokens } from '../../../common/cancellation';
import { InstallationChannelManager } from '../../../common/installer/channelManager';
import { ProductNames } from '../../../common/installer/productNames';
import { IInstallationChannelManager, IModuleInstaller } from '../../../common/installer/types';
import { IInstaller, InstallerResponse, Product } from '../../../common/types';
import { DataScience } from '../../../common/utils/localize';
import { PythonInterpreter } from '../../../interpreter/contracts';
import { IKernelDependencyService, KernelInterpreterDependencyResponse } from '../../types';

/**
 * Responsible for managing dependencies of a Python interpreter required to run as a Jupyter Kernel.
 * If required modules aren't installed, will prompt user to install them.
 */
@injectable()
export class KernelDependencyService implements IKernelDependencyService {
    constructor(
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IInstaller) private readonly installer: IInstaller,
        @inject(IInstallationChannelManager) private readonly channelManager: InstallationChannelManager
    ) {}
    /**
     * Configures the python interpreter to ensure it can run a Jupyter Kernel by installing any missing dependencies.
     * If user opts not to install they can opt to select another interpreter.
     */
    public async installMissingDependencies(
        interpreter: PythonInterpreter,
        token?: CancellationToken
    ): Promise<KernelInterpreterDependencyResponse> {
        if (await this.areDependenciesInstalled(interpreter, token)) {
            return KernelInterpreterDependencyResponse.ok;
        }

        const promptCancellationPromise = createPromiseFromCancellation({
            cancelAction: 'resolve',
            defaultValue: undefined,
            token
        });
        const message = DataScience.libraryRequiredToLaunchJupyterKernelNotInstalledInterpreter().format(
            interpreter.displayName || interpreter.envName || interpreter.path,
            ProductNames.get(Product.ipykernel)!
        );
        const installerToken = wrapCancellationTokens(token);

        const channels = await this.channelManager.getInstallationChannels();
        const selection = await Promise.race([
            this.appShell.showErrorMessage(message, ...channels.map((installer) => installer.displayName)),
            promptCancellationPromise
        ]);
        if (installerToken.isCancellationRequested) {
            return KernelInterpreterDependencyResponse.cancel;
        }

        if (selection) {
            const installerModule: IModuleInstaller | undefined = channels.find((v) => v.displayName === selection);
            const cancellatonPromise = createPromiseFromCancellation({
                cancelAction: 'resolve',
                defaultValue: InstallerResponse.Ignore,
                token
            });
            // Always pass a cancellation token to `install`, to ensure it waits until the module is installed.
            const response = await Promise.race([
                this.installer.install(Product.ipykernel, interpreter, installerToken, installerModule),
                cancellatonPromise
            ]);
            if (response === InstallerResponse.Installed) {
                return KernelInterpreterDependencyResponse.ok;
            }
        }
        return KernelInterpreterDependencyResponse.cancel;
    }
    public areDependenciesInstalled(interpreter: PythonInterpreter, _token?: CancellationToken): Promise<boolean> {
        return this.installer.isInstalled(Product.ipykernel, interpreter).then((installed) => installed === true);
    }
}
