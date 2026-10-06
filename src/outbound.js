import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import axios from 'axios';

const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});

// Implements both dns.lookup callback forms, including Node's all:true dual
// stack connection path. No DNS lookup or fallback outside this list occurs.
export function pinnedLookup(addresses) {
    const checked = addresses.map(({address, family}) => ({address, family: family || net.isIP(address)}));
    if (!checked.length || checked.some(entry => !net.isIP(entry.address))) throw fail('目标地址无法解析', 403);
    return (_hostname, options, callback) => {
        if (typeof options === 'function') { callback = options; options = {}; }
        const family = Number(typeof options === 'number' ? options : options?.family) || 0;
        const selected = checked.filter(entry => !family || entry.family === family);
        process.nextTick(() => {
            if (!selected.length) callback(Object.assign(new Error('目标地址没有匹配的 IP 协议'), {code: 'ENOTFOUND'}));
            else if (options?.all) callback(null, selected.map(entry => ({...entry})));
            else callback(null, selected[0].address, selected[0].family);
        });
    };
}
const withoutHeaders = (headers, pattern) => Object.fromEntries(Object.entries(headers).filter(([name]) => !pattern.test(name)));

// Axios's synchronous beforeRedirect hook cannot await the policy/DNS check.
// Keep its serialization and response parsing with manual, checked redirects.
export async function guardedHttp({url, method = 'GET', headers = {}, params = {}, data, responseType, maxRedirects = 21, timeout = 30000}, guard) {
    if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 21) throw fail('HTTP 重定向上限须为 0–21');
    let target = axios.getUri({url, params}), currentMethod = String(method).toUpperCase(), currentHeaders = {...headers}, currentData = data;
    const deadline = Date.now() + timeout;
    for (let redirects = 0; ; redirects++) {
        const parsed = new URL(target), addresses = await guard(parsed.href);
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('HTTP 请求超时');
        const lookup = pinnedLookup(addresses);
        const httpAgent = new http.Agent({keepAlive: false});
        // Keep Node's original SNI behavior, including sources which address an
        // IP and supply Host for a TLS virtual host. Lookup changes only the IP.
        const httpsAgent = new https.Agent({keepAlive: false});
        const response = await axios({url: parsed.href, method: currentMethod, headers: currentHeaders, data: currentData,
            responseType, timeout: remaining, validateStatus: () => true, maxRedirects: 0,
            lookup, httpAgent, httpsAgent, proxy: false});
        const location = response.headers.location;
        if (![301, 302, 303, 307, 308].includes(response.status) || !location || maxRedirects === 0) return response;
        if (responseType === 'stream') response.data.destroy();
        if (redirects >= maxRedirects) throw new Error('HTTP 重定向次数过多');
        const next = new URL(location, parsed);
        if (((response.status === 301 || response.status === 302) && currentMethod === 'POST') ||
            (response.status === 303 && !['GET', 'HEAD'].includes(currentMethod))) {
            currentMethod = 'GET'; currentData = undefined;
            currentHeaders = withoutHeaders(currentHeaders, /^content-/i);
        }
        currentHeaders = withoutHeaders(currentHeaders, /^host$/i);
        const subdomain = next.host.endsWith(`.${parsed.host}`);
        if ((next.protocol !== parsed.protocol && next.protocol !== 'https:') || (next.host !== parsed.host && !subdomain)) {
            currentHeaders = withoutHeaders(currentHeaders, /^(?:authorization|proxy-authorization|cookie)$/i);
        }
        target = next.href;
    }
}
