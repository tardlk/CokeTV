import http from 'http';
import https from 'https';
import {pinnedLookup} from './outbound.js';

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
// `mint` returns a capability token bound to one absolute URL. When it is
// provided, cross-origin segments get their own URL-scoped ticket instead of a
// broad token, so a leaked playlist URL cannot be repurposed as an open proxy.
export function rewritePlaylist(body, upstream, base, {token, mint, alias, wrapUrl} = {}) {
    const wrap = value => {
        const parsed = new URL(value, upstream);
        if (wrapUrl) return wrapUrl(parsed.href);
        if (parsed.origin === new URL(base).origin) {
            const segments = parsed.pathname.split('/');
            if (alias && segments[1] === 'proxy' && decodeURIComponent(segments[2] || '') === alias.name) { segments[2] = alias.id; parsed.pathname = segments.join('/'); }
            return localToken(parsed.href, base, token);
        }
        const absolute = parsed.href;
        const query = new URLSearchParams({url: absolute});
        const signed = mint ? mint(absolute) : token;
        if (signed) query.set('token', signed);
        return `${base}/mediaProxy?${query}`;
    };
    return body.split(/\r?\n/).map(line => {
        if (!line.trim()) return line;
        if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${wrap(uri)}"`);
        return wrap(line.trim());
    }).join('\n');
}

export async function streamMedia(url, headers, request, reply, {base, token, mint, guard, redirects = 0, method, body, wrapUrl, ignoreRange = false} = {}) {
    let parsed;
    try { parsed = new URL(url); } catch { throw Object.assign(new Error('媒体地址无效'), {statusCode: 400}); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw Object.assign(new Error('只支持 HTTP/HTTPS 媒体地址'), {statusCode: 400});
    // 入口与每次重定向后都复核目标地址（SSRF/云元数据）。
    const addresses = guard ? await guard(parsed.href) : null;
    if (redirects > 5) throw new Error('媒体重定向次数过多');
    const playlistTarget = /\.m3u8$/i.test(parsed.pathname);
    // Native players probe with Range, including offsets cached from the prior
    // episode. A partial playlist cannot be safely rewritten. Only subscription
    // playlists ignore Range; MP4 and HLS segment byte ranges keep their meaning.
    const range = !ignoreRange && !(wrapUrl && playlistTarget) && request.headers.range;
    const outgoingHeaders = {...cleanHeaders(headers), ...(range ? {Range: range} : {}), 'Accept-Encoding': 'identity'};
    if (body) { outgoingHeaders['Content-Length'] = Buffer.byteLength(body); outgoingHeaders['Content-Type'] ||= 'application/json'; }
    const transport = parsed.protocol === 'https:' ? https : http;
    const upstream = await new Promise((resolve, reject) => {
        let settled = false;
        const outgoing = transport.request(parsed, {method: method || (request.method === 'HEAD' ? 'HEAD' : 'GET'), headers: outgoingHeaders,
            // Fresh sockets cannot reuse a global Agent's previous DNS/policy.
            agent: false, ...(addresses ? {lookup: pinnedLookup(addresses)} : {})}, response => { settled = true; resolve(response); });
        const abort = () => {
            // 不向 destroy 传 Error：已 settle 的流再抛 error 会成为未捕获异常。
            if (!settled) { settled = true; reject(new Error('客户端已断开')); }
            try { outgoing.destroy(); } catch {}
        };
        request.raw.once('aborted', abort);
        reply.raw.once('close', abort);
        outgoing.setTimeout(30000, () => { if (!settled) { settled = true; reject(new Error('媒体连接空闲超时')); } try { outgoing.destroy(); } catch {} });
        // 用 on 而非 once：承诺 settle（含守卫抛错导致的提前返回）后再来的 error 必须被吞掉，
        // 否则会变成未捕获异常并带走整个进程。
        outgoing.on('error', error => { if (!settled) { settled = true; reject(error); } });
        outgoing.once('close', () => { request.raw.off('aborted', abort); reply.raw.off('close', abort); });
        outgoing.end(body);
    });
    if ([301, 302, 303, 307, 308].includes(upstream.statusCode) && upstream.headers.location) {
        upstream.resume();
        return streamMedia(new URL(upstream.headers.location, url).href, headers, request, reply, {base, token, mint, guard, redirects: redirects + 1, method, body, wrapUrl, ignoreRange});
    }
    // Extensionless HLS is identified by its actual response headers. Fetch the
    // whole list once rather than returning a 206 with unrewritten child URLs.
    if (wrapUrl && range && upstream.statusCode === 206 && /mpegurl/i.test(upstream.headers['content-type'] || '')) {
        upstream.resume();
        return streamMedia(url, headers, request, reply, {base, token, mint, guard, redirects, method, body, wrapUrl, ignoreRange: true});
    }
    const playlist = request.method !== 'HEAD' && upstream.statusCode === 200 &&
        (/mpegurl/i.test(upstream.headers['content-type'] || '') || playlistTarget);
    if (playlist) {
        const chunks = []; let size = 0;
        for await (const chunk of upstream) {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) { upstream.destroy(); throw new Error('播放列表超过 2MB'); }
            chunks.push(chunk);
        }
        return reply.code(200).type('application/vnd.apple.mpegurl').send(rewritePlaylist(Buffer.concat(chunks).toString(), url, base, {token, mint, wrapUrl}));
    }
    reply.code(upstream.statusCode || 502).headers(cleanHeaders(upstream.headers));
    return reply.send(upstream);
}
