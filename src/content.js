// Shared source playback for web, Cat and Emby adapters. No HTTP handler dispatch.
import {playbackUrl, playbackHeaders, mediaType} from './playback.js';
import {unwrapMediaProxy} from './media-params.js';
import {validFilename, inside} from './paths.js';
const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const checkString = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
export function createContent({store, runner, netdisk, contextFor, baseUrl, playback}) {
    const play = async (request, {instance, script, file}, body, {native = false, subscription = null, clientUserAgent = false} = {}) => {
        const {play, flag = '', parser, delivery} = body || {};
        if (!checkString(play, 50000) || typeof flag !== 'string') throw fail('请选择要播放的剧集');
        if (delivery !== undefined && !['direct', 'proxy'].includes(delivery)) throw fail('播放传输方式无效');
        const netdiskPlay = netdisk.isReference(play);
        const env = contextFor(request, instance, script, {token: subscription?.token});
        // A browser cannot set its video element's User-Agent. Obtain the 115
        // URL for the requesting browser instead of sending account credentials.
        if (netdiskPlay && (!native || clientUserAgent) && delivery !== 'proxy') env.mediaUserAgent = request.headers['user-agent'];
        let result = await netdisk.execute({script, instance, file}, {play, flag}, env, runner);
        if (typeof result === 'string') { try { result = JSON.parse(result); } catch { result = {url: result, parse: 0}; } }
        const parses = store.state.settings.parses || [];
        const options = parses.map((item, index) => ({index, name: item.name || `解析 ${index + 1}`}));
        const requiresParse = Number(result?.parse) === 1 || Number(result?.jx) === 1;
        if (requiresParse) {
            const index = parser === undefined ? parses.findIndex(item => [1, 2].includes(Number(item.type))) : Number(parser);
            const selected = parses[index];
            if (!selected) {
                if (native && Object.keys(playbackHeaders(result.headers ?? result.header)).length) throw fail('此网页源需要服务器请求头，请在 CokeTV 配置解析或切换源', 422);
                return native ? {parse: 1, url: playbackUrl(result.url, baseUrl(request))} : {needsParse: true, parses: options};
            }
            const target = playbackUrl(result.url, baseUrl(request));
            if (Number(selected.type) === 0) {
                const iframe = playbackUrl(`${selected.url}${encodeURIComponent(target)}`, baseUrl(request));
                if (new URL(iframe).origin === new URL(baseUrl(request)).origin) throw fail('网页解析须使用外部解析地址');
                return native ? {parse: 1, url: iframe} : {iframe, parses: options, parser: index};
            }
            if (Number(selected.type) === 2) {
                const parsed = new URL(selected.url, baseUrl(request));
                const name = parsed.pathname.match(/^\/parse\/([^/]+)$/)?.[1];
                if (!name || parsed.origin !== new URL(baseUrl(request)).origin) throw fail('网页播放仅支持本地 /parse/ 脚本或 JSON 解析');
                const filename = `${decodeURIComponent(name)}.js`;
                validFilename('js', filename);
                result = await runner.run({engine: 'js', file: inside(store.runtime, `jx/${filename}`), instanceId: instance.id}, {url: target}, env, 'parse');
            } else if (Number(selected.type) === 1) {
                const {default: axios} = await import('axios');
                const response = await axios.get(playbackUrl(`${selected.url}${encodeURIComponent(target)}`, baseUrl(request)), {timeout: store.state.settings.timeout, headers: playbackHeaders(selected.ext?.header)});
                result = response.data?.data?.url ? response.data.data : response.data;
            } else throw fail('此解析类型暂不支持网页播放');
            if (typeof result === 'string') { try { result = JSON.parse(result); } catch { result = {url: result}; } }
            if (!result?.url || Number(result.parse) === 1) throw fail('解析未返回可播放的媒体地址');
        }
        let url = playbackUrl(result?.url, baseUrl(request));
        const parsed = new URL(url), segments = parsed.pathname.split('/');
        if (parsed.origin === new URL(baseUrl(request)).origin && segments[1] === 'proxy' && decodeURIComponent(segments[2] || '') === script.file.replace(/\.[^.]+$/, '')) {
            segments[2] = instance.id; parsed.pathname = segments.join('/'); url = parsed.href;
        }
        const carried = unwrapMediaProxy(url, baseUrl(request));
        const headers = playbackHeaders({...carried?.headers, ...playbackHeaders(result.headers ?? result.header)});
        if (carried) url = carried.url;
        if (native) return {parse: 0, url, headers, direct: netdiskPlay && delivery !== 'proxy', type: mediaType(url, result.type) || result.netdiskFileName?.match(/\.(mkv|mp4|m4v|webm|mov|avi)$/i)?.[1]?.toLowerCase() || '', ...(result.netdiskRevision ? {netdiskRevision: result.netdiskRevision} : {})};
        if (netdiskPlay && result.netdiskRevision && delivery !== 'proxy') {
            // Only the unified provider's temporary media URL leaves the server;
            // generic source headers may contain private ENV and stay proxied.
            const type = mediaType(url, result.type) || mediaType('file.' + result.netdiskFileName?.split('.').pop()) || 'native';
            return {url, type, direct: true, parses: options, parser: parser ?? null};
        }
        const ticket = playback.create(instance.id, url, headers, result.netdiskRevision ? {netdiskRevision: result.netdiskRevision} : {});
        return {url: `/watch/media/${ticket}`, type: mediaType(url, result.type), parses: options, parser: parser ?? null};
    };
    return {
        query(request, resolved, query, subscription) {
            return netdisk.execute(resolved, query, contextFor(request, resolved.instance, resolved.script, {token: subscription?.token}), runner);
        },
        play,
        identity(reference, source) { return netdisk.identity(reference, source); },
    };
}
