import http from 'http';
import https from 'https';

const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const cleanHeaders = headers => Object.fromEntries(Object.entries(headers || {}).filter(([key]) => !HOP_HEADERS.has(key.toLowerCase())));
export function localToken(url, base, token) {
    if (!token || typeof url !== 'string') return url;
    try {
        const parsed = new URL(url, base);
        if (parsed.origin === new URL(base).origin && /^\/(proxy\/|mediaProxy|m3u8-proxy|unified-proxy|file-proxy|webdav|ftp|image)/.test(parsed.pathname)) {
            parsed.searchParams.set('token', token);
            return parsed.href;
        }
    } catch {}
    return url;
}
export function rewritePlaylist(body, upstream, base, token, headers = {}, alias = null) {
    const wrap = value => {
        const parsed = new URL(value, upstream);
        if (parsed.origin === new URL(base).origin) {
            const segments = parsed.pathname.split('/');
            if (alias && segments[1] === 'proxy' && decodeURIComponent(segments[2] || '') === alias.name) { segments[2] = alias.id; parsed.pathname = segments.join('/'); }
            return localToken(parsed.href, base, token);
        }
        const absolute = parsed.href;
        const query = new URLSearchParams({url: absolute, headers: JSON.stringify(headers)});
        if (token) query.set('token', token);
        return `${base}/mediaProxy?${query}`;
    };
    return body.split(/\r?\n/).map(line => {
        if (!line.trim()) return line;
        if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${wrap(uri)}"`);
        return wrap(line.trim());
    }).join('\n');
}

export async function streamMedia(url, headers, request, reply, {base, token, redirects = 0, method, body} = {}) {
    let parsed;
    try { parsed = new URL(url); } catch { throw Object.assign(new Error('媒体地址无效'), {statusCode: 400}); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw Object.assign(new Error('只支持 HTTP/HTTPS 媒体地址'), {statusCode: 400});
    if (redirects > 5) throw new Error('媒体重定向次数过多');
    const outgoingHeaders = {...cleanHeaders(headers), ...(request.headers.range ? {Range: request.headers.range} : {}), 'Accept-Encoding': 'identity'};
    if (body) { outgoingHeaders['Content-Length'] = Buffer.byteLength(body); outgoingHeaders['Content-Type'] ||= 'application/json'; }
    const transport = parsed.protocol === 'https:' ? https : http;
    const upstream = await new Promise((resolve, reject) => {
        const outgoing = transport.request(parsed, {method: method || (request.method === 'HEAD' ? 'HEAD' : 'GET'), headers: outgoingHeaders}, resolve);
        const abort = () => outgoing.destroy(new Error('客户端已断开'));
        request.raw.once('aborted', abort);
        reply.raw.once('close', abort);
        outgoing.setTimeout(30000, () => outgoing.destroy(new Error('媒体连接空闲超时')));
        outgoing.once('error', reject);
        outgoing.once('close', () => { request.raw.off('aborted', abort); reply.raw.off('close', abort); });
        outgoing.end(body);
    });
    if ([301, 302, 303, 307, 308].includes(upstream.statusCode) && upstream.headers.location) {
        upstream.resume();
        return streamMedia(new URL(upstream.headers.location, url).href, headers, request, reply, {base, token, redirects: redirects + 1, method, body});
    }
    const playlist = request.method !== 'HEAD' && upstream.statusCode === 200 &&
        (/mpegurl/i.test(upstream.headers['content-type'] || '') || parsed.pathname.endsWith('.m3u8'));
    if (playlist) {
        const chunks = []; let size = 0;
        for await (const chunk of upstream) {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) { upstream.destroy(); throw new Error('播放列表超过 2MB'); }
            chunks.push(chunk);
        }
        return reply.code(200).type('application/vnd.apple.mpegurl').send(rewritePlaylist(Buffer.concat(chunks).toString(), url, base, token, headers));
    }
    reply.code(upstream.statusCode || 502).headers(cleanHeaders(upstream.headers));
    return reply.send(upstream);
}
