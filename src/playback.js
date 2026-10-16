import {randomBytes} from 'node:crypto';
import {validateHeaderName, validateHeaderValue} from 'node:http';

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
    return Object.fromEntries(Object.entries(value).filter(([key, val]) => {
        try {
            if (typeof val !== 'string') return false;
            validateHeaderName(key); validateHeaderValue(key, val);
            return !['host', 'x-drpy-runtime', 'connection', 'content-length'].includes(key.toLowerCase());
        } catch { return false; }
    }));
}
// 出口权限范围（egress）随能力票据全生命周期传播，规则只有一条：
// **票据的出口权限不得高于铸造它的调用链**。
//   public  —— 只能访问当前 SSRF 策略认定的公网目标（回环/私网/链路本地/CGNAT/
//              特殊非全局可路由段一律拒绝，metadata 与链路本地仍是永久的硬拦）。
//              匿名 /watch 播放流程铸造的票据全部属于这一类。
//   trusted —— 沿用既有行为，由 allowPrivateTargets + targetAllowlist 决定能否访问
//              私网。只有管理员、内部源运行时，以及服务端绑定的可信媒体会话才用它。
// 默认取最严的一侧：将来新增 mint 点时若忘记标注，得到的是 public，而不是悄悄升级。
const egressOf = value => (value === 'trusted' ? 'trusted' : 'public');
// 派生能力只能继承父能力的出口权限，永不提升。公开票据派生出的
// HLS 主/子清单、EXT-X-KEY、EXT-X-MAP、分片与代理票据一律保持 public。
export function childEgress(parent) {
    return parent?.egress === 'trusted' ? 'trusted' : 'public';
}
// 由父能力派生子能力票据的**唯一实现**（HLS 子资源与源代理目标都走这里）。
// 抽出来是为了让「派生不提升权限」这条规则可以被单元测试直接覆盖，
// 而不是散落在各调用点、靠人记得传对参数。
export function createChildMint(playback, headers, parent = {}) {
    return url => playback.createProxy(url, headers, {
        ...(parent.source ? {source: parent.source} : {}),
        ...(parent.netdiskRevision ? {netdiskRevision: parent.netdiskRevision} : {}),
        egress: childEgress(parent),
    });
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
        // egress 是能力票据的出口权限，必须随票据一起落盘（而不是在取用时按
        // 「票据存在即可信」推断，那正是本轮要修的困惑代理漏洞）。
        const body = Buffer.from(JSON.stringify({...payload, egress: egressOf(payload.egress), exp}));
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
        // metadata.egress 缺省即 'public'；只有可信调用链才显式传 'trusted'。
        create(source, url, headers, metadata = {}) { return create({...metadata, kind: 'media', source, url, headers: headers || {}}); },
        // Proxy ticket: authorizes a single proxy request for one absolute URL.
        createProxy(url, headers, metadata = {}) { return create({...metadata, kind: 'proxy', url, headers: headers || {}}); },
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
