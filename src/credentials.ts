import core = require('@actions/core');
import exec = require('@actions/exec');
import uuid = require('uuid');
import fs = require('fs');

const security = 'security';
const temp = process.env['RUNNER_TEMP'] || '.';

// https://docs.github.com/en/actions/use-cases-and-examples/deploying/installing-an-apple-certificate-on-macos-runners-for-xcode-development#add-a-step-to-your-workflow
async function ImportCredentials() {
    core.info('Importing credentials...');
    const sessionId = uuid.v4();
    const appStoreConnectKey = core.getInput('app-store-connect-key', { required: true });
    const appStoreConnectKeyPath = `${temp}/${sessionId}.p8`;
    await fs.promises.writeFile(appStoreConnectKeyPath, appStoreConnectKey, 'base64');
    core.info('Importing certificate...');
    const certificate = core.getInput('certificate', { required: true });
    const certificatePassword = core.getInput('certificate-password', { required: true });
    const certificatePath = `${temp}/${sessionId}.p12`;
    const keychainPath = `${temp}/${sessionId}.keychain-db`;
    core.saveState('sessionId', sessionId);
    await fs.promises.writeFile(certificatePath, certificate, 'base64');
    await exec.exec(security, ['create-keychain', '-p', sessionId, keychainPath]);
    await exec.exec(security, ['set-keychain-settings', '-lut', '21600', keychainPath]);
    await exec.exec(security, ['unlock-keychain', '-p', sessionId, keychainPath]);
    await exec.exec(security, ['import', certificatePath, '-P', certificatePassword, '-A', '-t', 'cert', '-f', 'pkcs12', '-k', keychainPath]);
    await exec.exec(security, ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', sessionId, keychainPath], { silent: !core.isDebug() });
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
        const provisioningProfile = Buffer.from(provisioningProfileBase64, 'base64').toString('utf8');
        core.saveState('provisioningProfilePath', provisioningProfilePath);
        await fs.promises.writeFile(provisioningProfilePath, provisioningProfile);
        await exec.exec(security, ['cms', '-D', '-i', provisioningProfilePath]);
        await exec.exec(security, ['import', provisioningProfilePath, '-k', keychainPath, '-A']);
    }
}

async function Cleanup() {
    const sessionId = core.getState('sessionId');
    if (sessionId) {
        core.info('Removing certificate...');
        const keychainPath = `${temp}/${sessionId}.keychain-db`;
        await exec.exec(security, ['delete-keychain', keychainPath]);
    }
    const provisioningProfilePath = core.getState('provisioningProfilePath');
    if (provisioningProfilePath) {
        core.info('Removing provisioning profile...');
        try {
            await fs.promises.unlink(provisioningProfilePath);
        } catch (error) {
            core.error(`Failed to remove provisioning profile!\n${error.stack}`);
        }
    }
    core.info('Removing App Store Connect API key...');
    try {
        await fs.promises.unlink(`${temp}/${sessionId}.p8`);
    } catch (error) {
        core.error(`Failed to remove app store connect key!\n${error.stack}`);
    }
}

export {
    ImportCredentials,
    Cleanup,
}
