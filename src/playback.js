import {randomBytes} from 'node:crypto';

const error = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
export function playbackUrl(value, base) {
    let url;
    try { url = new URL(value, base); } catch { throw error('源没有返回有效的播放地址'); }
    if (typeof value !== 'string' || !value.trim() || !['http:', 'https:'].includes(url.protocol)) throw error('此播放地址不能在浏览器中使用');
    return url.href;
}
export function playbackHeaders(value) {
    if (!value) return {};
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { throw error('源返回的播放请求头格式不正确'); }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('源返回的播放请求头格式不正确');
    return Object.fromEntries(Object.entries(value).filter(([key, val]) =>
        /^[\w-]+$/.test(key) && typeof val === 'string' && !/[\r\n]/.test(val) &&
        !['host', 'x-drpy-runtime', 'connection', 'content-length'].includes(key.toLowerCase())));
}
export function mediaType(url, type = '') {
    if (/m3u8|mpegurl/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(url)) return 'm3u8';
    if (/flv/i.test(type) || /\.flv(?:[?#]|$)/i.test(url)) return 'flv';
    if (/mpegts|^ts$/i.test(type) || /\.ts(?:[?#]|$)/i.test(url)) return 'ts';
    return '';
}
// Public viewing uses short-lived, source-scoped media capabilities; these
// cannot authorize management or subscription access.
//
// Only a 256-bit random reference leaves the server. URL and upstream credentials
// stay in a bounded, process-local store; restarting drops all capabilities.
export function createPlaybackSessions({now = Date.now, ttl = 12 * 3600000, maxEntries = 50000, maxBytes = 64 * 1024 * 1024} = {}) {
    if (!Number.isFinite(ttl) || ttl <= 0 || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('无效的媒体票据容量或有效期');
    const sessions = new Map();
    let bytes = 0;
    const remove = token => {
        const entry = sessions.get(token);
        if (entry) { bytes -= entry.body.length; sessions.delete(token); }
    };
    const create = payload => {
        const timestamp = now(), exp = timestamp + ttl;
        const body = Buffer.from(JSON.stringify({...payload, exp}));
        if (body.length > maxBytes) throw error('媒体票据存储容量不足，请重新选择剧集', 503);
        // Fixed TTL makes insertion order also expiry order. Remove expired and
        // then oldest entries under pressure; reads never extend a capability.
        for (const [token, entry] of sessions) {
            if (entry.exp > timestamp) break;
            remove(token);
        }
        while (sessions.size >= maxEntries || bytes + body.length > maxBytes) remove(sessions.keys().next().value);
        let token;
        do { token = randomBytes(32).toString('base64url'); } while (sessions.has(token));
        sessions.set(token, {body, exp}); bytes += body.length;
        return token;
    };
    const get = token => {
        if (typeof token !== 'string') return undefined;
        const entry = sessions.get(token);
        if (!entry) return undefined;
        if (entry.exp <= now()) { remove(token); return undefined; }
        // Return a copy so input headers and retrieved objects cannot widen an
        // already issued capability's URL, headers, source or expiry.
        return JSON.parse(entry.body.toString());
    };
    return {
        // Media ticket: binds upstream URL + headers and the source proxy scope.
        create(source, url, headers) { return create({kind: 'media', source, url, headers: headers || {}}); },
        // Proxy ticket: authorizes a single proxy request for one absolute URL.
        createProxy(url, headers) { return create({kind: 'proxy', url, headers: headers || {}}); },
        get,
        // Playback tickets may only drive the source's own proxy route; every
        // other proxy route requires a subscription/management credential.
        allows(request, source) {
            if (!['GET', 'HEAD'].includes(request.method)) return false;
            if (request.routeOptions?.url !== '/proxy/:module/*') return false;
            const payload = get(request.query.token);
            return !!payload && payload.kind === 'media' && payload.source === source;
        },
    };
}
