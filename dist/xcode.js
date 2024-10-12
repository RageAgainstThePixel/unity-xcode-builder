"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadApp = exports.ValidateApp = exports.ExportXcodeArchive = exports.ArchiveXcodeProject = exports.GetProjectDetails = void 0;
const child_process_1 = require("child_process");
const core = require("@actions/core");
const exec = require("@actions/exec");
const glob = require("@actions/glob");
const plist = require("plist");
const path = require("path");
const fs = require("fs");
const XcodeProject_1 = require("./XcodeProject");
const xcodebuild = '/usr/bin/xcodebuild';
const xcrun = '/usr/bin/xcrun';
const WORKSPACE = process.env.GITHUB_WORKSPACE || process.cwd();
async function GetProjectDetails() {
    const projectPathInput = core.getInput('project-path') || `${WORKSPACE}/**/*.xcodeproj`;
    core.debug(`Project path input: ${projectPathInput}`);
    let projectPath = undefined;
    const globber = await glob.create(projectPathInput);
    const files = await globber.glob();
    for (const file of files) {
        if (file.endsWith(`GameAssembly.xcodeproj`)) {
            continue;
        }
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
    let bundleId;
    if (!bundleIdInput || bundleIdInput === '') {
        let projectContent = await fs.promises.readFile(projectPath, 'utf8');
        let match = projectContent.match(/PRODUCT_BUNDLE_IDENTIFIER = (?<bundleId>[^;]+);/m);
        bundleId = match.groups.bundleId;
        if (!match) {
            throw new Error('Unable to determine bundle id from the project file!');
        }
    }
    else {
        bundleId = bundleIdInput;
    }
    return new XcodeProject_1.XcodeProject(projectPath, projectName, bundleId, projectDirectory);
}
exports.GetProjectDetails = GetProjectDetails;
async function ArchiveXcodeProject(projectRef) {
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
            stdout: (data) => {
                projectInfoOutput += data.toString();
            }
        },
        silent: !core.isDebug()
    });
    const projectInfo = JSON.parse(projectInfoOutput);
    const schemes = projectInfo.project.schemes;
    if (!schemes) {
        throw new Error('No schemes found in the project');
    }
    core.debug(`Available schemes:`);
    schemes.forEach(s => core.debug(`  > ${s}`));
    let scheme = core.getInput('scheme');
    if (!scheme) {
        if (schemes.includes('Unity-iPhone')) {
            scheme = 'Unity-iPhone';
        }
        else {
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
    }
    else {
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
        archiveArgs.push(`CODE_SIGN_IDENTITY=${signingIdentity}`, `OTHER_CODE_SIGN_FLAGS=--keychain ${keychainPath}`);
    }
    else {
        archiveArgs.push(`CODE_SIGN_IDENTITY=-`);
    }
    archiveArgs.push(`CODE_SIGN_STYLE=${provisioningProfileUUID || signingIdentity ? 'Manual' : 'Automatic'}`);
    if (provisioningProfileUUID) {
        archiveArgs.push(`PROVISIONING_PROFILE=${provisioningProfileUUID}`);
    }
    else {
        archiveArgs.push(`AD_HOC_CODE_SIGNING_ALLOWED=YES`, `-allowProvisioningUpdates`);
    }
    if (projectRef.entitlementsPath) {
        core.debug(`Entitlements path: ${projectRef.entitlementsPath}`);
        const entitlementsHandle = await fs.promises.open(projectRef.entitlementsPath, 'r');
        try {
            const entitlementsContent = await fs.promises.readFile(entitlementsHandle, 'utf8');
            core.debug(`----- Entitlements content: -----\n${entitlementsContent}\n---------------------------------`);
        }
        finally {
            await entitlementsHandle.close();
        }
        archiveArgs.push(`CODE_SIGN_ENTITLEMENTS=${projectRef.entitlementsPath}`);
    }
    if (platform === 'iOS') {
        archiveArgs.push('COPY_PHASE_STRIP=NO');
    }
    if (platform === 'macOS' && projectRef.exportOption !== 'app-store') {
        archiveArgs.push('ENABLE_HARDENED_RUNTIME=YES');
    }
    if (!core.isDebug()) {
        archiveArgs.push('-quiet');
    }
    await execWithXcBeautify(archiveArgs);
    projectRef.archivePath = archivePath;
    return projectRef;
}
exports.ArchiveXcodeProject = ArchiveXcodeProject;
async function ExportXcodeArchive(projectRef) {
    const { projectName, projectDirectory, archivePath, exportOptionsPath } = projectRef;
    const exportPath = `${projectDirectory}/${projectName}`;
    core.debug(`Export path: ${exportPath}`);
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
    await execWithXcBeautify(exportArgs);
    projectRef.exportPath = exportPath;
    core.info(`Exported: ${exportPath}`);
    const globPath = `${exportPath}/**/*.ipa\n${exportPath}/**/*.app`;
    const globber = await glob.create(globPath);
    const files = await globber.glob();
    if (files.length === 0) {
        throw new Error(`No IPA or APP file found in the export path.\n${globPath}`);
    }
    core.setOutput('executable', files[0]);
    return projectRef;
}
exports.ExportXcodeArchive = ExportXcodeArchive;
async function determinePlatform(projectPath, scheme) {
    var _a, _b;
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
            stdout: (data) => {
                buildSettingsOutput += data.toString();
            }
        },
        silent: !core.isDebug()
    });
    const match = buildSettingsOutput.match(/\s+PLATFORM_NAME = (?<platformName>\w+)/m);
    core.debug(`$PLATFORM_NAME: ${(_a = match === null || match === void 0 ? void 0 : match.groups) === null || _a === void 0 ? void 0 : _a.platformName}`);
    if (!match) {
        throw new Error('No PLATFORM_NAME found in the build settings');
    }
    const platformName = (_b = match.groups) === null || _b === void 0 ? void 0 : _b.platformName;
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
async function getExportOptions(projectRef) {
    const exportOptionPlistInput = core.getInput('export-option-plist');
    let exportOptionsPath = undefined;
    if (!exportOptionPlistInput) {
        const exportOption = core.getInput('export-option') || 'development';
        let method;
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
        }
        else {
            method = exportOption;
        }
        const exportOptions = {
            method: method,
            signingStyle: projectRef.credential.signingIdentity ? 'manual' : 'automatic',
            teamID: `${projectRef.credential.teamId}`
        };
        exportOptionsPath = await writeExportOptions(projectRef.projectPath, exportOptions);
    }
    else {
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
    }
    finally {
        await exportOptionsHandle.close();
    }
    projectRef.exportOptionsPath = exportOptionsPath;
}
async function writeExportOptions(projectPath, exportOptions) {
    const exportOptionsPath = `${projectPath}/exportOptions.plist`;
    await fs.promises.writeFile(exportOptionsPath, plist.build(exportOptions));
    return exportOptionsPath;
}
async function getDefaultEntitlementsMacOS(projectRef) {
    const entitlementsPath = `${projectRef.projectPath}/Entitlements.plist`;
    projectRef.entitlementsPath = entitlementsPath;
    try {
        await fs.promises.access(entitlementsPath, fs.constants.R_OK);
        core.debug(`Existing Entitlements.plist found at: ${entitlementsPath}`);
        return;
    }
    catch (error) {
        core.warning('Entitlements.plist not found, creating default Entitlements.plist...');
    }
    const exportOption = projectRef.exportOption;
    let defaultEntitlements = undefined;
    switch (exportOption) {
        case 'app-store':
            defaultEntitlements = {
                'com.apple.security.app-sandbox': true,
                'com.apple.security.files.user-selected.read-only': true,
            };
            break;
        default:
            defaultEntitlements = {
                'com.apple.security.cs.disable-library-validation': true,
                'com.apple.security.cs.allow-dyld-environment-variables': true,
                'com.apple.security.cs.disable-executable-page-protection': true,
            };
            break;
    }
    await fs.promises.writeFile(entitlementsPath, plist.build(defaultEntitlements));
}
async function execWithXcBeautify(xcodeBuildArgs) {
    try {
        await exec.exec('xcbeautify', ['--version'], { silent: true });
    }
    catch (error) {
        core.debug('Installing xcbeautify...');
        await exec.exec('brew', ['install', 'xcbeautify']);
    }
    const xcBeautifyProcess = (0, child_process_1.spawn)('xcbeautify', ['--quiet', '--is-ci', '--disable-logging'], {
        stdio: ['pipe', process.stdout, process.stderr]
    });
    core.info(`[command]${xcodebuild} ${xcodeBuildArgs.join(' ')}`);
    const exitCode = await exec.exec(xcodebuild, xcodeBuildArgs, {
        listeners: {
            stdout: (data) => {
                xcBeautifyProcess.stdin.write(data);
            },
            stderr: (data) => {
                xcBeautifyProcess.stdin.write(data);
            }
        },
        silent: true,
        ignoreReturnCode: true
    });
    xcBeautifyProcess.stdin.end();
    await new Promise((resolve, reject) => {
        xcBeautifyProcess.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`xcbeautify exited with code ${code}`));
            }
            else {
                resolve();
            }
        });
    });
    if (exitCode !== 0) {
        throw new Error(`xcodebuild exited with code ${exitCode}`);
    }
}
async function ValidateApp(projectRef) {
    const platforms = {
        'iOS': 'ios',
        'macOS': 'macos',
        'tvOS': 'appletvos',
        'visionOS': 'xros'
    };
    let output = '';
    await exec.exec(xcrun, [
        'altool',
        '--validate-app',
        '--file', projectRef.exportPath,
        '--type', platforms[projectRef.platform],
        '--apiKey', projectRef.credential.appStoreConnectKeyId,
        '--apiIssuer', projectRef.credential.appStoreConnectIssuerId,
        '--verbose',
        '--output-format', 'json'
    ], {
        listeners: {
            stdout: (data) => {
                output += data.toString();
            }
        }
    });
}
exports.ValidateApp = ValidateApp;
async function UploadApp(projectRef) {
    const platforms = {
        'iOS': 'ios',
        'macOS': 'macos',
        'tvOS': 'appletvos',
        'visionOS': 'xros'
    };
    let output = '';
    await exec.exec(xcrun, [
        'altool',
        '--upload-package',
        projectRef.archivePath,
        '--type', platforms[projectRef.platform],
        '--team-id', projectRef.credential.teamId,
        '--apiKey', projectRef.credential.appStoreConnectKeyId,
        '--apiIssuer', projectRef.credential.appStoreConnectIssuerId,
        '--verbose',
        '--output-format', 'json'
    ], {
        listeners: {
            stdout: (data) => {
                output += data.toString();
            }
        }
    });
}
exports.UploadApp = UploadApp;
//# sourceMappingURL=xcode.js.map