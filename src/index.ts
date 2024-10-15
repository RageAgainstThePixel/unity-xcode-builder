import core = require('@actions/core');
import exec = require('@actions/exec');
import {
    GetProjectDetails,
    ArchiveXcodeProject,
    ExportXcodeArchive,
    ValidateApp,
    UploadApp
} from './xcode';
import {
    ImportCredentials,
    RemoveCredentials
} from './AppleCredential';

const IS_POST = !!core.getState('isPost');

const main = async () => {
    try {
        if (!IS_POST) {
            core.saveState('isPost', true);
            let xcodeVersion = core.getInput('xcode-version');
            if (xcodeVersion) {
                core.info(`Setting xcode version to ${xcodeVersion}`);
                await exec.exec('sudo', ['xcode-select', '-s', `/Applications/Xcode_${xcodeVersion}.app/Contents/Developer`]);
            }
            let xcodeVersionOutput = '';
            await exec.exec('xcodebuild', ['-version'], {
                listeners: {
                    stdout: (data: Buffer) => {
                        xcodeVersionOutput += data.toString();
                    }
                }
            });
            const xcodeVersionMatch = xcodeVersionOutput.match(/Xcode (?<version>\d+\.\d+)/);
            if (!xcodeVersionMatch) {
                throw new Error('Failed to get Xcode version!');
            }
            xcodeVersion = xcodeVersionMatch.groups.version;
            core.saveState('xcode-version', xcodeVersion);
            const credential = await ImportCredentials();
            let projectRef = await GetProjectDetails();
            projectRef.credential = credential;
            projectRef = await ArchiveXcodeProject(projectRef);
            projectRef = await ExportXcodeArchive(projectRef);
            await ValidateApp(projectRef);
            const upload = core.getInput('upload') === 'true' && projectRef.isAppStoreUpload();
            core.info(`uploadInput: ${upload}`);
            if (upload) {
                await UploadApp(projectRef);
            }
        } else {
            await RemoveCredentials();
        }
    } catch (error) {
        core.setFailed(error.stack);
    }
}

main();
