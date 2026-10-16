import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import http from 'node:http';

// 新的出口策略下，「仅持订阅 Token 且自选目标 URL」的调用方不得访问任意私网/回环地址
// （见 src/server.js 的 subscriptionTargetGuard / SECURITY.md）。
// 但测试 fixture 只能监听在回环上，于是这里把「一个真正的公网地址」映射到本地 fixture：
//   1) DNS 层：把专用 hostname 解析成一个公网地址（公网目标订阅出口是允许的）；
//   2) socket 层：把针对该 hostname 的出站连接重写到本地 fixture 端口。
// 这样订阅凭据的用例仍能验证传输与请求头处理，而不会被内网策略挡在门外，
// 同时「订阅不能访问私网」这条策略另有 tests/subscription-outbound.test.js 专门覆盖。
export const PUBLIC_HOST = 'public-upstream.fixture.invalid';
export const PUBLIC_ANSWER = '93.184.216.34';

const loopbackLookup = (host, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    process.nextTick(() => options?.all ? callback(null, [{address: '127.0.0.1', family: 4}]) : callback(null, '127.0.0.1', 4));
};

export function installPublicUpstream(port, {hostname = PUBLIC_HOST, answer = PUBLIC_ANSWER} = {}) {
    const originalPromisesLookup = dnsPromises.lookup;
    const originalCallbackLookup = dns.lookup;
    const originalRequest = http.request;
    const same = host => String(host).toLowerCase() === hostname;
    dnsPromises.lookup = async (host, options) => same(host) ? [{address: answer, family: 4}] : originalPromisesLookup(host, options);
    dns.lookup = (host, options, callback) => {
        if (typeof options === 'function') { callback = options; options = {}; }
        if (same(host)) return process.nextTick(() => options?.all ? callback(null, [{address: answer, family: 4}]) : callback(null, answer, 4));
        return originalCallbackLookup(host, options, callback);
    };
    // 出站请求有两种形态：streamMedia 传 URL 对象，axios(/http) 传 options 对象。两者都要改写。
    const hostOf = value => {
        if (!value || typeof value !== 'object') return '';
        if (value.hostname) return String(value.hostname);
        return value.host ? String(value.host).split(':')[0] : '';
    };
    http.request = (...args) => {
        const first = args[0];
        if (first instanceof URL) {
            if (!same(first.hostname)) return originalRequest(...args);
            const rewritten = new URL(first);
            rewritten.hostname = '127.0.0.1';
            rewritten.port = String(port);
            const [, options, callback] = args;
            return originalRequest(rewritten, {...(options || {}), lookup: loopbackLookup}, callback);
        }
        if (same(hostOf(first))) {
            const [, optionsOrCallback, maybeCallback] = args;
            const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
            const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
            return originalRequest({...first, ...(options || {}), hostname: '127.0.0.1', host: '127.0.0.1', port, lookup: loopbackLookup}, callback);
        }
        return originalRequest(...args);
    };
    return {
        url: `http://${hostname}:${port}`,
        restore() {
            dnsPromises.lookup = originalPromisesLookup;
            dns.lookup = originalCallbackLookup;
            http.request = originalRequest;
        },
    };
}
