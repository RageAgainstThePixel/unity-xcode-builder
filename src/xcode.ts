import core = require('@actions/core');
import exec = require('@actions/exec');
import glob = require('@actions/glob');
import path = require('path');
import fs = require('fs');

const temp = process.env['RUNNER_TEMP'] || '.';
const WORKSPACE = process.env.GITHUB_WORKSPACE || process.cwd();

async function ArchiveXcodeProject(credential: string): Promise<string> {
    const projectPathInput = core.getInput('project-path') || `${WORKSPACE}/**/*.xcodeproj`;
    core.debug(`Project path input: ${projectPathInput}`);
    let projectPath = undefined;
    const globber = await glob.create(projectPathInput);
    const files = await globber.glob();
    for (const file of files) {
        if (file.endsWith(`GameAssembly.xcodeproj`)) { continue; }
        if (file.endsWith('.xcodeproj')) {
            core.debug(`Found Xcode project: ${file}`);
            projectPath = file;
            break;
        }
    }
    if (!projectPath) {
        throw new Error('Invalid project-path! Unable to find .xcodeproj');
    }
    core.debug(`Resolved Project path: ${projectPath}`);
    await fs.promises.access(projectPath, fs.constants.R_OK);
    const projectDirectory = path.dirname(projectPath);
    core.debug(`Project directory: ${projectDirectory}`);
    const projectName = path.basename(projectPath, '.xcodeproj');
    const archivePath = `${projectDirectory}/${projectName}.xcarchive`;
    core.debug(`Archive path: ${archivePath}`);
    let schemeListOutput = '';
    if (!core.isDebug()) {
        core.info(`[command]xcodebuild -list -project ${projectPath} -json`);
    }
    await exec.exec('xcodebuild', [
        '-list',
        '-project', projectPath,
        `-json`
    ], {
        listeners: {
            stdout: (data: Buffer) => {
                schemeListOutput += data.toString();
            }
        },
        silent: !core.isDebug()
    });
    const schemeList = JSON.parse(schemeListOutput);
    const schemes = schemeList.project.schemes as string[];
    if (!schemes) {
        throw new Error('No schemes found in the project');
    }
    core.info(`Available schemes:`);
    schemes.forEach(s => core.info(`  > ${s}`));
    let scheme = core.getInput('scheme');
    if (!scheme) {
        if (schemes.includes('Unity-iPhone')) {
            scheme = 'Unity-iPhone';
        } else {
            scheme = schemes.find(s => !['GameAssembly', 'UnityFramework', 'Pods'].includes(s) && !s.includes('Test'));
        }
    }
    core.debug(`Using scheme: ${scheme}`);
    let destination = core.getInput('destination');
    if (!destination) {
    let destinationListOutput = '';
        if (!core.isDebug()) {
            core.info(`[command]xcodebuild -project ${projectPath} -scheme ${scheme} -showdestinations`);
        }
    await exec.exec('xcodebuild', [
        `-project`, projectPath,
        '-scheme', scheme,
        '-showdestinations'
    ], {
        listeners: {
            stdout: (data: Buffer) => {
                destinationListOutput += data.toString();
            }
            },
            silent: !core.isDebug()
    });
        const platform = destinationListOutput.match(/platform:([^,]+)/)?.[1]?.trim();
        if (!platform) {
            throw new Error('No platform found in the project');
        }
        core.debug(`Platform: ${platform}`);
        destination = `generic/platform=${platform}`;
    }
    core.debug(`Using destination: ${destination}`);
    const configuration = core.getInput('configuration') || 'Release';
    core.debug(`Configuration: ${configuration}`);
    const keychainPath = `${temp}/${credential}.keychain-db`;
    await fs.promises.access(keychainPath, fs.constants.R_OK);
    const authenticationKeyID = core.getInput('app-store-connect-key-id', { required: true });
    const authenticationKeyIssuerID = core.getInput('app-store-connect-issuer-id', { required: true });
    const appStoreConnectKeyPath = `${temp}/${credential}.p8`;
    await fs.promises.access(appStoreConnectKeyPath, fs.constants.R_OK);
    const archiveArgs = [
        'archive',
        '-project', projectPath,
        '-scheme', scheme,
        '-destination', destination,
        '-configuration', configuration,
        '-archivePath', archivePath,
        '-allowProvisioningUpdates',
        `-authenticationKeyPath`, appStoreConnectKeyPath,
        `-authenticationKeyID`, authenticationKeyID,
        `-authenticationKeyIssuerID`, authenticationKeyIssuerID,
        `OTHER_CODE_SIGN_FLAGS=--keychain ${keychainPath}`
    ];
    if (!core.isDebug()) {
        archiveArgs.push('-quiet');
    }
    await exec.exec('xcodebuild', archiveArgs);
    return archivePath;
}

export { ArchiveXcodeProject }