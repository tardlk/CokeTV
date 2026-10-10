import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createPlaybackSessions, mediaType} from './playback.js';
import {uniqueSubscriptionByToken} from './subscriptions.js';

const program = await fs.readFile(new URL('./cat-client.cjs', import.meta.url));
const md5 = bytes => createHash('md5').update(bytes).digest('hex');
const mediaFile = /^stream\.(m3u8|mp4|m4v|webm|mov|mkv|avi|flv|ts|mp3|m4a|aac|bin)$/;
const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const text = (value, label, max = 10000) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(`${label}无效`);
    return value;
};

// Each subscription owns a directory, so sibling-file loading never depends on
// clients retaining a query string. Connection config contains no source ENV.
export function catSubscriptionPath(subscription, short = false) {
    return `/cat/${short ? '' : encodeURIComponent(subscription.id) + '/'}${encodeURIComponent(subscription.token)}`;
}
export function registerCatSubscriptions(app, {store, baseUrl, execute, play, serveMedia, isNetdiskCurrent = () => true}) {
    const sessions = createPlaybackSessions();
    const authorize = request => {
        const sub = request.params.id === undefined ? uniqueSubscriptionByToken(store.state, request.params.credential)
            : store.state.subscriptions.find(item => item.id === request.params.id && item.enabled && item.token === request.params.credential);
        if (!sub) throw fail('订阅不存在、已停用或凭证无效', 403);
        return sub;
    };
    const source = (request, sub) => {
        const instance = store.state.instances.find(item => item.id === request.params.source && item.enabled && sub.instances.includes(item.id));
        if (!instance) throw fail('该源已停用或不在当前订阅中', 403);
        return store.resolve(instance.id);
    };
    const scope = (sub, instance) => `${sub.id}:${sub.token}:${instance.id}`;
    const mediaUrl = (request, sub, instance, url, headers, type, netdiskRevision) => {
        const extension = mediaType(url, type) || (/^(mkv|avi|mp4|m4v|webm|mov)$/.test(type || '') ? type : '') || new URL(url).pathname.match(/\.(mp4|m4v|webm|mov|mkv|avi|mp3|m4a|aac|bin)$/i)?.[1]?.toLowerCase() || 'bin';
        return `${baseUrl(request)}${catSubscriptionPath(sub, request.params.id === undefined)}/media/${encodeURIComponent(instance.id)}/${sessions.create(scope(sub, instance), url, headers, netdiskRevision ? {netdiskRevision} : {})}/stream.${extension}`;
    };
    const route = (method, suffix, handler) => {
        for (const prefix of ['/cat/:id/:credential', '/cat/:credential']) app.route({method, url: prefix + suffix, handler});
    };
    route('GET', '/:file', async (request, reply) => {
        const sub = authorize(request);
        if (!['index.js','index.js.md5','index.config.js','index.config.js.md5'].includes(request.params.file)) throw fail('文件不存在', 404);
        const config = Buffer.from('"use strict";\nObject.defineProperty(exports, "__esModule", {value: true});\nexports.default = ' +
            JSON.stringify({version: 1, endpoint: baseUrl(request) + catSubscriptionPath(sub, request.params.id === undefined)}) + ';\n');
        const bytes = request.params.file.startsWith('index.config.') ? config : program;
        reply.header('Cache-Control', 'private, no-store');
        return request.params.file.endsWith('.md5') ? reply.type('text/plain; charset=utf-8').send(md5(bytes))
            : reply.type('application/javascript; charset=utf-8').send(bytes);
    });
    route('GET', '/manifest', async (request, reply) => {
        const sub = authorize(request);
        reply.header('Cache-Control', 'private, no-store');
        return {timeout: store.state.settings.timeout, sites: sub.instances.flatMap(id => {
            const instance = store.state.instances.find(item => item.id === id && item.enabled);
            if (!instance || !store.state.scripts.some(item => item.id === instance.scriptId)) return [];
            return [{id: instance.id, name: instance.name, searchable: !!instance.searchable, filterable: !!instance.filterable}];
        })};
    });
    route('POST', '/api/:source/:action', async (request, reply) => {
        const sub = authorize(request), resolved = source(request, sub), body = request.body === undefined ? {} : request.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('请求体必须是 JSON 对象');
        reply.header('Cache-Control', 'private, no-store');
        const action = request.params.action;
        let query, detailIds;
        if (action === 'init') return {};
        if (action === 'home' || action === 'homeVod') query = {};
        else if (action === 'category') {
            const id = text(String(body.id ?? body.tid ?? ''), '分类');
            const filters = body.filters ?? {};
            if (!filters || typeof filters !== 'object' || Array.isArray(filters) || JSON.stringify(filters).length > 10000) throw fail('筛选参数无效');
            query = {ac: 'list', t: id, pg: Math.max(1, parseInt(body.page, 10) || 1), ext: Buffer.from(JSON.stringify(filters)).toString('base64')};
        } else if (action === 'detail') {
            const values = Array.isArray(body.id) ? body.id : [body.id];
            if (!values.length || values.length > 100) throw fail('影片 ID 无效');
            query = {ac: 'detail', ids: values.map(value => text(String(value ?? ''), '影片 ID')).join(',')};
            if (query.ids.length > 10000) throw fail('影片 ID 超过限制');
            detailIds = values.map(value => String(value));
        } else if (action === 'search') {
            if (!resolved.instance.searchable) throw fail('此源不支持搜索', 409);
            query = {wd: text(body.wd, '搜索内容', 200), pg: Math.max(1, parseInt(body.page, 10) || 1)};
        } else if (action === 'play') {
            text(body.id, '剧集', 50000);
            if (body.flag !== undefined && typeof body.flag !== 'string') throw fail('播放线路无效');
            const media = await play(request, resolved, {play: body.id, flag: body.flag || '', parser: body.parser}, sub);
            if (media.parse === 1) return {parse: 1, url: media.url, header: {}};
            return {parse: 0, url: mediaUrl(request, sub, resolved.instance, media.url, media.headers, media.type, media.netdiskRevision), header: {}, type: media.type};
        } else throw fail('方法不存在', 404);
        if (detailIds) {
            // Some compatible engines accept only the first ID. Aggregate here
            // without changing their original execution contract.
            const list = [];
            for (const id of detailIds) {
                const result = await execute(request, resolved, {ac: 'detail', ids: id}, sub);
                if (!Array.isArray(result?.list)) throw fail('源没有返回有效的影片详情', 502);
                list.push(...result.list);
            }
            return {list};
        }
        const result = await execute(request, resolved, query, sub);
        return action === 'homeVod' ? {list: result.list || []} : result;
    });
    route(['GET','HEAD'], '/media/:source/:ticket/:file', async (request, reply) => {
        const sub = authorize(request), {instance} = source(request, sub);
        if (!mediaFile.test(request.params.file)) throw fail('媒体文件不存在', 404);
        const session = sessions.get(request.params.ticket);
        if (!session || session.source !== scope(sub, instance) || !isNetdiskCurrent(session.netdiskRevision)) throw fail('播放链接已过期，请重新选择剧集', 403);
        reply.header('Cache-Control', 'private, no-store');
        return serveMedia(request, reply, session.url, session.headers, sub.token, undefined,
            url => mediaUrl(request, sub, instance, url, session.headers, undefined, session.netdiskRevision));
    });
    return {allowsMedia(request) {
        try {
            const sub = authorize(request), {instance} = source(request, sub);
            if (!mediaFile.test(request.params.file)) return false;
            const session = sessions.get(request.params.ticket);
            return session?.source === scope(sub, instance) && isNetdiskCurrent(session.netdiskRevision);
        } catch { return false; }
    }};
}
