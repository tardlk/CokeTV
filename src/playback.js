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
export function createPlaybackSessions({now = Date.now, ttl = 12 * 3600000} = {}) {
    const sessions = new Map();
    const prune = () => { for (const [key, value] of sessions) if (value.expires <= now()) sessions.delete(key); };
    return {
        create(source, url, headers) {
            prune();
            while (sessions.size >= 128) sessions.delete(sessions.keys().next().value);
            const token = randomBytes(24).toString('base64url');
            sessions.set(token, {source, url, headers, expires: now() + ttl});
            return token;
        },
        get(token) { prune(); return sessions.get(token); },
        allows(request, source) {
            if (!['GET', 'HEAD'].includes(request.method)) return false;
            const session = this.get(request.query.token);
            if (!session) return false;
            const route = request.routeOptions.url;
            if (route === '/proxy/:module/*') return source === session.source;
            return ['/mediaProxy', '/unified-proxy/proxy', '/file-proxy/proxy', '/m3u8-proxy/playlist', '/m3u8-proxy/ts', '/m3u8-proxy/proxy', '/webdav/*', '/ftp/*', '/req/*', '/image/:id'].includes(route);
        },
    };
}
