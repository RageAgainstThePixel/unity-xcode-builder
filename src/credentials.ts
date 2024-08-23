import core = require('@actions/core');
import exec = require('@actions/exec');
import uuid = require('uuid');
import fs = require('fs');

const security = '/usr/bin/security';
const temp = process.env['RUNNER_TEMP'] || '.';

// https://docs.github.com/en/actions/use-cases-and-examples/deploying/installing-an-apple-certificate-on-macos-runners-for-xcode-development#add-a-step-to-your-workflow
async function ImportCredentials(): Promise<AppleCredential> {
    const teamId = core.getInput('team-id', { required: true });
    core.info('Importing credentials...');
    const tempCredential = uuid.v4();
    const authenticationKeyID = core.getInput('app-store-connect-key-id', { required: true });
    const authenticationKeyIssuerID = core.getInput('app-store-connect-issuer-id', { required: true });
    const appStoreConnectKeyBase64 = core.getInput('app-store-connect-key', { required: true });
    const appStoreConnectKeyPath = `${temp}/${tempCredential}.p8`;
    const appStoreConnectKey = Buffer.from(appStoreConnectKeyBase64, 'base64').toString('utf8');
    await fs.promises.writeFile(appStoreConnectKeyPath, appStoreConnectKey, 'utf8');
    core.info('Importing certificate...');
    const certificateBase64 = core.getInput('certificate', { required: true });
    const certificatePassword = core.getInput('certificate-password', { required: true });
    core.saveState('tempCredential', tempCredential);
    const certificatePath = `${temp}/${tempCredential}.p12`;
    const keychainPath = `${temp}/${tempCredential}.keychain-db`;
    const certificate = Buffer.from(certificateBase64, 'base64').toString('binary');
    await fs.promises.writeFile(certificatePath, certificate, 'binary');
    await exec.exec(security, ['create-keychain', '-p', tempCredential, keychainPath]);
    await exec.exec(security, ['set-keychain-settings', '-lut', '21600', keychainPath]);
    await exec.exec(security, ['unlock-keychain', '-p', tempCredential, keychainPath]);
    await exec.exec(security, ['import', certificatePath, '-P', certificatePassword, '-A', '-t', 'cert', '-f', 'pkcs12', '-k', keychainPath]);
    if (!core.isDebug()) {
        core.info(`[command]${security} set-key-partition-list -S apple-tool:,apple:,codesign: -s -k ${tempCredential} ${keychainPath}`);
    }
    await exec.exec(security, ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', tempCredential, keychainPath], {
        silent: !core.isDebug()
    });
    await exec.exec(security, ['list-keychains', '-d', 'user', '-s', keychainPath]);
    const provisioningProfileBase64 = core.getInput('provisioning-profile');
    if (provisioningProfileBase64) {
        core.info('Importing provisioning profile...');
        const provisioningProfileName = core.getInput('provisioning-profile-name', { required: true });
        if (!provisioningProfileName.endsWith('.mobileprovision') &&
            !provisioningProfileName.endsWith('.provisionprofile')) {
            throw new Error('Provisioning profile name must end with .mobileprovision or .provisionprofile');
        }
        const provisioningProfilePath = `${temp}/${provisioningProfileName}`;
        core.saveState('provisioningProfilePath', provisioningProfilePath);
        const provisioningProfile = Buffer.from(provisioningProfileBase64, 'base64').toString('binary');
        await fs.promises.writeFile(provisioningProfilePath, provisioningProfile, 'binary');
        await exec.exec(security, ['cms', '-D', '-i', provisioningProfilePath]);
        await exec.exec(security, ['import', provisioningProfilePath, '-k', keychainPath, '-A']);
    }
    return new AppleCredential(tempCredential, keychainPath, authenticationKeyID, authenticationKeyIssuerID, appStoreConnectKeyPath, teamId);
}

async function Cleanup(): Promise<void> {
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
    if (!tempCredential) {
        throw new Error('Missing tempCredential state');
    }
    core.info('Removing certificate...');
    const keychainPath = `${temp}/${tempCredential}.keychain-db`;
    await exec.exec(security, ['delete-keychain', keychainPath]);
    core.info('Removing credentials...');
    try {
        await fs.promises.unlink(`${temp}/${tempCredential}.p8`);
    } catch (error) {
        core.error(`Failed to remove app store connect key!\n${error.stack}`);
    }
}

class AppleCredential {
    constructor(name: string, keychainPath: string, appStoreConnectKeyId: string, appStoreConnectIssuerId: string, appStoreConnectKeyPath: string, teamId: string) {
        this.name = name;
        this.keychainPath = keychainPath;
        this.appStoreConnectKeyId = appStoreConnectKeyId;
        this.appStoreConnectIssuerId = appStoreConnectIssuerId;
        this.appStoreConnectKeyPath = appStoreConnectKeyPath
        this.teamId = teamId;
    }
    name: string;
    keychainPath: string;
    appStoreConnectKeyId: string;
    appStoreConnectIssuerId: string;
    appStoreConnectKeyPath: string;
    teamId: string;
}

export {
    ImportCredentials,
    Cleanup,
    AppleCredential
}
