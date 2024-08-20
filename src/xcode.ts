import core = require('@actions/core');
import exec = require('@actions/exec');
import glob = require('@actions/glob');
import path = require('path');
import fs = require('fs');

const WORKSPACE = process.env.GITHUB_WORKSPACE || process.cwd();

async function ArchiveXcodeProject(): Promise<string> {
    const projectPathInput = core.getInput('project-path') || `${WORKSPACE}/**/*.xcodeproj`;
    core.info(`Project path input: ${projectPathInput}`);
    let projectPath = undefined;
    const globber = await glob.create(projectPathInput);
    const files = await globber.glob();
    for (const file of files) {
        if (file.endsWith('.xcodeproj')) {
            core.info(`Found Xcode project: ${file}`);
            projectPath = file;
            break;
        }
    }
    if (!projectPath) {
        throw new Error('Invalid project-path! Unable to find .xcodeproj');
    }
    core.info(`Resolved Project path: ${projectPath}`);
    await fs.promises.access(projectPath, fs.constants.R_OK);
    const projectDirectory = path.dirname(projectPath);
    core.info(`Project directory: ${projectDirectory}`);
    const projectName = path.basename(projectPath, '.xcodeproj');
    core.info(`Archiving Xcode project: ${projectName}`);
    const archivePath = `${projectDirectory}/${projectName}.xcarchive`;
    core.info(`Archive path: ${archivePath}`);
    const scheme = core.getInput('scheme') || `${projectDirectory}/${projectName}.xcodeproj/xcshareddata/xcschemes/*.xcscheme`;
    core.info(`Scheme input: ${scheme}`);
    let schemePath = undefined;
    const schemeGlobber = await glob.create(scheme);
    const schemeFiles = await schemeGlobber.glob();
    for (const file of schemeFiles) {
        if (file.endsWith('.xcscheme')) {
            core.info(`Found Xcode scheme: ${file}`);
            schemePath = file;
            break;
        }
    }
    core.info(`Scheme path: ${schemePath}`);
    await fs.promises.access(schemePath, fs.constants.R_OK);
    const configuration = core.getInput('configuration') || 'Release';
    core.info(`Configuration: ${configuration}`);
    await exec.exec('xcodebuild', [
        '-project', projectPath,
        '-scheme', schemePath,
        '-configuration', configuration,
        '-archivePath', archivePath,
        '-allowProvisioningUpdates'
    ]);
    return archivePath;
}

export { ArchiveXcodeProject }
