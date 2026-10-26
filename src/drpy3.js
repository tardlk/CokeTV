import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {register} from 'node:module';
import {createHash, randomBytes} from 'node:crypto';
import axios from 'axios';
import iconv from 'iconv-lite';
import syncFetch from 'sync-fetch';
import {jsoup} from './host/htmlParser.js';
import {ENV} from './host/utils/env.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const textAsset = /\.(?:[cm]?js|json|txt|html|xml|conf)$/i;

function requestOptions(url, options = {}) {
    const o = options || {}, headers = {...o.headers};
    const method = String(o.method || 'GET').toUpperCase();
    let body = o.body;
    if (o.data && ['GET', 'HEAD'].includes(method)) {
        const target = new URL(url);
        for (const [key, value] of Object.entries(o.data)) target.searchParams.set(key, String(value));
        url = target.href;
    } else if (body == null && o.data) {
        const key = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
        body = /json/i.test(headers[key] || '') ? JSON.stringify(o.data) : new URLSearchParams(o.data).toString();
        if (!key) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    return {url: String(url), method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body, timeout: Math.min(Math.max(Number(o.timeout) || 5000, 1), 60000)};
}
function responseValue(bytes, headers, status, options = {}) {
    const flat = {status: `HTTP/1.1 ${status}`};
    for (const [key, value] of Object.entries(headers)) flat[key] = Array.isArray(value) ? value.join(', ') : value;
    const encoding = String(flat['content-type'] || '').match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || options.encoding || 'utf-8';
    const content = options.buffer === 1 ? new Uint8Array(bytes) : options.buffer === 2 ? bytes.toString('base64') : iconv.decode(bytes, iconv.encodingExists(encoding) ? encoding : 'utf-8');
    return {content, headers: flat};
}
export async function drpy3Request(url, options = {}) {
    options ||= {};
    try {
        const config = requestOptions(url, options);
        const response = await axios({url: config.url, method: config.method, headers: config.headers, data: config.body,
            timeout: config.timeout, responseType: 'arraybuffer', maxRedirects: options.redirect === 0 ? 0 : 5,
            beforeRedirect: options => {
                for (const key of Object.keys(options.headers || {})) if (key.toLowerCase() === 'x-drpy-runtime') delete options.headers[key];
            },
            maxContentLength: 64 * 1024 * 1024, validateStatus: () => true});
        return responseValue(Buffer.from(response.data), response.headers, response.status, options);
    } catch (error) { return {content: '', headers: {error: error.message}}; }
}
export function drpy3SyncRequest(url, options = {}) {
    options ||= {};
    try {
        const config = requestOptions(url, options);
        const response = syncFetch(config.url, {method: config.method, headers: config.headers, body: config.body,
            timeout: config.timeout, redirect: options.redirect === 0 ? 'manual' : 'follow', follow: 5, size: 64 * 1024 * 1024});
        return responseValue(response.buffer(), response.headers.raw(), response.status, options);
    } catch (error) { return {content: '', headers: {error: error.message}}; }
}

function persistentStore(root) {
    const directory = path.join(root, 'data', 'drpy3');
    const filename = ns => path.join(directory, `${hash(String(ns))}.json`);
    const read = ns => {
        try { return JSON.parse(fs.readFileSync(filename(ns), 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    };
    const write = (ns, data) => {
        fs.mkdirSync(directory, {recursive: true, mode: 0o700});
        const file = filename(ns), temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
        try { fs.writeFileSync(temporary, JSON.stringify(data), {mode: 0o600, flag: 'wx'}); fs.renameSync(temporary, file); }
        finally { fs.rmSync(temporary, {force: true}); }
    };
    return {
        get(ns, key, fallback) { const data = read(ns); return Object.hasOwn(data, key) ? data[key] : fallback; },
        set(ns, key, value) { const data = read(ns); Object.defineProperty(data, key, {value, enumerable: true, configurable: true, writable: true}); write(ns, data); return value; },
        delete(ns, key) { const data = read(ns); delete data[key]; write(ns, data); },
    };
}

// Only constructed inside the existing worker; CPU/WASM and source globals stay off the HTTP process.
export async function createDrpy3Engine(root) {
    const runtimeUrl = pathToFileURL(path.join(root, 'libs/drpy3/drpy3.js')).href;
    register(new URL('./drpy3-loader.mjs', import.meta.url), {data: {
        runtimeUrl, sourceUrl: pathToFileURL(fs.realpathSync(path.join(root, 'spider/js_dr3')) + path.sep).href,
    }});
    const {Runtime, exposeRuntimeGlobals} = await import(runtimeUrl);
    globalThis.ENV = ENV;
    const store = persistentStore(root), entries = new Map();
    async function init(file, env, refresh = false) {
        const key = env.sourceInstanceId || file;
        const code = fs.readFileSync(file, 'utf8');
        const signature = hash(code + '\0' + (env.ext || ''));
        let entry = entries.get(key);
        if (!refresh && entry?.signature === signature) {
            entry.env = env;
            entry.runtime.hostEnv.env = env;
            return entry.source;
        }
        entry = {env, signature};
        const request = (url, options = {}, sync = false) => {
            let internal = false;
            try {
                const target = new URL(url), own = new URL(entry.env.requestHost);
                if (target.origin === own.origin) {
                    const mount = own.pathname.replace(/\/$/, '');
                    if (mount && target.pathname.startsWith(mount + '/')) target.pathname = target.pathname.slice(mount.length);
                    target.protocol = 'http:';
                    target.host = `127.0.0.1:${entry.env.localPort || 54058}`;
                    url = target.href;
                    options = {...options, headers: {...options?.headers, 'x-drpy-runtime': process.env.DRPY_INTERNAL_KEY}};
                    internal = true;
                }
            } catch { /* The standard request function returns its normal error response. */ }
            return sync ? drpy3SyncRequest(url, internal ? {...options, redirect: 0} : options) : drpy3Request(url, options);
        };
        const host = {
            engine: 'node', version: process.version, req: (url, options) => request(url, options), syncReq: (url, options) => request(url, options, true),
            pdfh: (html, parse, base = '') => new jsoup(base).pdfh(html, parse, base),
            pdfa: (html, parse) => new jsoup('').pdfa(html, parse),
            pd: (html, parse, base = '') => new jsoup(base).pd(html, parse, base),
            pdfl: (html, parse, text, url, base = '') => new jsoup(base).pdfl(html, parse, text, url, base),
            loadAsset: relative => {
                const target = path.resolve(path.dirname(file), relative);
                return textAsset.test(target) ? fs.readFileSync(target, 'utf8') : new Uint8Array(fs.readFileSync(target));
            },
            // Query propagates through the source graph, isolating module state between instances and refreshes.
            evalModule: () => {
                const url = pathToFileURL(file);
                url.searchParams.set('coketvDr3', `${hash(String(key))}-${signature}-${randomBytes(6).toString('hex')}`);
                return import(url.href).then(module => {
                    if (!module.default || typeof module.default !== 'object') throw new Error('drpy3 源必须 default 导出对象');
                    return module;
                });
            },
            store, log: (...args) => console.log(...args), getProxy: () => entry.env.proxyUrl,
            env, action: true,
        };
        entry.runtime = new Runtime(host);
        exposeRuntimeGlobals(entry.runtime);
        const source = await entry.runtime.load(code, {key, path: path.basename(file), extend: env.ext,
            drpy3: true, ...(/\brequire\s*\(/.test(code) && !/\bcreateRequire\b/.test(code) ? {mode: 'cjs'} : {})});
        if (!source.def || (!source.def.meta && !source.def.rule)) throw new Error('请使用 drpy3 的 meta/rule 源格式');
        await source.init(env.ext || '');
        entry.source = source;
        entries.set(key, entry);
        return source;
    }
    const engine = {init};
    for (const method of ['home', 'category', 'search', 'proxy', 'action']) {
        engine[method] = async (file, env, ...args) => (await init(file, env))[method](...args);
    }
    engine.play = async (file, env, ...args) => {
        const result = await (await init(file, env)).play(...args);
        // TVBox can retain every named quality; the shared web/Emby path needs a primary URL.
        if (result && !result.url && Array.isArray(result.urls)) {
            const url = result.urls.find((value, index) => index % 2 === 1 && typeof value === 'string' && value);
            if (url) return {...result, url};
        }
        return result;
    };
    engine.homeVod = async (file, env) => {
        const result = await (await init(file, env)).homeVod();
        return Array.isArray(result) ? result : result?.list || [];
    };
    engine.detail = async (file, env, ids) => {
        const source = await init(file, env), list = [];
        for (const id of ids) list.push(...((await source.detail(id))?.list || []));
        return {list};
    };
    return engine;
}
