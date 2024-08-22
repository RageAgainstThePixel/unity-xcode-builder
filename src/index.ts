import core = require('@actions/core');
import { ImportCredentials, Cleanup } from './credentials';
import { ArchiveXcodeProject } from './xcode';

const IS_POST = !!core.getState('isPost');

const main = async () => {
    try {
        if (!IS_POST) {
            core.saveState('isPost', true);
            await ImportCredentials();
            const archive = await ArchiveXcodeProject();
            core.setOutput('archive', archive);
        } else {
            await Cleanup();
        }
    } catch (error) {
        core.setFailed(error.stack);
    }
}

main();
