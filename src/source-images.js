// Source-declared image Referer support. The browser receives an opaque,
// source-scoped capability; changing its URL cannot turn it into an open proxy.
export function sourceImages(result, source, base, playback) {
    if (!result || typeof result !== 'object' || !Array.isArray(result.list)) return result;
    return {...result, list: result.list.map(item => {
        if (!item || typeof item.vod_pic !== 'string') return item;
        const marker = item.vod_pic.indexOf('@Referer=');
        if (marker < 0) return item;
        let url, referer;
        try { url = new URL(item.vod_pic.slice(0, marker), base); referer = new URL(item.vod_pic.slice(marker + 9)); } catch { return item; }
        if (!['https:', 'http:'].includes(url.protocol) || !['https:', 'http:'].includes(referer.protocol) || url.username || url.password || referer.username || referer.password) return item;
        const token = playback.createProxy(url.href, {Referer: referer.href}, {source, egress: 'public'});
        return {...item, vod_pic: `${base}/mediaProxy?${new URLSearchParams({url: url.href, token})}`};
    })};
}
