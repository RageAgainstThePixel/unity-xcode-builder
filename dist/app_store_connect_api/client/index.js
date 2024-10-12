"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.urlSearchParamsBodySerializer = exports.jsonBodySerializer = exports.formDataBodySerializer = exports.createConfig = exports.createClient = void 0;
const utils_1 = require("./utils");
const createClient = (config = {}) => {
    let _config = (0, utils_1.mergeConfigs)((0, utils_1.createConfig)(), config);
    const getConfig = () => ({ ..._config });
    const setConfig = (config) => {
        _config = (0, utils_1.mergeConfigs)(_config, config);
        return getConfig();
    };
    const interceptors = (0, utils_1.createInterceptors)();
    const request = async (options) => {
        var _a, _b;
        const opts = {
            ..._config,
            ...options,
            headers: (0, utils_1.mergeHeaders)(_config.headers, options.headers),
        };
        if (opts.body && opts.bodySerializer) {
            opts.body = opts.bodySerializer(opts.body);
        }
        if (!opts.body) {
            opts.headers.delete('Content-Type');
        }
        const url = (0, utils_1.getUrl)({
            baseUrl: (_a = opts.baseUrl) !== null && _a !== void 0 ? _a : '',
            path: opts.path,
            query: opts.query,
            querySerializer: typeof opts.querySerializer === 'function'
                ? opts.querySerializer
                : (0, utils_1.createQuerySerializer)(opts.querySerializer),
            url: opts.url,
        });
        const requestInit = {
            redirect: 'follow',
            ...opts,
        };
        let request = new Request(url, requestInit);
        for (const fn of interceptors.request._fns) {
            request = await fn(request, opts);
        }
        const _fetch = opts.fetch;
        let response = await _fetch(request);
        for (const fn of interceptors.response._fns) {
            response = await fn(response, request, opts);
        }
        const result = {
            request,
            response,
        };
        if (response.ok) {
            if (response.status === 204 ||
                response.headers.get('Content-Length') === '0') {
                return {
                    data: {},
                    ...result,
                };
            }
            if (opts.parseAs === 'stream') {
                return {
                    data: response.body,
                    ...result,
                };
            }
            const parseAs = (_b = (opts.parseAs === 'auto'
                ? (0, utils_1.getParseAs)(response.headers.get('Content-Type'))
                : opts.parseAs)) !== null && _b !== void 0 ? _b : 'json';
            let data = await response[parseAs]();
            if (parseAs === 'json' && opts.responseTransformer) {
                data = await opts.responseTransformer(data);
            }
            return {
                data,
                ...result,
            };
        }
        let error = await response.text();
        try {
            error = JSON.parse(error);
        }
        catch (_c) {
        }
        let finalError = error;
        for (const fn of interceptors.error._fns) {
            finalError = (await fn(error, response, request, opts));
        }
        finalError = finalError || {};
        if (opts.throwOnError) {
            throw finalError;
        }
        return {
            error: finalError,
            ...result,
        };
    };
    return {
        connect: (options) => request({ ...options, method: 'CONNECT' }),
        delete: (options) => request({ ...options, method: 'DELETE' }),
        get: (options) => request({ ...options, method: 'GET' }),
        getConfig,
        head: (options) => request({ ...options, method: 'HEAD' }),
        interceptors,
        options: (options) => request({ ...options, method: 'OPTIONS' }),
        patch: (options) => request({ ...options, method: 'PATCH' }),
        post: (options) => request({ ...options, method: 'POST' }),
        put: (options) => request({ ...options, method: 'PUT' }),
        request,
        setConfig,
        trace: (options) => request({ ...options, method: 'TRACE' }),
    };
};
exports.createClient = createClient;
var utils_2 = require("./utils");
Object.defineProperty(exports, "createConfig", { enumerable: true, get: function () { return utils_2.createConfig; } });
Object.defineProperty(exports, "formDataBodySerializer", { enumerable: true, get: function () { return utils_2.formDataBodySerializer; } });
Object.defineProperty(exports, "jsonBodySerializer", { enumerable: true, get: function () { return utils_2.jsonBodySerializer; } });
Object.defineProperty(exports, "urlSearchParamsBodySerializer", { enumerable: true, get: function () { return utils_2.urlSearchParamsBodySerializer; } });
//# sourceMappingURL=index.js.map