import {
    AppStoreConnectClient,
    AppStoreConnectOptions
} from '@rage-against-the-pixel/app-store-connect-api';
import { XcodeProject } from './XcodeProject';
import {
    Build,
    BuildsGetCollectionData,
    BetaBuildLocalization,
    BetaBuildLocalizationUpdateRequest,
    BetaBuildLocalizationsGetCollectionData,
    PrereleaseVersion,
    PreReleaseVersionsGetCollectionData,
    BetaBuildLocalizationCreateRequest,
} from '@rage-against-the-pixel/app-store-connect-api/dist/app_store_connect_api';
import core = require('@actions/core');

let appStoreConnectClient: AppStoreConnectClient | null = null;

class UnauthorizedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnauthorizedError';
    }
}

async function getOrCreateClient(project: XcodeProject) {
    if (appStoreConnectClient) { return appStoreConnectClient; }
    if (!project.credential) {
        throw new UnauthorizedError('Missing AppleCredential!');
    }
    const options: AppStoreConnectOptions = {
        issuerId: project.credential.appStoreConnectIssuerId,
        privateKeyId: project.credential.appStoreConnectKeyId,
        privateKey: project.credential.appStoreConnectKey,
    };
    appStoreConnectClient = new AppStoreConnectClient(options);
}

function checkAuthError(error: any) {
    if (error && error.errors) {
        for (const e of error.errors) {
            if (e.status === '401') {
                throw new UnauthorizedError(e.message);
            }
        }
    }
}

async function GetAppId(project: XcodeProject): Promise<XcodeProject> {
    if (project.appId) { return project; }
    await getOrCreateClient(project);
    const { data: response, error } = await appStoreConnectClient.api.appsGetCollection({
        query: { 'filter[bundleId]': [project.bundleId] }
    });
    if (error) {
        checkAuthError(error);
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
            include: ['builds'],
            sort: ['-version'],
            limit: 1,
        }
    };
    core.info(`/preReleaseVersions?${JSON.stringify(preReleaseVersionRequest.query)}`);
    const { data: preReleaseResponse, error: preReleaseError } = await appStoreConnectClient.api.preReleaseVersionsGetCollection(preReleaseVersionRequest);
    const responseJson = JSON.stringify(preReleaseResponse, null, 2);
    if (preReleaseError) {
        checkAuthError(preReleaseError);
        throw new Error(`Error fetching pre-release versions: ${responseJson}`);
    }
    core.info(responseJson);
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
        }
    };
    if (buildVersion) {
        buildsRequest.query['filter[version]'] = [buildVersion.toString()];
        buildsRequest.query['filter[processingState]'] = ['VALID'];
    }
    core.info(`/builds?${JSON.stringify(buildsRequest.query)}`);
    const { data: buildsResponse, error: buildsError } = await appStoreConnectClient.api.buildsGetCollection(buildsRequest);
    const responseJson = JSON.stringify(buildsResponse, null, 2);
    if (buildsError) {
        checkAuthError(buildsError);
        throw new Error(`Error fetching builds: ${JSON.stringify(buildsError, null, 2)}`);
    }
    if (!buildsResponse || buildsResponse.data.length === 0) {
        throw new Error(`No builds found! ${responseJson}`);
    }
    core.info(responseJson);
    return buildsResponse.data[0];
}

async function getBetaBuildLocalization(build: Build): Promise<BetaBuildLocalization> {
    const betaBuildLocalizationRequest: BetaBuildLocalizationsGetCollectionData = {
        query: {
            'filter[build]': [build.id],
            "filter[locale]": ["en-US"],
            'fields[betaBuildLocalizations]': ['whatsNew']
        }
    };
    core.info(`/betaBuildLocalizations?${JSON.stringify(betaBuildLocalizationRequest.query)}`);
    const { data: betaBuildLocalizationResponse, error: betaBuildLocalizationError } = await appStoreConnectClient.api.betaBuildLocalizationsGetCollection(betaBuildLocalizationRequest);
    const responseJson = JSON.stringify(betaBuildLocalizationResponse, null, 2);
    if (betaBuildLocalizationError) {
        checkAuthError(betaBuildLocalizationError);
        throw new Error(`Error fetching beta build localization: ${JSON.stringify(betaBuildLocalizationError, null, 2)}`);
    }
    if (!betaBuildLocalizationResponse || betaBuildLocalizationResponse.data.length === 0) {
        return null;
    }
    core.info(responseJson);
    return betaBuildLocalizationResponse.data[0];
}

async function createBetaBuildLocalization(build: Build, whatsNew: string): Promise<BetaBuildLocalization> {
    const betaBuildLocalizationRequest: BetaBuildLocalizationCreateRequest = {
        data: {
            type: 'betaBuildLocalizations',
            attributes: {
                whatsNew: whatsNew,
                locale: 'en-US'
            },
            relationships: {
                build: {
                    data: {
                        id: build.id,
                        type: 'builds'
                    }
                }
            }
        }
    }
    core.info(`/betaBuildLocalizations\n${JSON.stringify(betaBuildLocalizationRequest, null, 2)}`);
    const { data: response, error: responseError } = await appStoreConnectClient.api.betaBuildLocalizationsCreateInstance({
        body: betaBuildLocalizationRequest
    });
    const responseJson = JSON.stringify(betaBuildLocalizationRequest, null, 2);
    if (responseError) {
        checkAuthError(responseError);
        throw new Error(`Error creating beta build localization: ${JSON.stringify(responseError, null, 2)}`);
    }
    core.info(responseJson);
    return response.data;
}

async function updateBetaBuildLocalization(betaBuildLocalization: BetaBuildLocalization, whatsNew: string): Promise<BetaBuildLocalization> {
    const updateBuildLocalization: BetaBuildLocalizationUpdateRequest = {
        data: {
            id: betaBuildLocalization.id,
            type: 'betaBuildLocalizations',
            attributes: {
                whatsNew: whatsNew
            }
        }
    };
    core.info(`/betaBuildLocalizations/${betaBuildLocalization.id}\n${JSON.stringify(updateBuildLocalization, null, 2)}`);
    const { error: updateError } = await appStoreConnectClient.api.betaBuildLocalizationsUpdateInstance({
        path: { id: betaBuildLocalization.id },
        body: updateBuildLocalization
    });
    const responseJson = JSON.stringify(updateBuildLocalization, null, 2);
    if (updateError) {
        checkAuthError(updateError);
        throw new Error(`Error updating beta build localization: ${JSON.stringify(updateError, null, 2)}`);
    }
    core.info(responseJson);
    return betaBuildLocalization;
}

async function pollForValidBuild(project: XcodeProject, buildVersion: number, whatsNew: string, maxRetries: number = 10, interval: number = 30): Promise<BetaBuildLocalization> {
    let retries = 0;
    while (retries < maxRetries) {
        core.info(`Polling for build... Attempt ${++retries}/${maxRetries}`);
        try {
            const prereleaseVersion = await getLastPreReleaseVersion(project);
            const build = await getPreReleaseBuild(prereleaseVersion, buildVersion);
            if (!build || build.attributes?.processingState !== 'VALID') { continue; }
            const betaBuildLocalization = await getBetaBuildLocalization(build);
            if (!betaBuildLocalization) {
                return await createBetaBuildLocalization(build, whatsNew);
            } else {
                return await updateBetaBuildLocalization(betaBuildLocalization, whatsNew);
            }
        } catch (error) {
            core.warning(error.message);
        }
        await new Promise(resolve => setTimeout(resolve, interval * 1000));
    }
    throw new Error('Timed out waiting for valid build!');
}

async function UpdateTestDetails(project: XcodeProject, buildVersion: number, whatsNew: string): Promise<void> {
    await getOrCreateClient(project);
    await pollForValidBuild(project, buildVersion, whatsNew);
}

export {
    GetAppId,
    GetLatestBundleVersion,
    UpdateTestDetails,
    UnauthorizedError
}