import core = require('@actions/core');
import exec = require('@actions/exec');
import glob = require('@actions/glob');
import plist = require('plist');
import path = require('path');
import fs = require('fs');

import { AppleCredential } from './credentials';

const xcodebuild = 'xcodebuild';
const WORKSPACE = process.env.GITHUB_WORKSPACE || process.cwd();

async function GetProjectDetails(): Promise<XcodeProject> {
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
    return new XcodeProject(projectPath, projectName, projectDirectory);
}

async function ArchiveXcodeProject(projectRef: XcodeProject): Promise<XcodeProject> {
    const { projectPath, projectName, projectDirectory } = projectRef;
    const archivePath = `${projectDirectory}/${projectName}.xcarchive`;
    core.debug(`Archive path: ${archivePath}`);
    let schemeListOutput = '';
    if (!core.isDebug()) {
        core.info(`[command]xcodebuild -list -project ${projectPath} -json`);
    }
    await exec.exec(xcodebuild, [
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
        await exec.exec(xcodebuild, [
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
        projectRef.platform = platform;
    }
    core.debug(`Using destination: ${destination}`);
    const configuration = core.getInput('configuration') || 'Release';
    core.debug(`Configuration: ${configuration}`);
    const archiveArgs = [
        'archive',
        '-project', projectPath,
        '-scheme', scheme,
        '-destination', destination,
        '-configuration', configuration,
        '-archivePath', archivePath,
        '-allowProvisioningUpdates',
        `-authenticationKeyID`, projectRef.credential.appStoreConnectKeyId,
        `-authenticationKeyPath`, projectRef.credential.appStoreConnectKeyPath,
        `-authenticationKeyIssuerID`, projectRef.credential.appStoreConnectIssuerId,
        `OTHER_CODE_SIGN_FLAGS=--keychain ${projectRef.credential.keychainPath}`
    ];
    const teamId = core.getInput('team-id');
    if (teamId) {
        archiveArgs.push(`DEVELOPMENT_TEAM=${teamId}`);
    }
    if (!core.isDebug()) {
        archiveArgs.push('-quiet');
    }
    await exec.exec(xcodebuild, archiveArgs);
    projectRef.archivePath = archivePath
    return projectRef;
}

async function ExportXcodeArchive(projectRef: XcodeProject): Promise<XcodeProject> {
    const { projectPath, projectName, projectDirectory, archivePath } = projectRef;
    const exportPath = `${projectDirectory}/${projectName}`;
    core.debug(`Export path: ${exportPath}`);
    const exportOptionPlistInput = core.getInput('export-option-plist');
    let exportOptionsPath = undefined;
    if (!exportOptionPlistInput) {
        exportOptionsPath = await writeExportOptions(projectPath);
    } else {
        exportOptionsPath = exportOptionPlistInput;
    }
    core.debug(`Export options path: ${exportOptionsPath}`);
    if (!exportOptionsPath) {
        throw new Error(`Invalid path for export-option-plist: ${exportOptionsPath}`);
    }
    const fileHandle = await fs.promises.open(exportOptionsPath, 'r');
    try {
        const exportOptionContent = await fs.promises.readFile(fileHandle, 'utf8');
        core.debug(`----- Export options content: -----\n${exportOptionContent}\n---------------------------------`);
    } finally {
        await fileHandle.close();
    }
    const exportArgs = [
        '-exportArchive',
        '-archivePath', archivePath,
        '-exportPath', exportPath,
        '-exportOptionsPlist', exportOptionsPath,
        '-allowProvisioningUpdates'
    ];
    if (!core.isDebug()) {
        exportArgs.push('-quiet');
    }
    await exec.exec(xcodebuild, exportArgs);
    projectRef.exportPath = exportPath;
    return projectRef;
}

async function writeExportOptions(projectPath: string): Promise<string> {
    const exportOption = core.getInput('export-option');
    const exportOptions = {
        method: exportOption
    };
    const exportOptionsPath = `${projectPath}/exportOptions.plist`;
    await fs.promises.writeFile(exportOptionsPath, plist.build(exportOptions));
    return exportOptionsPath;
}

class XcodeProject {
    constructor(projectPath: string, projectName: string, projectDirectory: string) {
        this.projectPath = projectPath;
        this.projectName = projectName;
        this.projectDirectory = projectDirectory;
    }
    projectPath: string;
    projectName: string;
    projectDirectory: string;
    credential: AppleCredential;
    platform: string;
    archivePath: string;
    exportPath: string;
}

export {
    GetProjectDetails,
    ArchiveXcodeProject,
    ExportXcodeArchive,
    XcodeProject
}
