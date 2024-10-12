import { AppleCredential } from './AppleCredential';

export class XcodeProject {
    constructor(projectPath: string, projectName: string, bundleId: string, projectDirectory: string) {
        this.projectPath = projectPath;
        this.projectName = projectName;
        this.projectDirectory = projectDirectory;
    }
    projectPath: string;
    projectName: string;
    bundleId: string;
    projectDirectory: string;
    credential: AppleCredential;
    platform: string;
    archivePath: string;
    exportPath: string;
    exportOption: string;
    exportOptionsPath: string;
    entitlementsPath: string;
    notarize: boolean;
    appId: string;
}