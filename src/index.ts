import core = require('@actions/core');
import {
    ImportCredentials,
    Cleanup
} from './credentials';
import {
    GetProjectDetails,
    ArchiveXcodeProject,
    ExportXcodeArchive
} from './xcode';

const IS_POST = !!core.getState('isPost');

const main = async () => {
    try {
        if (!IS_POST) {
            core.saveState('isPost', true);
            const credential = await ImportCredentials();
            let projectRef = await GetProjectDetails();
            projectRef.credential = credential;
            projectRef = await ArchiveXcodeProject(projectRef);
            core.setOutput('archive', projectRef.archivePath);
            projectRef = await ExportXcodeArchive(projectRef);
            core.setOutput('export-path', projectRef.exportPath);
        } else {
            await Cleanup();
        }
    } catch (error) {
        core.setFailed(error.stack);
    }
}

main();
