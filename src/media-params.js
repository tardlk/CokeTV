import {validateHeaderName, validateHeaderValue} from 'node:http';

const fail = message => Object.assign(new Error(message), {statusCode: 400});
// Query parsing has already removed one URL-encoding layer. Some legacy helpers
// add another; never decode an already recognizable URL (signed URLs need %XX).
const recognized = value => /^https?:\/\//i.test(value) || /^[{\[]/.test(value);
const base64Text = value => {
    // Legacy Python helpers inserted unescaped '+' into query values; query
    // decoding turns those into spaces. Restore them only on the base64 path.
    value = value.replace(/ /g, '+');
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value) || value.replace(/=+$/, '').length % 4 === 1) throw fail('媒体参数 base64 格式不正确');
    const bytes = Buffer.from(value, 'base64');
    if (bytes.toString('base64url') !== value.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')) throw fail('媒体参数 base64 格式不正确');
    try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { throw fail('媒体参数须为 UTF-8'); }
};
export function decodeMediaValue(value) {
    if (typeof value !== 'string' || !value) throw fail('媒体参数不能为空');
    if (recognized(value)) return value;
    if (value.includes('%')) {
        try { value = decodeURIComponent(value); } catch { throw fail('媒体参数 URL 编码不正确'); }
        if (recognized(value)) return value;
    }
    return base64Text(value);
}
export function decodeMediaTarget(value) {
    let url;
    try { url = new URL(decodeMediaValue(value)); } catch { throw fail('媒体地址无效'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw fail('只支持 HTTP/HTTPS 媒体地址');
    return url.href;
}
export function decodeMediaHeaders(fields) {
    // Presence, rather than truthiness, defines precedence. form is only a
    // historical hint: headers and header independently accept JSON/base64.
    const value = fields.headers !== undefined ? fields.headers : fields.header;
    if (value === undefined) return {};
    let headers;
    try { headers = JSON.parse(decodeMediaValue(value)); } catch { throw fail('媒体请求头须为 JSON 键值对象'); }
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw fail('媒体请求头须为 JSON 键值对象');
    for (const [name, value] of Object.entries(headers)) {
        try {
            if (typeof value !== 'string') throw new Error();
            validateHeaderName(name); validateHeaderValue(name, value);
        } catch { throw fail('媒体请求头名称或值无效'); }
    }
    return headers;
}
export function unwrapMediaProxy(value, base) {
    let parsed;
    try { parsed = new URL(value, base); } catch { return null; }
    if (parsed.origin !== new URL(base).origin || parsed.pathname !== '/mediaProxy') return null;
    const fields = Object.fromEntries(parsed.searchParams);
    return {url: decodeMediaTarget(fields.url), headers: decodeMediaHeaders(fields)};
}
