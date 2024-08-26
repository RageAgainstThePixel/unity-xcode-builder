import core = require('@actions/core');
import exec = require('@actions/exec');
import glob = require('@actions/glob');
import plist = require('plist');
import path = require('path');
import fs = require('fs');

import { AppleCredential } from './credentials';

const xcodebuild = '/usr/bin/xcodebuild';
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
    let projectInfoOutput = '';
    if (!core.isDebug()) {
        core.info(`[command]${xcodebuild} -list -project ${projectPath} -json`);
    }
    await exec.exec(xcodebuild, [
        '-list',
        '-project', projectPath,
        `-json`
    ], {
        listeners: {
            stdout: (data: Buffer) => {
                projectInfoOutput += data.toString();
            }
        },
        silent: !core.isDebug()
    });
    const projectInfo = JSON.parse(projectInfoOutput);
    const schemes = projectInfo.project.schemes as string[];
    if (!schemes) {
        throw new Error('No schemes found in the project');
    }
    core.debug(`Available schemes:`);
    schemes.forEach(s => core.debug(`  > ${s}`));
    let scheme = core.getInput('scheme');
    if (!scheme) {
        if (schemes.includes('Unity-iPhone')) {
            scheme = 'Unity-iPhone';
        } else {
            scheme = schemes.find(s => !['GameAssembly', 'UnityFramework', 'Pods'].includes(s) && !s.includes('Test'));
        }
    }
    core.debug(`Using scheme: ${scheme}`);
    let platform = core.getInput('platform') || await determinePlatform(projectPath, scheme);
    if (!platform) {
        throw new Error('Unable to determine the platform to build for.');
    }
    core.debug(`Platform: ${platform}`);
    projectRef.platform = platform;
    let destination = core.getInput('destination') || `generic/platform=${platform}`;
    core.debug(`Using destination: ${destination}`);
    const configuration = core.getInput('configuration') || 'Release';
    core.debug(`Configuration: ${configuration}`);
    let entitlementsPath = core.getInput('entitlements-plist');
    if (!entitlementsPath && platform === 'macOS') {
        entitlementsPath = await getDefaultEntitlementsMacOS(projectDirectory)
    }
    const archiveArgs = [
        'archive',
        '-project', projectPath,
        '-scheme', scheme,
        '-destination', destination,
        '-configuration', configuration,
        '-archivePath', archivePath,
        `-authenticationKeyID`, projectRef.credential.appStoreConnectKeyId,
        `-authenticationKeyPath`, projectRef.credential.appStoreConnectKeyPath,
        `-authenticationKeyIssuerID`, projectRef.credential.appStoreConnectIssuerId,
    ];
    const { teamId, signingIdentity, provisioningProfileUUID, keychainPath } = projectRef.credential;
    if (teamId) {
        archiveArgs.push(`DEVELOPMENT_TEAM=${teamId}`);
    }
    if (signingIdentity) {
        archiveArgs.push(
            `CODE_SIGN_IDENTITY=${signingIdentity}`,
            `OTHER_CODE_SIGN_FLAGS=--keychain ${keychainPath}`
        );
    } else {
        archiveArgs.push(`CODE_SIGN_IDENTITY=-`);
    }
    archiveArgs.push(
        `CODE_SIGN_STYLE=${provisioningProfileUUID || signingIdentity ? 'Manual' : 'Automatic'}`
    );
    if (provisioningProfileUUID) {
        archiveArgs.push(`PROVISIONING_PROFILE=${provisioningProfileUUID}`);
    } else {
        archiveArgs.push(
            // `AD_HOC_CODE_SIGNING_ALLOWED=YES`,
            `-allowProvisioningUpdates`
        );
    }
    if (entitlementsPath) {
        core.debug(`Entitlements path: ${entitlementsPath}`);
        const entitlementsHandle = await fs.promises.open(entitlementsPath, 'r');
        try {
            const entitlementsContent = await fs.promises.readFile(entitlementsHandle, 'utf8');
            core.debug(`----- Entitlements content: -----\n${entitlementsContent}\n---------------------------------`);
        } finally {
            await entitlementsHandle.close();
        }
        archiveArgs.push(`CODE_SIGN_ENTITLEMENTS=${entitlementsPath}`);
    }
    if (!core.isDebug()) {
        archiveArgs.push('-quiet');
    }
    await exec.exec(xcodebuild, archiveArgs);
    projectRef.archivePath = archivePath
    return projectRef;
}

async function determinePlatform(projectPath: string, scheme: string): Promise<string> {
    let buildSettingsOutput = '';
    if (!core.isDebug()) {
        core.info(`[command]${xcodebuild} -project ${projectPath} -scheme ${scheme} -showBuildSettings`);
    }
    await exec.exec(xcodebuild, [
        '-project', projectPath,
        '-scheme', scheme,
        '-showBuildSettings'
    ], {
        listeners: {
            stdout: (data: Buffer) => {
                buildSettingsOutput += data.toString();
            }
        },
        silent: !core.isDebug()
    });
    const match = buildSettingsOutput.match(/\s+PLATFORM_NAME = (?<platformName>\w+)/m);
    core.debug(`$PLATFORM_NAME: ${match?.groups?.platformName}`);
    if (!match) {
        throw new Error('No PLATFORM_NAME found in the build settings');
    }
    const platformName = match.groups?.platformName;
    if (!platformName) {
        throw new Error('Unable to determine the platform name from the build settings');
    }
    const platforms = {
        'iphoneos': 'iOS',
        'macosx': 'macOS',
        'appletvos': 'tvOS',
        'watchos': 'watchOS',
        'xros': 'visionOS'
    };
    return platforms[platformName] || null;
}

async function getDefaultEntitlementsMacOS(projectPath: string): Promise<string> {
    const entitlementsPath = `${projectPath}/Entitlements.plist`;
    try {
        await fs.promises.access(entitlementsPath, fs.constants.R_OK);
        core.info(`Existing Entitlements.plist found at: ${entitlementsPath}`);
        return entitlementsPath;
    } catch (error) {
        core.warning('Entitlements.plist not found, creating default Entitlements.plist...');
    }
    const defaultEntitlements = {
        'com.apple.security.app-sandbox': true,
        'com.apple.security.cs.disable-executable-page-protection': true,
        'com.apple.security.cs.disable-library-validation': true
    };
    await fs.promises.writeFile(entitlementsPath, plist.build(defaultEntitlements));
    return entitlementsPath;
}

async function ExportXcodeArchive(projectRef: XcodeProject): Promise<XcodeProject> {
    const { projectPath, projectName, projectDirectory, archivePath } = projectRef;
    const exportPath = `${projectDirectory}/${projectName}`;
    core.debug(`Export path: ${exportPath}`);
    const exportOptionPlistInput = core.getInput('export-option-plist');
    let exportOptionsPath = undefined;
    if (!exportOptionPlistInput) {
        const exportOption = core.getInput('export-option');
        const exportOptions = {
            method: exportOption,
            signingStyle: projectRef.credential.signingIdentity ? 'manual' : 'automatic',
            teamID: `${projectRef.credential.teamId}`
        };
        if (exportOption === 'app-store') {
            exportOptions['uploadSymbols'] = true;
            exportOptions['manageAppVersionAndBuildNumber'] = true;
        }
        exportOptionsPath = await writeExportOptions(projectPath, exportOptions);
    } else {
        exportOptionsPath = exportOptionPlistInput;
    }
    core.debug(`Export options path: ${exportOptionsPath}`);
    if (!exportOptionsPath) {
        throw new Error(`Invalid path for export-option-plist: ${exportOptionsPath}`);
    }
    const exportOptionsHandle = await fs.promises.open(exportOptionsPath, 'r');
    try {
        const exportOptionContent = await fs.promises.readFile(exportOptionsHandle, 'utf8');
        core.debug(`----- Export options content: -----\n${exportOptionContent}\n---------------------------------`);
    } finally {
        await exportOptionsHandle.close();
    }
    const exportArgs = [
        '-exportArchive',
        '-archivePath', archivePath,
        '-exportPath', exportPath,
        '-exportOptionsPlist', exportOptionsPath,
        '-allowProvisioningUpdates',
        `-authenticationKeyID`, projectRef.credential.appStoreConnectKeyId,
        `-authenticationKeyPath`, projectRef.credential.appStoreConnectKeyPath,
        `-authenticationKeyIssuerID`, projectRef.credential.appStoreConnectIssuerId
    ];
    if (!core.isDebug()) {
        exportArgs.push('-quiet');
    }
    await exec.exec(xcodebuild, exportArgs);
    projectRef.exportPath = exportPath;
    return projectRef;
}

async function writeExportOptions(projectPath: string, exportOptions: any): Promise<string> {
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
