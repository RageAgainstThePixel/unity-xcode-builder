import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as uuid from 'uuid';
import * as fs from 'fs';

const security = '/usr/bin/security';
const temp = process.env['RUNNER_TEMP'] || '.';
const appStoreConnectKeyDir = `${process.env.HOME}/.appstoreconnect/private_keys`;
// https://www.apple.com/certificateauthority/
const developerIdG2IntermediateUrl = 'https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer';

export class AppleCredential {
    constructor(
        tempPassPhrase: string,
        keychainPath: string,
        appStoreConnectKeyId: string,
        appStoreConnectIssuerId: string,
        appStoreConnectKeyPath?: string,
        appStoreConnectKey?: string,
        teamId?: string,
        manualSigningIdentity?: string,
        manualProvisioningProfileUUID?: string
    ) {
        this.tempPassPhrase = tempPassPhrase;
        this.keychainPath = keychainPath;
        this.appStoreConnectKeyId = appStoreConnectKeyId;
        this.appStoreConnectIssuerId = appStoreConnectIssuerId;
        this.appStoreConnectKeyPath = appStoreConnectKeyPath;
        this.appStoreConnectKey = appStoreConnectKey;
        this.teamId = teamId;
        this.manualSigningIdentity = manualSigningIdentity;
        this.manualProvisioningProfileUUID = manualProvisioningProfileUUID;
    }
    tempPassPhrase: string;
    keychainPath: string;
    appStoreConnectKeyId: string;
    appStoreConnectIssuerId: string;
    appStoreConnectKeyPath?: string;
    appStoreConnectKey?: string;
    teamId?: string;
    manualSigningIdentity?: string;
    manualProvisioningProfileUUID?: string;
    bearerToken?: string;
    ascPublicId?: string;
}

// https://docs.github.com/en/actions/use-cases-and-examples/deploying/installing-an-apple-certificate-on-macos-runners-for-xcode-development#add-a-step-to-your-workflow
export async function ImportCredentials(): Promise<AppleCredential> {
    try {
        core.startGroup('Importing credentials...');
        const tempCredential = uuid.v4();
        core.setSecret(tempCredential);
        core.saveState('tempCredential', tempCredential);
        const authenticationKeyID = core.getInput('app-store-connect-key-id', { required: true }).trim();
        core.saveState('authenticationKeyID', authenticationKeyID);
        const authenticationKeyIssuerID = core.getInput('app-store-connect-issuer-id', { required: true }).trim();
        core.saveState('authenticationKeyIssuerID', authenticationKeyIssuerID);
        const appStoreConnectKeyBase64 = core.getInput('app-store-connect-key', { required: true }).trim();
        await fs.promises.mkdir(appStoreConnectKeyDir, { recursive: true });
        const appStoreConnectKeyPath = `${appStoreConnectKeyDir}/AuthKey_${authenticationKeyID}.p8`;
        const appStoreConnectKey = Buffer.from(appStoreConnectKeyBase64, 'base64').toString('utf8');
        core.setSecret(appStoreConnectKey);
        await fs.promises.writeFile(appStoreConnectKeyPath, appStoreConnectKey, 'utf8');
        const keychainPath = `${temp}/${tempCredential}.keychain-db`;
        await exec.exec(security, ['create-keychain', '-p', tempCredential, keychainPath]);
        await exec.exec(security, ['set-keychain-settings', '-lut', '21600', keychainPath]);
        await unlockTemporaryKeychain(keychainPath, tempCredential);
        let manualSigningIdentity = core.getInput('manual-signing-identity') || core.getInput('signing-identity');
        let certificateUUID: string | undefined;
        let teamId = core.getInput('team-id');
        const manualSigningCertificateBase64 = core.getInput('manual-signing-certificate') || core.getInput('certificate');
        let installedCertificates: boolean = false;
        if (manualSigningCertificateBase64) {
            const manualSigningCertificatePassword = core.getInput('manual-signing-certificate-password') || core.getInput('certificate-password');
            if (!manualSigningCertificatePassword) {
                throw new Error('manual-signing-certificate-password is required when manual-signing-certificate is provided!');
            }
            core.info('Importing manual signing certificate...');
            await importCertificate(
                keychainPath,
                tempCredential,
                manualSigningCertificateBase64.trim(),
                manualSigningCertificatePassword.trim());
            installedCertificates = true;
            if (!manualSigningIdentity) {
                let output = '';
                core.info(`[command]${security} find-identity -v -p codesigning ${keychainPath}`);
                await exec.exec(security, ['find-identity', '-v', '-p', 'codesigning', keychainPath], {
                    listeners: {
                        stdout: (data: Buffer) => {
                            output += data.toString();
                        }
                    },
                    silent: true
                });
                const match = output.match(/\d\) (?<uuid>\w+) \"(?<signing_identity>[^"]+)\"$/m);
                if (!match) {
                    throw new Error('Failed to match signing identity!');
                }
                certificateUUID = match.groups?.uuid;
                core.setSecret(certificateUUID);
                manualSigningIdentity = match.groups?.signing_identity;
                if (!manualSigningIdentity) {
                    throw new Error('Failed to find signing identity!');
                }
                if (!teamId) {
                    const teamMatch = manualSigningIdentity.match(/(?<team_id>[A-Z0-9]{10})\s/);
                    if (!teamMatch) {
                        throw new Error('Failed to match team id!');
                    }
                    teamId = teamMatch.groups?.team_id;
                    if (!teamId) {
                        throw new Error('Failed to find team id!');
                    }
                    core.setSecret(teamId);
                }
                core.info(output);
            }
        }
        const manualProvisioningProfileBase64 = core.getInput('provisioning-profile');
        let manualProvisioningProfileUUID: string | undefined;
        if (manualProvisioningProfileBase64) {
            core.info('Importing provisioning profile...');
            const provisioningProfileName = core.getInput('provisioning-profile-name', { required: true });
            if (!provisioningProfileName.endsWith('.mobileprovision') &&
                !provisioningProfileName.endsWith('.provisionprofile')) {
                throw new Error('Provisioning profile name must end with .mobileprovision or .provisionprofile');
            }
            const provisioningProfilePath = `${temp}/${provisioningProfileName}`;
            core.saveState('provisioningProfilePath', provisioningProfilePath);
            const provisioningProfile = Buffer.from(manualProvisioningProfileBase64, 'base64').toString('binary');
            await fs.promises.writeFile(provisioningProfilePath, provisioningProfile, 'binary');
            const provisioningProfileContent = await fs.promises.readFile(provisioningProfilePath, 'utf8');
            const uuidMatch = provisioningProfileContent.match(/<key>UUID<\/key>\s*<string>([^<]+)<\/string>/);
            if (uuidMatch) {
                manualProvisioningProfileUUID = uuidMatch[1];
            }
            if (!manualProvisioningProfileUUID) {
                throw new Error('Failed to parse provisioning profile UUID');
            }
        }
        const developerIdApplicationCertificateBase64 = core.getInput('developer-id-application-certificate');
        if (developerIdApplicationCertificateBase64) {
            const developerIdApplicationCertificatePassword = core.getInput('developer-id-application-certificate-password');
            if (!developerIdApplicationCertificatePassword) {
                throw new Error('developer-id-application-certificate-password is required when developer-id-application-certificate is provided!');
            }
            core.info('Importing developer id application certificate...');
            await importCertificate(
                keychainPath,
                tempCredential,
                developerIdApplicationCertificateBase64.trim(),
                developerIdApplicationCertificatePassword.trim());
            installedCertificates = true;
        }
        const developerIdInstallerCertificateBase64 = core.getInput('developer-id-installer-certificate');
        if (developerIdInstallerCertificateBase64) {
            const developerIdInstallerCertificatePassword = core.getInput('developer-id-installer-certificate-password');
            if (!developerIdInstallerCertificatePassword) {
                throw new Error('developer-id-installer-certificate-password is required when developer-id-installer-certificate is provided!');
            }
            core.info('Importing developer id installer certificate...');
            await importCertificate(
                keychainPath,
                tempCredential,
                developerIdInstallerCertificateBase64.trim(),
                developerIdInstallerCertificatePassword.trim());
            installedCertificates = true;
        }
        if (developerIdApplicationCertificateBase64 || developerIdInstallerCertificateBase64) {
            await importDeveloperIdG2Intermediate(keychainPath);
        }
        if (installedCertificates) {
            let output = '';
            core.info(`[command]${security} find-identity -v ${keychainPath}`);
            const exitCode = await exec.exec(security, ['find-identity', '-v', keychainPath], {
                listeners: {
                    stdout: (data: Buffer) => {
                        output += data.toString();
                    }
                },
                silent: true
            });
            if (exitCode !== 0) {
                throw new Error(`Failed to list identities! Exit code: ${exitCode}`);
            }
            const matches = output.matchAll(/\d\) (?<uuid>\w+) \"(?<signing_identity>[^"]+)\"$/gm);
            for (const match of matches) {
                const uuid = match.groups?.uuid;
                const signingIdentity = match.groups?.signing_identity;
                if (uuid && signingIdentity) {
                    core.setSecret(uuid);
                    core.info(`Found identity: ${signingIdentity} (${uuid})`);
                }
            }
        }
        return new AppleCredential(
            tempCredential,
            keychainPath,
            authenticationKeyID,
            authenticationKeyIssuerID,
            appStoreConnectKeyPath,
            appStoreConnectKey,
            teamId,
            manualSigningIdentity,
            manualProvisioningProfileUUID
        );
    } finally {
        core.endGroup();
    }
}

export async function RemoveCredentials(): Promise<void> {
    const provisioningProfilePath = core.getState('provisioningProfilePath');
    if (provisioningProfilePath) {
        core.info('Removing provisioning profile...');
        try {
            await fs.promises.unlink(provisioningProfilePath);
        } catch (error) {
            core.error(`Failed to remove provisioning profile!\n${error.stack}`);
        }
    }
    const tempCredential = core.getState('tempCredential');
    if (tempCredential) {
        core.info('Removing keychain...');
        const keychainPath = `${temp}/${tempCredential}.keychain-db`;
        await exec.exec(security, ['delete-keychain', keychainPath]);
    } else {
        core.error('Missing tempCredential state');
    }
    const authenticationKeyID = core.getState('authenticationKeyID');
    const appStoreConnectKeyPath = `${appStoreConnectKeyDir}/AuthKey_${authenticationKeyID}.p8`;
    const certificateDirectory = await getCertificateDirectory();
    core.info('Removing credentials...');
    try {
        await fs.promises.unlink(appStoreConnectKeyPath);
    } catch (error) {
        core.error(`Failed to remove app store connect key!\n${error.stack}`);
    }
    core.info('Removing certificate directory...');
    try {
        await fs.promises.rm(certificateDirectory, { recursive: true, force: true });
    } catch (error) {
        core.error(`Failed to remove certificate directory!\n${error.stack}`);
    }
}

async function getCertificateDirectory(): Promise<string> {
    const certificateDirectory = `${temp}/certificates`;
    try {
        await fs.promises.access(certificateDirectory, fs.constants.R_OK)
    } catch (error) {
        core.debug(`Creating directory ${certificateDirectory}`);
        await fs.promises.mkdir(certificateDirectory, { recursive: true });
    }
    return certificateDirectory;
}

async function importCertificate(keychainPath: string, tempCredential: string, certificateBase64: string, certificatePassword: string): Promise<void> {
    const certificateDirectory = await getCertificateDirectory();
    const certificatePath = `${certificateDirectory}/${tempCredential}-${uuid.v4()}.p12`;
    const certificate = Buffer.from(certificateBase64, 'base64');
    await fs.promises.writeFile(certificatePath, certificate);
    await exec.exec(security, [
        'import', certificatePath,
        '-k', keychainPath,
        '-P', certificatePassword,
        '-A', '-f', 'pkcs12'
    ]);
    const partitionList = 'apple-tool:,apple:,codesign:';
    if (core.isDebug()) {
        core.info(`[command]${security} set-key-partition-list -S ${partitionList} -s -k ${tempCredential} ${keychainPath}`);
    }
    await exec.exec(security, [
        'set-key-partition-list',
        '-S', partitionList,
        '-s', '-k', tempCredential,
        keychainPath
    ], {
        silent: !core.isDebug()
    });
    await exec.exec(security, ['list-keychains', '-d', 'user', '-s', keychainPath, 'login.keychain-db']);
}

// newer Developer ID certificates chain through the G2 intermediate, which some runner images lack,
// so codesign fails with "unable to build chain". Best effort: images that already have it keep working.
async function importDeveloperIdG2Intermediate(keychainPath: string): Promise<void> {
    const certificateDirectory = await getCertificateDirectory();
    const intermediatePath = `${certificateDirectory}/${uuid.v4()}-developer-id-g2.cer`;
    try {
        const response = await fetch(developerIdG2IntermediateUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        await fs.promises.writeFile(intermediatePath, Buffer.from(await response.arrayBuffer()));
        let output = '';
        const exitCode = await exec.exec(security, ['add-certificates', '-k', keychainPath, intermediatePath], {
            listeners: {
                stdout: (data: Buffer) => { output += data.toString(); },
                stderr: (data: Buffer) => { output += data.toString(); }
            },
            ignoreReturnCode: true
        });
        if (exitCode !== 0 && !output.includes('already exists')) {
            throw new Error(`security add-certificates exited with code ${exitCode}\n${output}`);
        }
        core.info('Imported the Developer ID Certification Authority G2 intermediate.');
    } catch (error) {
        core.warning(`Failed to import the Developer ID G2 intermediate from ${developerIdG2IntermediateUrl}; signing may fail with "unable to build chain".\n${error}`);
    } finally {
        await fs.promises.rm(intermediatePath, { force: true });
    }
}

async function unlockTemporaryKeychain(keychainPath: string, tempCredential: string): Promise<void> {
    const exitCode = await exec.exec(security, ['unlock-keychain', '-p', tempCredential, keychainPath]);
    if (exitCode !== 0) {
        throw new Error(`Failed to unlock keychain! Exit code: ${exitCode}`);
    }
}