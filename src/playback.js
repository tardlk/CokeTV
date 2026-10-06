import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

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
// A capability is a self-describing HMAC token: {kind, source?, url, headers?, exp}.
// Tokens are stateless, so "this ticket is only valid for exactly this URL" is
// expressed by the signature itself instead of a server-side allow-list.
export function createPlaybackSessions({now = Date.now, ttl = 12 * 3600000, key = randomBytes(32)} = {}) {
    const b64 = buffer => Buffer.from(buffer).toString('base64url');
    const sign = payload => {
        const body = b64(JSON.stringify(payload));
        return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
    };
    const verify = token => {
        const [body, mac] = String(token || '').split('.');
        if (!body || !mac) return null;
        const expected = createHmac('sha256', key).update(body).digest('base64url');
        const given = Buffer.from(mac);
        const want = Buffer.from(expected);
        if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
        let payload;
        try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
        return payload && typeof payload === 'object' && payload.exp > now() ? payload : null;
    };
    return {
        // Media ticket: grants exactly one upstream fetch (url + headers baked in).
        create(source, url, headers) { return sign({kind: 'media', source, url, headers: headers || {}, exp: now() + ttl}); },
        // Proxy ticket: authorizes a single proxy request for one absolute URL.
        createProxy(url, headers) { return sign({kind: 'proxy', url, headers: headers || {}, exp: now() + ttl}); },
        get(token) { return verify(token) || undefined; },
        // Playback tickets may only drive the source's own proxy route; every
        // other proxy route requires a subscription/management credential.
        allows(request, source) {
            if (!['GET', 'HEAD'].includes(request.method)) return false;
            if (request.routeOptions?.url !== '/proxy/:module/*') return false;
            const payload = verify(request.query.token);
            return !!payload && payload.kind === 'media' && payload.source === source;
        },
    };
}
