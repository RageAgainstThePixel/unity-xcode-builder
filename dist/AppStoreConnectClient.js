"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadTestFlightBuild = void 0;
const services = require("./app_store_connect_api/services.gen");
const fs = require("fs");
let appStoreConnectClient = null;
class AppStoreConnectClient {
    constructor(credentials) {
        this.bearerTokenGeneratedAt = 0;
        this.api = services;
        if (!credentials) {
            throw new Error('AppStoreConnectOptions is required');
        }
        this.credentials = credentials;
        services.client.setConfig({ baseUrl: 'https://api.appstoreconnect.apple.com' });
        services.client.interceptors.request.use(async (request, _options) => {
            request.headers.set('Authorization', `Bearer ${await this.getToken()}`);
            return request;
        });
    }
    async getToken() {
        const defaultExpirationTime = 600;
        if (this.credentials.appStoreConnectKeyId &&
            this.credentials.appStoreConnectIssuerId &&
            (this.credentials.appStoreConnectKey || this.credentials.appStoreConnectKeyPath)) {
            if (!this.credentials.bearerToken || this.bearerTokenGeneratedAt + defaultExpirationTime * 1000 < Date.now()) {
                if (!this.credentials.appStoreConnectKey && this.credentials.appStoreConnectKeyPath) {
                    this.credentials.appStoreConnectKey = await fs.promises.readFile(this.credentials.appStoreConnectKeyPath, 'utf8');
                }
                this.credentials.bearerToken = await this.credentials.generateAuthToken();
            }
        }
        else {
            throw new Error('Bearer token or private key information is required to generate a token');
        }
        return this.credentials.bearerToken;
    }
}
async function getOrCreateClient(project) {
    if (appStoreConnectClient) {
        return appStoreConnectClient;
    }
    appStoreConnectClient = new AppStoreConnectClient(project.credential);
}
async function getAppId(project) {
    if (project.appId) {
        return project.appId;
    }
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
async function getLatestAppStoreBuildNumber(project) {
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
async function UploadTestFlightBuild(project) {
}
exports.UploadTestFlightBuild = UploadTestFlightBuild;
//# sourceMappingURL=AppStoreConnectClient.js.map