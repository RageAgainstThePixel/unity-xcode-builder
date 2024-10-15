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
import { SemVer } from 'semver';

const IS_POST = !!core.getState('isPost');

const main = async () => {
    try {
        if (!IS_POST) {
            core.saveState('isPost', true);
            let xcodeVersionString = core.getInput('xcode-version');
            if (xcodeVersionString) {
                core.info(`Setting xcode version to ${xcodeVersionString}`);
                await exec.exec('sudo', ['xcode-select', '-s', `/Applications/Xcode_${xcodeVersionString}.app/Contents/Developer`]);
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
            xcodeVersionString = xcodeVersionMatch.groups.version;
            if (!xcodeVersionString) {
                throw new Error('Failed to prase Xcode version!');
            }
            const credential = await ImportCredentials();
            let projectRef = await GetProjectDetails();
            projectRef.credential = credential;
            projectRef.xcodeVersion = new SemVer(xcodeVersionString, { loose: true });
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
