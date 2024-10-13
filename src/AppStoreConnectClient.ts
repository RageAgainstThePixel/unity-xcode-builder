import { AppStoreConnectClient, AppStoreConnectOptions } from '@rage-against-the-pixel/app-store-connect-api';
import { XcodeProject } from './XcodeProject';

let appStoreConnectClient: AppStoreConnectClient | null = null;

async function getOrCreateClient(project: XcodeProject) {
    if (appStoreConnectClient) { return appStoreConnectClient; }
    if (!project.credential) {
        throw new Error('Missing AppleCredential');
    }
    const options: AppStoreConnectOptions = {
        issuerId: project.credential.appStoreConnectIssuerId,
        privateKeyId: project.credential.appStoreConnectKeyId,
        privateKey: project.credential.appStoreConnectKey,
    };
    appStoreConnectClient = new AppStoreConnectClient(options);
}

async function getAppId(project: XcodeProject) {
    if (project.appId) { return project.appId; }
    const { data: response, error } = await appStoreConnectClient.api.appsGetCollection({
        query: {
            'filter[bundleId]': [project.bundleId],
        }
    });
    if (error) {
        throw new Error(`Error fetching apps: ${JSON.stringify(error)}`);
    }
    if (!response) {
        throw new Error(`No apps found for bundle id ${project.bundleId}`);
    }
    if (response.data.length === 0) {
        throw new Error(`No apps found for bundle id ${project.bundleId}`);
    }
    project.appId = response.data[0].id;
    return project.appId;
}

async function getLatestAppStoreBuildNumber(project: XcodeProject): Promise<number> {
    await getAppId(project);
    const { data: response, error } = await appStoreConnectClient.api.buildsGetCollection({
        query: {
            'fields[apps]': ['bundleId'],
            'filter[app]': [project.bundleId],
            sort: ['-version'],
            limit: 1,
        }
    });
    if (error) {
        throw new Error(`Error fetching builds: ${JSON.stringify(error)}`);
    }
    if (!response) {
        return 0;
    }
    if (response.data.length === 0) {
        return 0;
    }
    return Number(response.data[0].attributes.version);
}

async function UploadTestFlightBuild(project: XcodeProject) {
    // await getOrCreateClient(project);
    // const lastBuildNumber = await getLatestAppStoreBuildNumber(project);
    // const nextBuildNumber = lastBuildNumber + 1;
    // const { data: response, error } = await appStoreConnectClient.api.build
}

export {
    UploadTestFlightBuild
}