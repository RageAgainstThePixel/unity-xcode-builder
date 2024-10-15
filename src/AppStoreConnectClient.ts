import {
    AppStoreConnectClient,
    AppStoreConnectOptions
} from '@rage-against-the-pixel/app-store-connect-api';
import { XcodeProject } from './XcodeProject';
import {
    BuildsGetCollectionData,
    PreReleaseVersionsGetCollectionData
} from '@rage-against-the-pixel/app-store-connect-api/dist/app_store_connect_api';

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

async function GetAppId(project: XcodeProject): Promise<XcodeProject> {
    if (project.appId) { return project; }
    await getOrCreateClient(project);
    const { data: response, error } = await appStoreConnectClient.api.appsGetCollection({
        query: { 'filter[bundleId]': [project.bundleId] }
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
    return project;
}

async function GetLatestBundleVersion(project: XcodeProject): Promise<number> {
    await getOrCreateClient(project);
    if (!project.appId) {
        project = await GetAppId(project);
    }
    const preReleaseVersionRequest: PreReleaseVersionsGetCollectionData = {
        query: {
            'filter[app]': [project.appId],
            'filter[platform]': [mapPlatform(project)],
            'filter[version]': [project.versionString],
            sort: ['-version'],
            limit: 1,
        }
    };
    const { data: preReleaseResponse, error: preReleaseError } = await appStoreConnectClient.api.preReleaseVersionsGetCollection(preReleaseVersionRequest);
    if (preReleaseError) {
        throw new Error(`Error fetching pre-release versions: ${JSON.stringify(preReleaseError)}`);
    }
    if (!preReleaseResponse || preReleaseResponse.data.length === 0) {
        throw new Error(`No pre-release versions found ${JSON.stringify(preReleaseResponse)}`);
    }
    const preReleaseId = preReleaseResponse.data[0].id;
    const buildsRequest: BuildsGetCollectionData = {
        query: {
            "filter[preReleaseVersion]": [preReleaseId],
            include: ['preReleaseVersion'],
            sort: ['-version'],
            limit: 1,
        }
    };
    const { data: buildsResponse, error: buildsError } = await appStoreConnectClient.api.buildsGetCollection(buildsRequest);
    if (buildsError) {
        throw new Error(`Error fetching builds: ${JSON.stringify(buildsError)}`);
    }
    if (!buildsResponse || buildsResponse.data.length === 0) {
        throw new Error(`No builds found ${JSON.stringify(buildsResponse)}`);
    }
    const buildVersion = buildsResponse.data[0].attributes.version;
    if (!buildVersion) {
        throw new Error(`No build version found ${JSON.stringify(buildsResponse)}`);
    }
    return Number(buildVersion);
}

function mapPlatform(project: XcodeProject) {
    switch (project.platform) {
        case 'iOS':
            return 'IOS';
        case 'macOS':
            return 'MAC_OS';
        case 'tvOS':
            return 'TV_OS';
        case 'visionOS':
            return 'VISION_OS';
        default:
            throw new Error(`Unsupported platform: ${project.platform}`);
    }
}

export {
    GetAppId,
    GetLatestBundleVersion
}