import dns from 'node:dns/promises';
import net from 'node:net';

const fail = (message, statusCode = 403) => Object.assign(new Error(message), {statusCode});
// 永久拒绝：云元数据地址（与主机名），无论设置如何都不放行。
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata', 'instance-data', 'metadata.goog']);
const METADATA_ADDRESSES = new Set(['169.254.169.254', '100.100.100.200', 'fd00:ec2::254', '169.254.170.2']);

export function isInternalAddress(address) {
    if (net.isIP(address) === 4) {
        const [a, b] = address.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            a >= 224;
    }
    if (net.isIP(address) === 6) {
        const value = address.toLowerCase();
        if (value === '::' || value === '::1' || value === 'fd00:ec2::254') return true;
        if (/^fe[89ab]/.test(value) || /^f[cd]/.test(value)) return true;
        if (value.startsWith('::ffff:')) return isInternalAddress(value.slice(7));
        return false;
    }
    return false;
}
const ipToLong = address => address.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
function inCidr(address, cidr) {
    if (!cidr.includes('/')) return address === cidr;
    const [base, bits] = cidr.split('/');
    const size = Number(bits);
    if (net.isIP(base) !== 4 || net.isIP(address) !== 4 || !Number.isInteger(size) || size < 0 || size > 32) return false;
    const mask = size === 0 ? 0 : (0xffffffff << (32 - size)) >>> 0;
    return (ipToLong(address) & mask) === (ipToLong(base) & mask);
}
function matchesEntry(entry, hostname, addresses) {
    const value = String(entry).trim().toLowerCase();
    if (!value) return false;
    if (value === hostname.toLowerCase()) return true;
    if (value.startsWith('*.') && hostname.toLowerCase().endsWith(value.slice(1))) return true;
    return addresses.some(({address}) => inCidr(address, value));
}
// 代理出口的统一 SSRF 判定：基于解析后的所有 IP（防 DNS rebinding 的基本面），
// 每次重定向后同样复核。返回解析结果供调用方按需固定连接。
export async function assertTargetAllowed(url, {allowPrivate = true, allowlist = [], selfOrigins = []} = {}) {
    let parsed;
    try { parsed = new URL(url); } catch { throw fail('目标地址无效'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw fail('只支持 HTTP/HTTPS 目标地址');
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    if (METADATA_HOSTS.has(hostname.toLowerCase())) throw fail('云元数据地址被禁止访问');
    let addresses;
    if (net.isIP(hostname)) addresses = [{address: hostname}];
    else {
        try { addresses = await dns.lookup(hostname, {all: true}); }
        catch { throw fail('目标地址无法解析'); }
    }
    for (const {address} of addresses) if (METADATA_ADDRESSES.has(String(address).toLowerCase())) throw fail('云元数据地址被禁止访问');
    const own = selfOrigins.some(origin => { try { return new URL(origin).origin === parsed.origin; } catch { return false; } });
    const allow = Array.isArray(allowlist) ? allowlist.filter(item => typeof item === 'string' && item.trim()) : [];
    if (allow.length && !own && !allow.some(entry => matchesEntry(entry, hostname, addresses))) throw fail('目标地址不在允许名单内');
    if (!allowPrivate && !own) {
        for (const {address} of addresses) if (isInternalAddress(address)) throw fail('内网地址已在设置中禁止访问');
    }
    return addresses;
}
