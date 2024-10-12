import core = require('@actions/core');
import exec = require('@actions/exec');
import {
    GetProjectDetails,
    ArchiveXcodeProject,
    ExportXcodeArchive,
    ValidateApp
} from './xcode';
import {
    UploadTestFlightBuild
} from './AppStoreConnectClient';
import {
    XcodeProject
} from './XcodeProject';
import {
    ImportCredentials,
    RemoveCredentials
} from './AppleCredential';

const IS_POST = !!core.getState('isPost');

const main = async () => {
    try {
        if (!IS_POST) {
            core.saveState('isPost', true);
            const xcodeVersion = core.getInput('xcode-version');
            if (xcodeVersion) {
                core.info(`Setting xcode version to ${xcodeVersion}`);
                await exec.exec('sudo', ['xcode-select', '-s', `/Applications/Xcode_${xcodeVersion}.app/Contents/Developer`]);
            }
            await exec.exec('xcodebuild', ['-version']);
            const credential = await ImportCredentials();
            let projectRef: XcodeProject = await GetProjectDetails();
            projectRef.credential = credential;
            projectRef = await ArchiveXcodeProject(projectRef);
            projectRef = await ExportXcodeArchive(projectRef);
            await ValidateApp(projectRef);
            core.setOutput('output-directory', projectRef.exportPath);
            await UploadTestFlightBuild(projectRef);
        } else {
            await RemoveCredentials();
        }
    } catch (error) {
        core.setFailed(error.stack);
    }
}

main();
