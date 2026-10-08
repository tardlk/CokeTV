'use strict';

// CokeTV's independently implemented CatVod/Miraplay connection bundle.
// Only built-in Node modules: the mobile host does not install dependencies.
const http = require('http');
const https = require('https');
let active = null;
let lifecycle = Promise.resolve();
const fail = (message, statusCode = 502) => Object.assign(new Error(message), {statusCode});
const webUrl = value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail('连接地址必须是 HTTP / HTTPS 地址', 400);
    return url;
};
function send(response, data, status = 200) {
    if (response.destroyed || response.headersSent) return;
    response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
    response.end(JSON.stringify(data));
}
async function body(request) {
    let size = 0; const chunks = [];
    for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) throw fail('请求体超过限制', 413);
        chunks.push(chunk);
    }
    let result;
    try { result = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
    catch { throw fail('请求体必须是 JSON 对象', 400); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw fail('请求体必须是 JSON 对象', 400);
    return result;
}
function requestJson(context, target, data, timeout = context.timeout) {
    return new Promise((resolve, reject) => {
        if (context.closed) return reject(fail('连接程序已停止', 503));
        const url = webUrl(target), payload = data === undefined ? undefined : Buffer.from(JSON.stringify(data));
        const outgoing = (url.protocol === 'https:' ? https : http).request(url, {
            method: payload ? 'POST' : 'GET', agent: false,
            headers: {'Accept': 'application/json', ...(payload ? {'Content-Type': 'application/json', 'Content-Length': payload.length} : {})},
        }, response => {
            const chunks = []; let size = 0;
            response.on('data', chunk => {
                size += chunk.length;
                if (size > 8 * 1024 * 1024) outgoing.destroy(fail('CokeTV 返回内容超过限制'));
                else chunks.push(chunk);
            });
            response.on('error', () => reject(fail('CokeTV 响应中断')));
            response.on('end', () => {
                let result;
                try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
                catch { reject(fail('CokeTV 没有返回有效的接口数据')); return; }
                if (response.statusCode < 200 || response.statusCode >= 300) reject(fail(result?.error || 'CokeTV 请求失败', response.statusCode));
                else resolve(result);
            });
        });
        context.requests.add(outgoing);
        const timer = setTimeout(() => outgoing.destroy(fail('CokeTV 请求超时，请重试或切换源', 504)), timeout);
        outgoing.on('error', error => reject(error.statusCode ? error : fail('无法连接 CokeTV，请检查服务地址和网络')));
        outgoing.on('close', () => { clearTimeout(timer); context.requests.delete(outgoing); });
        // Do not follow redirects: credentials stay at the configured endpoint.
        outgoing.end(payload);
    });
}
async function sniff(context, media, prefix) {
    const port = typeof globalThis.catDartServerPort === 'function' ? Number(globalThis.catDartServerPort()) : 0;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw fail('此源需要网页解析；当前播放器未提供嗅探能力，请在 CokeTV 配置解析或切换源', 422);
    const result = await requestJson(context, `http://127.0.0.1:${port}/msg`, {
        action: 'sniff', prefix, opt: {url: media.url, timeout: 10000, rule: 'https?://[^\\s]+?\\.(m3u8|mp4)(\\?[^\\s]*)?'},
    }, 15000);
    if (!result?.url) throw fail('网页嗅探没有取得视频，请配置解析或切换源', 422);
    const headers = {};
    for (const [key, value] of Object.entries(result.headers || {})) {
        try {
            http.validateHeaderName(key); http.validateHeaderValue(key, value);
            if (typeof value === 'string' && !/^(host|connection|content-length|transfer-encoding|x-drpy-runtime)$/i.test(key)) headers[key] = value;
        } catch {}
    }
    return {parse: 0, url: webUrl(result.url).href, header: headers};
}
async function closeActive() {
    const context = active; active = null;
    if (!context) return;
    context.closed = true;
    for (const request of context.requests) request.destroy(fail('连接程序已停止', 503));
    await new Promise(resolve => {
        context.server.close(resolve);
        for (const socket of context.sockets) socket.destroy();
    });
}
async function open(input = {}) {
    await closeActive();
    const config = input.default || input;
    if (config.version !== 1) throw fail('猫影视连接配置版本不支持，请重新导入订阅', 400);
    const endpoint = webUrl(config.endpoint).href.replace(/\/$/, '');
    const context = {endpoint, timeout: 35000, requests: new Set(), sockets: new Set(), server: null, closed: false};
    const handle = async (request, response) => {
        try {
            const url = new URL(request.url, 'http://127.0.0.1');
            if (url.pathname === '/check' && request.method === 'GET') return send(response, {run: !context.closed});
            if (url.pathname === '/config' && request.method === 'GET') {
                const manifest = await requestJson(context, endpoint + '/manifest');
                if (!Array.isArray(manifest?.sites) || manifest.sites.some(site => !site || !/^[A-Za-z0-9_-]+$/.test(site.id) || typeof site.name !== 'string')) throw fail('CokeTV 返回的站点列表无效');
                context.timeout = Math.min(310000, Math.max(35000, Number(manifest.timeout) + 5000 || 35000));
                return send(response, {video: {sites: manifest.sites.map(site => ({
                    key: 'nodejs_coketv_' + site.id, name: site.name, type: 3,
                    api: '/spider/coketv_' + site.id + '/3', searchable: site.searchable ? 1 : 0,
                    quickSearch: 0, filterable: site.filterable ? 1 : 0,
                }))}, read: {sites: []}, comic: {sites: []}, music: {sites: []}, pan: {sites: []}, color: []});
            }
            const match = url.pathname.match(/^\/spider\/coketv_([A-Za-z0-9_-]+)\/3\/(init|home|homeVod|category|detail|search|play)\/?$/);
            if (!match) throw fail('站点或方法不存在', 404);
            if (request.method !== 'POST') throw fail('请使用 POST 请求', 405);
            const value = await requestJson(context, `${endpoint}/api/${match[1]}/${match[2]}`, await body(request));
            const result = match[2] === 'play' && Number(value.parse) === 1
                ? await sniff(context, value, `/spider/coketv_${match[1]}/3`) : value;
            send(response, result);
        } catch (error) { send(response, {error: error.message}, error.statusCode || 502); }
    };
    const created = typeof globalThis.catServerFactory === 'function' ? globalThis.catServerFactory(handle) : http.createServer(handle);
    context.server = created; active = context;
    created.on('connection', socket => { context.sockets.add(socket); socket.on('close', () => context.sockets.delete(socket)); });
    try {
        await new Promise((resolve, reject) => { created.once('error', reject); created.listen({host: '127.0.0.1', port: 0}, resolve); });
    } catch (error) { await closeActive(); throw error; }
    return created.address();
}
function serial(action) {
    const result = lifecycle.then(action);
    lifecycle = result.catch(() => {});
    return result;
}
Object.defineProperty(exports, '__esModule', {value: true});
exports.start = input => serial(() => open(input));
exports.stop = () => serial(closeActive);
