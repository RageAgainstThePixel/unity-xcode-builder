import core = require('@actions/core');
import { ImportCredentials, Cleanup } from './credentials';
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
            const { projectPath, projectDirectory, projectName } = await GetProjectDetails();
            const archive = await ArchiveXcodeProject(projectPath, projectDirectory, projectName, credential);
            core.setOutput('archive', archive);
            const exportPath = await ExportXcodeArchive(projectPath, projectDirectory, projectName, archive);
            core.setOutput('export-path', exportPath);
        } else {
            await Cleanup();
        }
    } catch (error) {
        core.setFailed(error.stack);
    }
}

main();
