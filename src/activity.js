import {createHash} from 'node:crypto';
import {redactLogMessage} from './logging.js';
import {sourceOperation} from './source-operation.js';
import {clientInfo} from './emby/auth.js';

const labels = {home: '首页', homeVod: '推荐', category: '分类', search: '搜索', detail: '详情', play: '取链', proxy: '源代理', action: '交互', refresh: '重新加载', parse: '解析'};
export const operationLabel = value => labels[value] || '请求';
const text = (value, max = 200) => redactLogMessage(String(value ?? '')).replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, max);
const hash = value => createHash('sha256').update(value).digest('hex');
const fields = ['requestId', 'clientIp', 'protocol', 'client', 'device', 'userAgent', 'source', 'sourceName', 'subscription', 'title', 'episode'];
export const activityFields = value => Object.fromEntries(fields.flatMap(key => value?.[key] ? [[key, text(value[key], key === 'userAgent' ? 256 : 200)]] : []));

function routeInfo(route) {
    if (!route || route.startsWith('/admin/') || /\/images\//i.test(route)) return null;
    const media = /\/watch\/media\/|^\/proxy\/|^\/mediaProxy$|^\/req\/|^\/(?:m3u8-proxy|unified-proxy|file-proxy)\/|\/media\/|\/(?:emby\/)?Videos\//i.test(route);
    const protocol = route.startsWith('/cat/') ? '猫影视' : route.startsWith('/watch/') ? '网页'
        : /^\/(?:tvbox|s|subscription|config|api)(?:\/|$)/.test(route) ? 'TVBox'
        : /^\/(?:emby\/)?(?:Users|Items|Shows|Media|Videos|Sessions|Library|System|DisplayPreferences|Search)\b/i.test(route) ? 'Emby' : '媒体';
    if (media) return {category: 'playback', protocol, operation: '媒体请求'};
    if (route.startsWith('/cat/') || protocol === 'TVBox' || protocol === '网页' || protocol === 'Emby') {
        return {category: 'client', protocol, operation: /AuthenticateByName$/i.test(route) ? '登录'
            : /\/tvbox\/|^\/s\/|^\/subscription\/|^\/config|\/manifest$|\/:file$/.test(route) ? '订阅获取'
            : /PlaybackInfo$/i.test(route) ? '播放信息' : /\/Sessions\/Playing\/Stopped$/i.test(route) ? '停止播放'
            : /\/Sessions\/Playing\/Progress$/i.test(route) ? '播放进度' : /\/Sessions\/Playing$/i.test(route) ? '开始播放' : '访问'};
    }
    return null;
}

// Only allowlisted metadata enters the log. Query strings, bodies, playback IDs,
// credentials and source ENV never enter this request context or its IPC copy.
export function createActivityLog(write, {now = Date.now, intervalMs = 30000, maxGroups = 1000, maxTitles = 10000} = {}) {
    const groups = new Map(), titles = new Map();
    function clean(request, value) {
        const auth = [request.headers?.authorization, request.headers?.['x-emby-authorization'], request.query?.['X-Emby-Authorization']];
        const secrets = [request.query?.token, request.body?.token, request.query?.api_key, request.query?.ApiKey, request.query?.AccessToken,
            request.params?.credential, request.params?.ticket, request.headers?.['x-emby-token'], request.headers?.['x-mediabrowser-token'],
            request.body?.Pw, request.body?.pw, request.body?.Password,
            ...auth.flatMap(raw => typeof raw === 'string' ? [...raw.matchAll(/\bToken\s*=\s*"([^"\r\n]*)"/gi)].map(m => m[1]) : [])]
            .filter(value => typeof value === 'string' && value.length >= 4);
        return text(secrets.reduce((s, secret) => s.split(secret).join('[redacted]'), String(value ?? '')), 256);
    }
    function context(request) {
        if (request.activity) return activityFields(Object.fromEntries(fields.map(key => [key, clean(request, request.activity[key])])));
        const info = routeInfo(request.routeOptions?.url || '');
        let identification = {};
        try { identification = clientInfo(request); } catch { /* Invalid auth headers must not break logging. */ }
        const userAgent = request.headers?.['user-agent'] || '';
        request.activity = {
            requestId: text(request.id, 80), clientIp: text(request.ip || request.raw?.socket?.remoteAddress || '', 80).replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1'),
            protocol: info?.protocol || (request.routeOptions?.url?.startsWith('/admin') ? '管理后台' : '内部'),
            client: clean(request, identification.Client && identification.Client !== 'Emby' ? identification.Client : userAgent || (info?.protocol === 'Emby' ? 'Emby' : '未知客户端')),
            device: clean(request, identification.DeviceName !== '播放器' ? identification.DeviceName : ''), userAgent: clean(request, userAgent),
        };
        return context(request);
    }
    function bind(request, instance, query, subscription) {
        context(request);
        const sub = subscription?.subscription || subscription;
        if (instance) Object.assign(request.activity, {source: instance.id, sourceName: clean(request, instance.name)});
        if (sub?.name) request.activity.subscription = text(String(sub.name).split(sub.token || '\0').join('[redacted]'));
        if (query) request.activityOperation = sourceOperation(query);
        if (query && 'play' in query && instance) {
            const item = titles.get(hash(`${instance.id}\0${query.flag || ''}\0${query.play}`));
            if (item && now() - item.at < 12 * 3600000) Object.assign(request.activity, {title: item.title, episode: item.episode});
        }
        return context(request);
    }
    function remember(source, result) {
        if (typeof result === 'string') { try { result = JSON.parse(result); } catch { return; } }
        for (const vod of (Array.isArray(result?.list) ? result.list : []).slice(0, 100)) {
            const flags = String(vod.vod_play_from || '').split('$$$');
            const lines = String(vod.vod_play_url || '').split('$$$');
            let count = 0;
            for (let index = 0; index < lines.length && count < 2000; index++) for (const raw of lines[index].split('#')) {
                if (++count > 2000) break;
                const at = raw.indexOf('$');
                if (at < 0) continue;
                const key = hash(`${source}\0${flags[index] || ''}\0${raw.slice(at + 1)}`);
                titles.delete(key);
                titles.set(key, {title: text(vod.vod_name), episode: text(raw.slice(0, at), 100), at: now()});
                while (titles.size > maxTitles) titles.delete(titles.keys().next().value);
            }
        }
    }
    function summary(group) {
        if (!group.count) return;
        const statuses = group.statuses;
        const {requestId, status, ...meta} = group.entry;
        write({...meta, event: group.entry.event + '.summary', requestCount: group.count, statuses, outcome: group.errors ? 'error' : 'ok',
            durationMs: Math.round(group.duration / group.count), level: group.errors ? 'warn' : 'info',
            message: `${group.entry.protocol || ''} ${group.label}后续 ${group.count} 次汇总，失败 ${group.errors} 次，平均 ${Math.round(group.duration / group.count)} ms`});
    }
    function sample(entry, label) {
        const key = JSON.stringify([entry.event, entry.protocol, entry.clientIp, entry.client, entry.source, entry.route, entry.title, entry.episode]);
        let group = groups.get(key);
        if (!group || now() - group.at >= intervalMs) {
            if (group) summary(group);
            if (!group && groups.size >= maxGroups) { const oldest = groups.keys().next().value; summary(groups.get(oldest)); groups.delete(oldest); }
            group = {entry, label, at: now(), count: 0, errors: 0, duration: 0, statuses: {}};
            groups.set(key, group); write(entry); return;
        }
        group.count++; group.duration += entry.durationMs || 0;
        if (entry.outcome === 'error' || entry.status >= 400 && entry.status !== 499) group.errors++;
        const status = String(entry.status || entry.outcome || 'ok');
        group.statuses[status] = (group.statuses[status] || 0) + 1;
        // The first failure must remain immediately visible even during a burst.
        if (entry.outcome === 'error' || entry.status >= 400 && entry.status !== 499) write(entry);
    }
    function flush() { for (const group of groups.values()) summary(group); groups.clear(); }
    const timer = setInterval(flush, intervalMs); timer.unref?.();
    return {
        context, bind, remember, sample, flush,
        identify(request, value) { context(request); Object.assign(request.activity, activityFields(Object.fromEntries(fields.map(key => [key, clean(request, value[key])])))); return context(request); },
        close() { clearInterval(timer); flush(); titles.clear(); },
        playback(request, instance, query, delivery) {
            const meta = bind(request, instance, query);
            write({...meta, category: 'playback', event: 'playback.resolve', operation: 'play', delivery,
                outcome: 'ok', message: `取链成功 · ${meta.sourceName || '源'}${meta.title ? ' · ' + meta.title : ''}${meta.episode ? ' · ' + meta.episode : ''} · ${delivery}`});
        },
        unresolved(request, instance, query) {
            write({...bind(request, instance, query), category: 'playback', event: 'playback.resolve', operation: 'play',
                level: 'warn', outcome: 'error', message: '取链未返回有效地址'});
        },
        hooks(app, isInternal) {
            app.decorateRequest('activity', null);
            app.addHook('onRequest', async (request, reply) => {
                const info = routeInfo(request.routeOptions?.url || '');
                if (!info) return;
                if (isInternal(request)) { context(request); Object.assign(request.activity, {protocol: '源内部', client: '源内部调用'}); return; }
                context(request);
                request.activityStarted = now();
                reply.raw.once('close', () => { if (!reply.raw.writableFinished) complete(request, reply, true); });
            });
            app.addHook('onSend', async (request, _reply, payload) => {
                if (request.activityStarted !== undefined && typeof payload?.pipe === 'function') {
                    payload.once('error', () => { request.activityStreamError = true; });
                }
                return payload;
            });
            function complete(request, reply, aborted = false) {
                if (request.activityStarted === undefined || request.activityDone) return;
                request.activityDone = true;
                const route = request.routeOptions?.url || '', info = routeInfo(route);
                const streamError = request.activityStreamError, cancelled = aborted && !streamError;
                const status = cancelled ? 499 : reply.statusCode;
                const durationMs = Math.max(0, now() - request.activityStarted);
                const operation = info.category === 'client' && request.activityOperation ? operationLabel(request.activityOperation) : info.operation;
                const entry = {...context(request), category: info.category, event: info.category === 'playback' ? 'media.request' : 'client.request',
                    route, method: request.method, operation, status, durationMs, outcome: streamError ? 'error' : cancelled ? 'cancelled' : status >= 400 ? 'error' : 'ok',
                    level: streamError || status >= 400 && status !== 499 ? 'warn' : 'info',
                    message: `${context(request).protocol} ${operation} · ${streamError ? '媒体流中断 · HTTP ' + status : cancelled ? '客户端取消' : 'HTTP ' + status} · ${durationMs} ms`};
                if (info.category === 'playback') sample(entry, '媒体请求'); else write(entry);
            }
            app.addHook('onResponse', async (request, reply) => complete(request, reply));
        },
    };
}
