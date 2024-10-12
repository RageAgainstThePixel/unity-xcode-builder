"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConfig = exports.urlSearchParamsBodySerializer = exports.jsonBodySerializer = exports.formDataBodySerializer = exports.createInterceptors = exports.mergeHeaders = exports.mergeConfigs = exports.getUrl = exports.getParseAs = exports.createQuerySerializer = void 0;
const PATH_PARAM_RE = /\{[^{}]+\}/g;
const serializePrimitiveParam = ({ allowReserved, name, value, }) => {
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value === 'object') {
        throw new Error('Deeply-nested arrays/objects aren’t supported. Provide your own `querySerializer()` to handle these.');
    }
    return `${name}=${allowReserved ? value : encodeURIComponent(value)}`;
};
const separatorArrayExplode = (style) => {
    switch (style) {
        case 'label':
            return '.';
        case 'matrix':
            return ';';
        case 'simple':
            return ',';
        default:
            return '&';
    }
};
const separatorArrayNoExplode = (style) => {
    switch (style) {
        case 'form':
            return ',';
        case 'pipeDelimited':
            return '|';
        case 'spaceDelimited':
            return '%20';
        default:
            return ',';
    }
};
const separatorObjectExplode = (style) => {
    switch (style) {
        case 'label':
            return '.';
        case 'matrix':
            return ';';
        case 'simple':
            return ',';
        default:
            return '&';
    }
};
const serializeArrayParam = ({ allowReserved, explode, name, style, value, }) => {
    if (!explode) {
        const joinedValues = (allowReserved ? value : value.map((v) => encodeURIComponent(v))).join(separatorArrayNoExplode(style));
        switch (style) {
            case 'label':
                return `.${joinedValues}`;
            case 'matrix':
                return `;${name}=${joinedValues}`;
            case 'simple':
                return joinedValues;
            default:
                return `${name}=${joinedValues}`;
        }
    }
    const separator = separatorArrayExplode(style);
    const joinedValues = value
        .map((v) => {
        if (style === 'label' || style === 'simple') {
            return allowReserved ? v : encodeURIComponent(v);
        }
        return serializePrimitiveParam({
            allowReserved,
            name,
            value: v,
        });
    })
        .join(separator);
    return style === 'label' || style === 'matrix'
        ? separator + joinedValues
        : joinedValues;
};
const serializeObjectParam = ({ allowReserved, explode, name, style, value, }) => {
    if (value instanceof Date) {
        return `${name}=${value.toISOString()}`;
    }
    if (style !== 'deepObject' && !explode) {
        let values = [];
        Object.entries(value).forEach(([key, v]) => {
            values = [
                ...values,
                key,
                allowReserved ? v : encodeURIComponent(v),
            ];
        });
        const joinedValues = values.join(',');
        switch (style) {
            case 'form':
                return `${name}=${joinedValues}`;
            case 'label':
                return `.${joinedValues}`;
            case 'matrix':
                return `;${name}=${joinedValues}`;
            default:
                return joinedValues;
        }
    }
    const separator = separatorObjectExplode(style);
    const joinedValues = Object.entries(value)
        .map(([key, v]) => serializePrimitiveParam({
        allowReserved,
        name: style === 'deepObject' ? `${name}[${key}]` : key,
        value: v,
    }))
        .join(separator);
    return style === 'label' || style === 'matrix'
        ? separator + joinedValues
        : joinedValues;
};
const defaultPathSerializer = ({ path, url: _url }) => {
    let url = _url;
    const matches = _url.match(PATH_PARAM_RE);
    if (matches) {
        for (const match of matches) {
            let explode = false;
            let name = match.substring(1, match.length - 1);
            let style = 'simple';
            if (name.endsWith('*')) {
                explode = true;
                name = name.substring(0, name.length - 1);
            }
            if (name.startsWith('.')) {
                name = name.substring(1);
                style = 'label';
            }
            else if (name.startsWith(';')) {
                name = name.substring(1);
                style = 'matrix';
            }
            const value = path[name];
            if (value === undefined || value === null) {
                continue;
            }
            if (Array.isArray(value)) {
                url = url.replace(match, serializeArrayParam({ explode, name, style, value }));
                continue;
            }
            if (typeof value === 'object') {
                url = url.replace(match, serializeObjectParam({
                    explode,
                    name,
                    style,
                    value: value,
                }));
                continue;
            }
            if (style === 'matrix') {
                url = url.replace(match, `;${serializePrimitiveParam({
                    name,
                    value: value,
                })}`);
                continue;
            }
            const replaceValue = encodeURIComponent(style === 'label' ? `.${value}` : value);
            url = url.replace(match, replaceValue);
        }
    }
    return url;
};
const createQuerySerializer = ({ allowReserved, array, object, } = {}) => {
    const querySerializer = (queryParams) => {
        let search = [];
        if (queryParams && typeof queryParams === 'object') {
            for (const name in queryParams) {
                const value = queryParams[name];
                if (value === undefined || value === null) {
                    continue;
                }
                if (Array.isArray(value)) {
                    search = [
                        ...search,
                        serializeArrayParam({
                            allowReserved,
                            explode: true,
                            name,
                            style: 'form',
                            value,
                            ...array,
                        }),
                    ];
                    continue;
                }
                if (typeof value === 'object') {
                    search = [
                        ...search,
                        serializeObjectParam({
                            allowReserved,
                            explode: true,
                            name,
                            style: 'deepObject',
                            value: value,
                            ...object,
                        }),
                    ];
                    continue;
                }
                search = [
                    ...search,
                    serializePrimitiveParam({
                        allowReserved,
                        name,
                        value: value,
                    }),
                ];
            }
        }
        return search.join('&');
    };
    return querySerializer;
};
exports.createQuerySerializer = createQuerySerializer;
const getParseAs = (content) => {
    if (!content) {
        return;
    }
    if (content.startsWith('application/json') || content.endsWith('+json')) {
        return 'json';
    }
    if (content === 'multipart/form-data') {
        return 'formData';
    }
    if (['application/', 'audio/', 'image/', 'video/'].some((type) => content.startsWith(type))) {
        return 'blob';
    }
    if (content.startsWith('text/')) {
        return 'text';
    }
};
exports.getParseAs = getParseAs;
const getUrl = ({ baseUrl, path, query, querySerializer, url: _url, }) => {
    const pathUrl = _url.startsWith('/') ? _url : `/${_url}`;
    let url = baseUrl + pathUrl;
    if (path) {
        url = defaultPathSerializer({ path, url });
    }
    let search = query ? querySerializer(query) : '';
    if (search.startsWith('?')) {
        search = search.substring(1);
    }
    if (search) {
        url += `?${search}`;
    }
    return url;
};
exports.getUrl = getUrl;
const mergeConfigs = (a, b) => {
    var _a;
    const config = { ...a, ...b };
    if ((_a = config.baseUrl) === null || _a === void 0 ? void 0 : _a.endsWith('/')) {
        config.baseUrl = config.baseUrl.substring(0, config.baseUrl.length - 1);
    }
    config.headers = (0, exports.mergeHeaders)(a.headers, b.headers);
    return config;
};
exports.mergeConfigs = mergeConfigs;
const mergeHeaders = (...headers) => {
    const mergedHeaders = new Headers();
    for (const header of headers) {
        if (!header || typeof header !== 'object') {
            continue;
        }
        const iterator = header instanceof Headers ? header.entries() : Object.entries(header);
        for (const [key, value] of iterator) {
            if (value === null) {
                mergedHeaders.delete(key);
            }
            else if (Array.isArray(value)) {
                for (const v of value) {
                    mergedHeaders.append(key, v);
                }
            }
            else if (value !== undefined) {
                mergedHeaders.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
            }
        }
    }
    return mergedHeaders;
};
exports.mergeHeaders = mergeHeaders;
class Interceptors {
    constructor() {
        this._fns = [];
    }
    clear() {
        this._fns = [];
    }
    exists(fn) {
        return this._fns.indexOf(fn) !== -1;
    }
    eject(fn) {
        const index = this._fns.indexOf(fn);
        if (index !== -1) {
            this._fns = [...this._fns.slice(0, index), ...this._fns.slice(index + 1)];
        }
    }
    use(fn) {
        this._fns = [...this._fns, fn];
    }
}
const createInterceptors = () => ({
    error: new Interceptors(),
    request: new Interceptors(),
    response: new Interceptors(),
});
exports.createInterceptors = createInterceptors;
const serializeFormDataPair = (data, key, value) => {
    if (typeof value === 'string' || value instanceof Blob) {
        data.append(key, value);
    }
    else {
        data.append(key, JSON.stringify(value));
    }
};
exports.formDataBodySerializer = {
    bodySerializer: (body) => {
        const data = new FormData();
        Object.entries(body).forEach(([key, value]) => {
            if (value === undefined || value === null) {
                return;
            }
            if (Array.isArray(value)) {
                value.forEach((v) => serializeFormDataPair(data, key, v));
            }
            else {
                serializeFormDataPair(data, key, value);
            }
        });
        return data;
    },
};
exports.jsonBodySerializer = {
    bodySerializer: (body) => JSON.stringify(body),
};
const serializeUrlSearchParamsPair = (data, key, value) => {
    if (typeof value === 'string') {
        data.append(key, value);
    }
    else {
        data.append(key, JSON.stringify(value));
    }
};
exports.urlSearchParamsBodySerializer = {
    bodySerializer: (body) => {
        const data = new URLSearchParams();
        Object.entries(body).forEach(([key, value]) => {
            if (value === undefined || value === null) {
                return;
            }
            if (Array.isArray(value)) {
                value.forEach((v) => serializeUrlSearchParamsPair(data, key, v));
            }
            else {
                serializeUrlSearchParamsPair(data, key, value);
            }
        });
        return data;
    },
};
const defaultQuerySerializer = (0, exports.createQuerySerializer)({
    allowReserved: false,
    array: {
        explode: true,
        style: 'form',
    },
    object: {
        explode: true,
        style: 'deepObject',
    },
});
const defaultHeaders = {
    'Content-Type': 'application/json',
};
const createConfig = (override = {}) => ({
    ...exports.jsonBodySerializer,
    baseUrl: '',
    fetch: globalThis.fetch,
    headers: defaultHeaders,
    parseAs: 'auto',
    querySerializer: defaultQuerySerializer,
    ...override,
});
exports.createConfig = createConfig;
//# sourceMappingURL=utils.js.map