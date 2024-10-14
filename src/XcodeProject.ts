import { AppleCredential } from './AppleCredential';

export class XcodeProject {
    constructor(projectPath: string, projectName: string, bundleId: string, projectDirectory: string, version: string, versionString: string) {
        this.projectPath = projectPath;
        this.projectName = projectName;
        this.bundleId = bundleId;
        this.projectDirectory = projectDirectory;
        this.version = version;
        this.versionString = versionString;
    }
    projectPath: string;
    projectName: string;
    bundleId: string;
    projectDirectory: string;
    credential: AppleCredential;
    platform: string;
    archivePath: string;
    exportPath: string;
    executablePath: string;
    exportOption: string;
    exportOptionsPath: string;
    entitlementsPath: string;
    appId: string;
    version: string;
    versionString: string;
}