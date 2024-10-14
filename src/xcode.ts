import { spawn } from 'child_process';
import core = require('@actions/core');
import exec = require('@actions/exec');
import glob = require('@actions/glob');
import plist = require('plist');
import path = require('path');
import fs = require('fs');
import { XcodeProject } from './XcodeProject';

const xcodebuild = '/usr/bin/xcodebuild';
const xcrun = '/usr/bin/xcrun';
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
    const bundleIdInput = core.getInput('bundle-id');
    let bundleId: string;
    let infoPlistPath = `${projectDirectory}/${projectName}/Info.plist`;
    if (!fs.existsSync(infoPlistPath)) {
        infoPlistPath = `${projectDirectory}/Info.plist`;
    }
    if (!fs.existsSync(infoPlistPath)) {
        throw new Error('Unable to find Info.plist');
    }
    const infoPlistContent = await fs.promises.readFile(infoPlistPath, 'utf8');
    const infoPlist = plist.parse(infoPlistContent);
    if (!bundleIdInput || bundleIdInput === '') {
        bundleId = infoPlist['CFBundleIdentifier'];
    } else {
        bundleId = bundleIdInput;
        if (bundleId !== infoPlist['CFBundleIdentifier']) {
            infoPlist['CFBundleIdentifier'] = bundleId;
            await fs.promises.writeFile(infoPlistPath, plist.build(infoPlist));
        }
    }
    if (!bundleId) {
        throw new Error('Unable to determine bundle identifier from the project');
    }
    return new XcodeProject(projectPath, projectName, bundleId, projectDirectory);
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
            const excludedSchemes = ['GameAssembly', 'UnityFramework', 'Pods'];
            scheme = schemes.find(s => !excludedSchemes.includes(s) && !s.includes('Test'));
        }
    }
    if (!scheme) {
        throw new Error('Unable to determine the scheme to build');
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
    await getExportOptions(projectRef);
    let entitlementsPath = core.getInput('entitlements-plist');
    if (!entitlementsPath && platform === 'macOS') {
        await getDefaultEntitlementsMacOS(projectRef);
    } else {
        projectRef.entitlementsPath = entitlementsPath;
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
            `AD_HOC_CODE_SIGNING_ALLOWED=YES`,
            `-allowProvisioningUpdates`
        );
    }
    if (projectRef.entitlementsPath) {
        core.debug(`Entitlements path: ${projectRef.entitlementsPath}`);
        const entitlementsHandle = await fs.promises.open(projectRef.entitlementsPath, 'r');
        try {
            const entitlementsContent = await fs.promises.readFile(entitlementsHandle, 'utf8');
            core.debug(`----- Entitlements content: -----\n${entitlementsContent}\n---------------------------------`);
        } finally {
            await entitlementsHandle.close();
        }
        archiveArgs.push(`CODE_SIGN_ENTITLEMENTS=${projectRef.entitlementsPath}`);
    }
    if (platform === 'iOS') {
        // don't strip debug symbols during copy
        archiveArgs.push('COPY_PHASE_STRIP=NO');
    }
    if (platform === 'macOS' && projectRef.exportOption !== 'app-store') {
        // enable hardened runtime
        archiveArgs.push('ENABLE_HARDENED_RUNTIME=YES');
    }
    if (!core.isDebug()) {
        archiveArgs.push('-quiet');
    }
    await execWithXcBeautify(archiveArgs);
    projectRef.archivePath = archivePath
    return projectRef;
}

async function ExportXcodeArchive(projectRef: XcodeProject): Promise<XcodeProject> {
    const { projectName, projectDirectory, archivePath, exportOptionsPath } = projectRef;
    projectRef.exportPath = `${projectDirectory}/${projectName}`;
    core.debug(`Export path: ${projectRef.exportPath}`);
    core.setOutput('output-directory', projectRef.exportPath);
    const exportArgs = [
        '-exportArchive',
        '-archivePath', archivePath,
        '-exportPath', projectRef.exportPath,
        '-exportOptionsPlist', exportOptionsPath,
        '-allowProvisioningUpdates',
        `-authenticationKeyID`, projectRef.credential.appStoreConnectKeyId,
        `-authenticationKeyPath`, projectRef.credential.appStoreConnectKeyPath,
        `-authenticationKeyIssuerID`, projectRef.credential.appStoreConnectIssuerId
    ];
    if (!core.isDebug()) {
        exportArgs.push('-quiet');
    }
    await execWithXcBeautify(exportArgs);
    if (projectRef.platform === 'macOS') {
        const notarize = core.getInput('notarize') === 'true' && projectRef.exportOption !== 'app-store';
        core.debug(`Notarize? ${notarize}`);
        if (notarize) {
            projectRef.executablePath = await createMacOSInstallerPkg(projectRef);
        }
        else {
            projectRef.executablePath = await getFileAtGlobPath(`${projectRef.exportPath}/**/*.pkg`);
        }
    } else {
        projectRef.executablePath = await getFileAtGlobPath(`${projectRef.exportPath}/**/*.ipa`);
    }
    try {
        await fs.promises.access(projectRef.executablePath, fs.constants.R_OK);
    } catch (error) {
        throw new Error(`Failed to export the archive at: ${projectRef.executablePath}`);
    }
    core.info(`Exported executable: ${projectRef.executablePath}`);
    core.setOutput('executable', projectRef.executablePath);
    return projectRef;
}

async function getFileAtGlobPath(globPattern: string): Promise<string> {
    const globber = await glob.create(globPattern);
    const files = await globber.glob();
    if (files.length === 0) {
        throw new Error(`No file found at: ${globPattern}`);
    }
    return files[0];
}

async function createMacOSInstallerPkg(projectRef: XcodeProject): Promise<string> {
    core.info('Creating macOS installer pkg...');
    let output = '';
    const pkgPath = `${projectRef.exportPath}/${projectRef.projectName}.pkg`;
    const appPath = await getFileAtGlobPath(`${projectRef.exportPath}/**/*.app`);
    await exec.exec('productbuild', ['--component', appPath, '/Applications', pkgPath], {
        listeners: {
            stdout: (data: Buffer) => {
                output += data.toString();
            }
        }
    });
    try {
        await fs.promises.access(pkgPath, fs.constants.R_OK);
    } catch (error) {
        throw new Error(`Failed to create the pkg at: ${pkgPath}!`);
    }
    return pkgPath;
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
    if (platforms[platformName] !== 'macOS') {
        await downloadPlatformSdkIfMissing(platforms[platformName]);
    }
    return platforms[platformName] || null;
}

async function downloadPlatformSdkIfMissing(platform: string) {
    await exec.exec(xcodebuild, ['-runFirstLaunch']);
    let output = '';
    await exec.exec(xcrun, ['simctl', 'list'], {
        listeners: {
            stdout: (data: Buffer) => {
                output += data.toString();
            }
        }
    });
    if (output.includes(platform)) {
        return;
    }
    await exec.exec(xcodebuild, ['-downloadPlatform', platform]);
    await exec.exec(xcodebuild, ['-runFirstLaunch']);
}

async function getExportOptions(projectRef: XcodeProject): Promise<void> {
    const exportOptionPlistInput = core.getInput('export-option-plist');
    let exportOptionsPath = undefined;
    if (!exportOptionPlistInput) {
        const exportOption = core.getInput('export-option') || 'development';
        let method: string;
        if (projectRef.platform === 'macOS') {
            switch (exportOption) {
                case 'steam':
                    method = 'developer-id';
                    break;
                case 'ad-hoc':
                    method = 'development';
                    break;
                default:
                    method = exportOption;
                    break;
            }
        } else {
            method = exportOption;
        }
        const exportOptions = {
            method: method,
            signingStyle: projectRef.credential.signingIdentity ? 'manual' : 'automatic',
            teamID: `${projectRef.credential.teamId}`
        };
        exportOptionsPath = await writeExportOptions(projectRef.projectPath, exportOptions);
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
        const exportOptions = plist.parse(exportOptionContent);
        projectRef.exportOption = exportOptions['method'];
    } finally {
        await exportOptionsHandle.close();
    }
    projectRef.exportOptionsPath = exportOptionsPath;
}

async function writeExportOptions(projectPath: string, exportOptions: any): Promise<string> {
    const exportOptionsPath = `${projectPath}/exportOptions.plist`;
    await fs.promises.writeFile(exportOptionsPath, plist.build(exportOptions));
    return exportOptionsPath;
}

async function getDefaultEntitlementsMacOS(projectRef: XcodeProject): Promise<void> {
    const entitlementsPath = `${projectRef.projectPath}/Entitlements.plist`;
    projectRef.entitlementsPath = entitlementsPath;
    try {
        await fs.promises.access(entitlementsPath, fs.constants.R_OK);
        core.debug(`Existing Entitlements.plist found at: ${entitlementsPath}`);
        return;
    } catch (error) {
        core.warning('Entitlements.plist not found, creating default Entitlements.plist...');
    }
    const exportOption = projectRef.exportOption;
    let defaultEntitlements = undefined;
    // https://yemi.me/2020/02/17/en/submit-unity-macos-build-to-steam-appstore/#CodeSigning
    switch (exportOption) {
        case 'app-store':
            defaultEntitlements = {
                'com.apple.security.app-sandbox': true,
                'com.apple.security.files.user-selected.read-only': true,
            };
            break;
        default:
            // steam: https://partner.steamgames.com/doc/store/application/platforms#3
            defaultEntitlements = {
                'com.apple.security.cs.disable-library-validation': true,
                'com.apple.security.cs.allow-dyld-environment-variables': true,
                'com.apple.security.cs.disable-executable-page-protection': true,
            };
            break;
    }
    await fs.promises.writeFile(entitlementsPath, plist.build(defaultEntitlements));
}

async function execWithXcBeautify(xcodeBuildArgs: string[]) {
    try {
        await exec.exec('xcbeautify', ['--version'], { silent: true });
    } catch (error) {
        core.debug('Installing xcbeautify...');
        await exec.exec('brew', ['install', 'xcbeautify']);
    }
    const xcBeautifyProcess = spawn('xcbeautify', ['--quiet', '--is-ci', '--disable-logging'], {
        stdio: ['pipe', process.stdout, process.stderr]
    });
    core.info(`[command]${xcodebuild} ${xcodeBuildArgs.join(' ')}`);
    let errorOutput = '';
    const exitCode = await exec.exec(xcodebuild, xcodeBuildArgs, {
        listeners: {
            stdout: (data: Buffer) => {
                xcBeautifyProcess.stdin.write(data);
            },
            stderr: (data: Buffer) => {
                xcBeautifyProcess.stdin.write(data);
                errorOutput += data.toString();
            }
        },
        silent: true,
        ignoreReturnCode: true
    });
    xcBeautifyProcess.stdin.end();
    await new Promise<void>((resolve, reject) => {
        xcBeautifyProcess.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`xcbeautify exited with code ${code}`));
            } else {
                resolve();
            }
        });
    });
    if (exitCode !== 0) {
        throw new Error(`xcodebuild exited with code ${exitCode}\n${errorOutput}`);
    }
}

async function ValidateApp(projectRef: XcodeProject) {
    const platforms = {
        'iOS': 'ios',
        'macOS': 'macos',
        'tvOS': 'appletvos',
        'visionOS': 'xros'
    };
    try {
        await fs.promises.access(projectRef.executablePath, fs.constants.R_OK);
    } catch (error) {
        throw new Error(`Failed to access the executable at: ${projectRef.executablePath}`);
    }
    const validateArgs = [
        'altool',
        '--validate-app',
        '--bundle-id', projectRef.bundleId,
        '--file', projectRef.executablePath,
        '--type', platforms[projectRef.platform],
        '--apiKey', projectRef.credential.appStoreConnectKeyId,
        '--apiIssuer', projectRef.credential.appStoreConnectIssuerId,
        '--verbose',
        '--output-format', 'json'
    ];
    if (!core.isDebug()) {
        core.info(`[command]${xcrun} ${validateArgs.join(' ')}`);
    }
    let output = '';
    const exitCode = await exec.exec(xcrun, validateArgs, {
        listeners: {
            stdout: (data: Buffer) => {
                output += data.toString();
            }
        },
        silent: !core.isDebug(),
        ignoreReturnCode: true
    });
    core.debug(`Validation results: ${JSON.stringify(JSON.parse(output), null, 2)}`);
    if (exitCode > 0) {
        throw new Error(`Failed to validate app: ${JSON.stringify(JSON.parse(output), null, 2)}`);
    }
}

async function UploadApp(projectRef: XcodeProject) {
    const platforms = {
        'iOS': 'ios',
        'macOS': 'macos',
        'tvOS': 'appletvos',
        'visionOS': 'xros'
    };
    const uploadArgs = [
        'altool',
        '--upload-package', projectRef.executablePath,
        '--type', platforms[projectRef.platform],
        '--bundle-id', projectRef.bundleId,
        '--team-id', projectRef.credential.teamId,
        '--apiKey', projectRef.credential.appStoreConnectKeyId,
        '--apiIssuer', projectRef.credential.appStoreConnectIssuerId,
        '--verbose',
        '--output-format', 'json'
    ];
    // if (!core.isDebug()) {
    //     core.info(`[command]${xcrun} ${uploadArgs.join(' ')}`);
    // }
    let output = '';
    const exitCode = await exec.exec(xcrun, uploadArgs, {
        listeners: {
            stdout: (data: Buffer) => {
                output += data.toString();
            }
        },
        // silent: !core.isDebug(),
        ignoreReturnCode: true
    });
    core.info('Upload result:');
    core.info(JSON.stringify(JSON.parse(output), null, 2));
    if (exitCode > 0) {
        throw new Error('Failed to upload app');
    }
}

export {
    GetProjectDetails,
    ArchiveXcodeProject,
    ExportXcodeArchive,
    ValidateApp,
    UploadApp
}
