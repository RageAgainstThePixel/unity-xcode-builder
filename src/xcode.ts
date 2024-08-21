import core = require('@actions/core');
import exec = require('@actions/exec');
import glob = require('@actions/glob');
import path = require('path');
import fs = require('fs');

const xcodebuild = 'xcodebuild';
const WORKSPACE = process.env.GITHUB_WORKSPACE || process.cwd();

async function ArchiveXcodeProject(): Promise<string> {
    const projectPathInput = core.getInput('project-path') || `${WORKSPACE}/**/*.xcodeproj`;
    core.info(`Project path input: ${projectPathInput}`);
    let projectPath = undefined;
    const globber = await glob.create(projectPathInput);
    const files = await globber.glob();
    for (const file of files) {
        if (file.endsWith(`GameAssembly.xcodeproj`)) { continue; }
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
    let schemeListOutput = '';
    await exec.exec(xcodebuild, ['-list', '-project', projectPath], {
        listeners: {
            stdout: (data: Buffer) => {
                schemeListOutput += data.toString();
            }
        }
    });
    const schemeMatch = schemeListOutput.match(/Schemes:\n([\s\S]*?)\n\n/);
    if (!schemeMatch) {
        throw new Error('Unable to list schemes for the project');
    }
    const schemes = schemeMatch[1].split('\n').map(s => s.trim()).filter(s => s);
    core.info(`Available schemes: ${schemes.join(', ')}`);
    let scheme = core.getInput('scheme');
    if (!scheme) {
        if (schemes.includes('Unity-iPhone')) {
            scheme = 'Unity-iPhone';
        } else {
            scheme = schemes.find(s => !['GameAssembly', 'UnityFramework', 'Pods'].includes(s) && !s.includes('Test'));
        }
    }
    core.info(`Using scheme: ${scheme}`);
    const configuration = core.getInput('configuration') || 'Release';
    core.info(`Configuration: ${configuration}`);
    await exec.exec(xcodebuild, [
        '-project', projectPath,
        '-scheme', scheme,
        '-configuration', configuration,
        '-archivePath', archivePath,
        '-allowProvisioningUpdates'
    ]);
    return archivePath;
}

export { ArchiveXcodeProject }