import core = require('@actions/core');
import { ImportCredentials, Cleanup } from './credentials';
import { ArchiveXcodeProject } from './xcode';

const IS_POST = !!core.getState('isPost');

const main = async () => {
    try {
        if (!IS_POST) {
            core.saveState('isPost', true);
            const credential = await ImportCredentials();
            const archive = await ArchiveXcodeProject(credential);
            core.setOutput('archive', archive);
        } else {
            await Cleanup();
        }
    } catch (error) {
        core.setFailed(error.stack);
    }
}

main();
