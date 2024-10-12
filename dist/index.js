"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core = require("@actions/core");
const exec = require("@actions/exec");
const xcode_1 = require("./xcode");
const AppStoreConnectClient_1 = require("./AppStoreConnectClient");
const AppleCredential_1 = require("./AppleCredential");
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
            const credential = await (0, AppleCredential_1.ImportCredentials)();
            let projectRef = await (0, xcode_1.GetProjectDetails)();
            projectRef.credential = credential;
            projectRef = await (0, xcode_1.ArchiveXcodeProject)(projectRef);
            projectRef = await (0, xcode_1.ExportXcodeArchive)(projectRef);
            await (0, xcode_1.ValidateApp)(projectRef);
            core.setOutput('output-directory', projectRef.exportPath);
            await (0, AppStoreConnectClient_1.UploadTestFlightBuild)(projectRef);
        }
        else {
            await (0, AppleCredential_1.RemoveCredentials)();
        }
    }
    catch (error) {
        core.setFailed(error.stack);
    }
};
main();
//# sourceMappingURL=index.js.map