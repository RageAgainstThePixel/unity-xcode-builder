import {
    AppStoreConnectClient,
    AppStoreConnectOptions
} from '@rage-against-the-pixel/app-store-connect-api';
import { XcodeProject } from './XcodeProject';
import {
    BuildsGetCollectionData,
    Build,
    BetaBuildLocalizationsGetCollectionData,
    BetaBuildLocalizationUpdateRequest,
    PrereleaseVersion,
    PreReleaseVersionsGetCollectionData,
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
    const prereleaseVersion = await getLastPreReleaseVersion(project);
    const build = await getPreReleaseBuild(prereleaseVersion);
    const buildVersion = build.attributes.version;
    if (!buildVersion) {
        throw new Error(`No build version found!\n${JSON.stringify(build, null, 2)}`);
    }
    return Number(buildVersion);
}

function reMapPlatform(project: XcodeProject): ('IOS' | 'MAC_OS' | 'TV_OS' | 'VISION_OS') {
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

async function getLastPreReleaseVersion(project: XcodeProject): Promise<PrereleaseVersion> {
    if (!project.appId) { project = await GetAppId(project); }
    const preReleaseVersionRequest: PreReleaseVersionsGetCollectionData = {
        query: {
            'filter[app]': [project.appId],
            'filter[platform]': [reMapPlatform(project)],
            'filter[version]': [project.versionString],
            sort: ['-version'],
            limit: 1,
        }
    };
    const { data: preReleaseResponse, error: preReleaseError } = await appStoreConnectClient.api.preReleaseVersionsGetCollection(preReleaseVersionRequest);
    if (preReleaseError) {
        throw new Error(`Error fetching pre-release versions: ${JSON.stringify(preReleaseError, null, 2)}`);
    }
    if (!preReleaseResponse || preReleaseResponse.data.length === 0) {
        return null;
    }
    return preReleaseResponse.data[0];
}

async function getPreReleaseBuild(prereleaseVersion: PrereleaseVersion, buildVersion: number | null = null): Promise<Build> {
    const buildsRequest: BuildsGetCollectionData = {
        query: {
            'filter[preReleaseVersion]': [prereleaseVersion.id],
            sort: ['-version'],
            limit: 1,
        }
    };
    if (buildVersion) {
        buildsRequest.query['filter[version]'] = [buildVersion.toString()];
    }
    const { data: buildsResponse, error: buildsError } = await appStoreConnectClient.api.buildsGetCollection(buildsRequest);
    if (buildsError) {
        throw new Error(`Error fetching builds: ${JSON.stringify(buildsError, null, 2)}`);
    }
    if (!buildsResponse || buildsResponse.data.length === 0) {
        throw new Error(`No builds found ${JSON.stringify(buildsResponse, null, 2)}`);
    }
    return buildsResponse.data[0];
}

async function getBetaBuildLocalization(prereleaseVersion: PrereleaseVersion, buildVersion: number) {
    const build = await getPreReleaseBuild(prereleaseVersion, buildVersion);
    const betaBuildLocalizationRequest: BetaBuildLocalizationsGetCollectionData = {
        query: {
            'filter[build]': [build.id],
            limit: 1,
        }
    };
    const { data: betaBuildLocalizationResponse, error: betaBuildLocalizationError } = await appStoreConnectClient.api.betaBuildLocalizationsGetCollection(betaBuildLocalizationRequest);
    if (betaBuildLocalizationError) {
        throw new Error(`Error fetching beta build localization: ${JSON.stringify(betaBuildLocalizationError, null, 2)}`);
    }
    if (!betaBuildLocalizationResponse || betaBuildLocalizationResponse.data.length === 0) {
        throw new Error(`No beta build localization found ${JSON.stringify(betaBuildLocalizationResponse, null, 2)}`);
    }
    return betaBuildLocalizationResponse.data[0];
}

async function UpdateTestDetails(project: XcodeProject, buildVersion: number, whatsNew: string): Promise<void> {
    await getOrCreateClient(project);
    const prereleaseVersion = await getLastPreReleaseVersion(project);
    const betaBuildLocalization = await getBetaBuildLocalization(prereleaseVersion, buildVersion);
    const updateBuildLocalization: BetaBuildLocalizationUpdateRequest = {
        data: {
            id: betaBuildLocalization.id,
            type: 'betaBuildLocalizations',
            attributes: {
                whatsNew: whatsNew
            }
        }
    };
    const { error: updateError } = await appStoreConnectClient.api.betaBuildLocalizationsUpdateInstance({
        path: {
            id: betaBuildLocalization.id
        },
        body: updateBuildLocalization
    });
    if (updateError) {
        throw new Error(`Error updating beta build localization: ${JSON.stringify(updateError, null, 2)}`);
    }
}

export {
    GetAppId,
    GetLatestBundleVersion,
    UpdateTestDetails
}