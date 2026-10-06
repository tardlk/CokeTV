import dns from 'node:dns/promises';
import net from 'node:net';

const fail = (message, statusCode = 403) => Object.assign(new Error(message), {statusCode});
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata', 'instance-data', 'metadata.goog']);

// Convert valid IPs to bytes, collapsing IPv4-mapped IPv6 to IPv4. URL
// parsing renders dotted mapped tails in hex, defeating textual prefix checks.
function ipBytes(address) {
    if (typeof address !== 'string') return null;
    const family = net.isIP(address);
    if (family === 4) return {family, bytes: Buffer.from(address.split('.').map(Number))};
    if (family !== 6 || address.includes('%')) return null;
    let value = address.toLowerCase();
    if (value.includes('.')) {
        const last = value.lastIndexOf(':');
        const tail = value.slice(last + 1).split('.').map(Number);
        value = `${value.slice(0, last)}:${((tail[0] << 8) | tail[1]).toString(16)}:${((tail[2] << 8) | tail[3]).toString(16)}`;
    }
    const [first, second] = value.split('::');
    const left = first ? first.split(':') : [], right = second ? second.split(':') : [];
    const parts = second === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
    const bytes = Buffer.alloc(16);
    parts.forEach((part, index) => bytes.writeUInt16BE(parseInt(part, 16), index * 2));
    if (bytes.subarray(0, 10).every(byte => byte === 0) && bytes[10] === 255 && bytes[11] === 255) return {family: 4, bytes: bytes.subarray(12)};
    return {family, bytes};
}
const ipKey = address => {
    const ip = ipBytes(address);
    return ip ? `${ip.family}:${ip.bytes.toString('hex')}` : '';
};
const METADATA_ADDRESSES = new Set(['169.254.169.254', '100.100.100.200', 'fd00:ec2::254', '169.254.170.2'].map(ipKey));

export function isInternalAddress(address) {
    const ip = ipBytes(address);
    if (!ip) return false;
    const [a, b] = ip.bytes;
    if (ip.family === 4) return a === 0 || a === 10 || a === 127 ||
        (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
    return ip.bytes.every(byte => byte === 0) ||
        (ip.bytes.subarray(0, 15).every(byte => byte === 0) && ip.bytes[15] === 1) ||
        (a & 0xfe) === 0xfc || (a === 0xfe && (b & 0xc0) === 0x80) || a === 0xff;
}
function inCidr(address, entry) {
    const [rawBase, rawBits, extra] = entry.split('/');
    const base = rawBase.replace(/^\[|\]$/g, '');
    const ip = ipBytes(address), network = ipBytes(base);
    if (!ip || !network || extra !== undefined || ip.family !== network.family) return false;
    if (rawBits === undefined) return ip.bytes.equals(network.bytes);
    if (!/^\d+$/.test(rawBits)) return false;
    let bits = Number(rawBits);
    if (net.isIP(base) === 6 && network.family === 4) bits -= 96;
    if (bits < 0 || bits > network.bytes.length * 8) return false;
    const whole = Math.floor(bits / 8), remainder = bits % 8;
    return ip.bytes.subarray(0, whole).equals(network.bytes.subarray(0, whole)) &&
        (!remainder || (ip.bytes[whole] >> (8 - remainder)) === (network.bytes[whole] >> (8 - remainder)));
}
const hostKey = hostname => hostname.toLowerCase().replace(/\.$/, '');
function matchesHost(entry, hostname) {
    const value = hostKey(entry);
    if (ipBytes(value.replace(/^\[|\]$/g, '')) || value.includes('/')) return false;
    return value === hostname || (value.startsWith('*.') && hostname.endsWith(value.slice(1)));
}
// Return ONLY checked addresses; connections must use these without resolving
// again. Every redirect is a separate check and connection.
export async function assertTargetAllowed(url, {allowPrivate = true, allowlist = [], selfOrigins = []} = {}) {
    let parsed;
    try { parsed = new URL(url); } catch { throw fail('目标地址无效'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw fail('只支持 HTTP/HTTPS 目标地址');
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    if (METADATA_HOSTS.has(hostKey(hostname))) throw fail('云元数据地址被禁止访问');
    let addresses;
    if (net.isIP(hostname)) addresses = [{address: hostname, family: net.isIP(hostname)}];
    else {
        try { addresses = await dns.lookup(hostname, {all: true}); }
        catch { throw fail('目标地址无法解析'); }
    }
    if (!Array.isArray(addresses) || !addresses.length || addresses.some(entry => !ipBytes(entry?.address))) throw fail('目标地址无法解析');
    addresses = addresses.map(({address}) => ({address, family: net.isIP(address)}));
    for (const {address} of addresses) if (METADATA_ADDRESSES.has(ipKey(address))) throw fail('云元数据地址被禁止访问');
    const own = selfOrigins.some(origin => { try { return new URL(origin).origin === parsed.origin; } catch { return false; } });
    if (!allowPrivate && !own && addresses.some(({address}) => isInternalAddress(address))) throw fail('内网地址已在设置中禁止访问');
    const allow = Array.isArray(allowlist) ? allowlist.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().toLowerCase()) : [];
    if (allow.length && !own && !allow.some(entry => matchesHost(entry, hostKey(hostname)))) {
        addresses = addresses.filter(({address}) => allow.some(entry => inCidr(address, entry)));
        if (!addresses.length) throw fail('目标地址不在允许名单内');
    }
    return addresses;
}
