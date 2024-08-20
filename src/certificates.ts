import core = require('@actions/core');
import exec = require('@actions/exec');
import uuid = require('uuid');
import fs = require('fs');

const temp = process.env['RUNNER_TEMP'] || '.';

// https://docs.github.com/en/actions/use-cases-and-examples/deploying/installing-an-apple-certificate-on-macos-runners-for-xcode-development#add-a-step-to-your-workflow
async function ImportCertificate() {
    core.info('Importing certificate...');
    const certificate = core.getInput('certificate', { required: true });
    const certificatePassword = core.getInput('certificate-password', { required: true });
    const certificateName = uuid.v4();
    const certificatePath = `${temp}/${certificateName}.p12`;
    const keychainPath = `${temp}/${certificateName}.keychain-db`;
    core.saveState('certificateName', certificateName);
    await fs.promises.writeFile(certificatePath, certificate, 'base64');
    await exec.exec('security', ['create-keychain', '-p', certificateName, keychainPath]);
    await exec.exec('security', ['set-keychain-settings', '-lut', '21600', keychainPath]);
    await exec.exec('security', ['unlock-keychain', '-p', certificateName, keychainPath]);
    await exec.exec('security', ['import', certificatePath, '-P', certificatePassword, '-A', '-t', 'cert', '-f', 'pkcs12', '-k', keychainPath]);
    await exec.exec('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', certificateName, keychainPath]);
    await exec.exec('security', ['list-keychains', '-d', 'user', '-s', keychainPath]);
}

async function RemoveCertificate() {
    const certificateName = core.getState('certificateName');
    const keychainPath = `${temp}/${certificateName}.keychain-db`;
    await exec.exec('security', ['delete-keychain', keychainPath]);
}

export { ImportCertificate, RemoveCertificate };
