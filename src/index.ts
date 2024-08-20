import core = require('@actions/core');
import { ImportCertificate, RemoveCertificate } from './certificates';
import { ArchiveXcodeProject } from './xcode';

const IS_POST = !!core.getState('isPost');

const main = async () => {
    try {
        if (!IS_POST) {
            core.saveState('isPost', true);
            await ImportCertificate();
            const archive = await ArchiveXcodeProject();
            core.setOutput('archive', archive);
        } else {
            await RemoveCertificate();
        }
    } catch (error) {
        core.setFailed(error.stack);
    }
}

main();
