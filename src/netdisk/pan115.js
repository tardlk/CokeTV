import {randomBytes} from 'node:crypto';
import JSONbig from 'json-bigint';
import {guardedHttp} from '../outbound.js';
import {assertTargetAllowed} from '../ssrf.js';
import {validate115Cookie} from './accounts.js';
import {encodeM115, decodeM115} from './m115.js';

const json = JSONbig({storeAsString: true, protoAction: 'error', constructorAction: 'error'});
const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const hosts = new Set(['115.com', '115cdn.com', 'anxia.com']);
export const LOGIN_DEVICES = ['alipaymini', 'wechatmini', 'tv', 'web', 'android', 'ios', 'qandroid'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MEDIA = /\.(?:mp4|mkv|webm|m4v|mov|avi|flv|ts|m2ts|mpeg|mpg|wmv|3gp)$/i;
const idText = value => {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw fail('115 文件标识超过安全范围');
    const id = String(value ?? '');
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw fail('115 文件标识无效');
    return id;
};
export function parse115Share(input, passcode = '') {
    let url;
    try { url = new URL(input); } catch { throw fail('请输入完整的 115 分享链接'); }
    const match = url.pathname.match(/^\/s\/([A-Za-z0-9]+)\/?$/);
    if (!['https:', 'http:'].includes(url.protocol) || !hosts.has(url.hostname) || url.port || url.username || url.password || !match) throw fail('不是有效的 115 分享链接');
    const receiveCode = passcode || url.searchParams.get('password') || '';
    if (typeof receiveCode !== 'string' || !/^[A-Za-z0-9]{0,20}$/.test(receiveCode)) throw fail('115 提取码格式不正确');
    return {shareCode: match[1], receiveCode};
}

// Platform protocol researched from SheltonZhu/115driver v1.3.5 (MIT).
// No third-party OAuth relay, account password, upload or transfer API is used.
export class Pan115 {
    constructor({accounts, request, now = Date.now, pageSize = 100, maxFiles = 10000, maxDirectories = 500, cipher} = {}) {
        this.accounts = accounts; this.now = now; this.pageSize = pageSize;
        this.maxFiles = maxFiles; this.maxDirectories = maxDirectories;
        this.sessions = new Map();
        this.cipher = cipher || {encode: encodeM115, decode: decodeM115};
        this.useAppShare = false;
        this.request = request || (options => guardedHttp({...options, maxRedirects: 0}, url => assertTargetAllowed(url, {allowPrivate: false})));
    }
    async call(url, {method = 'GET', params, data, authenticated = false, timeout = 20000, share} = {}) {
        const headers = {'User-Agent': UA, Accept: 'application/json'};
        if (authenticated) {
            const cookie = this.accounts.cookie();
            if (!cookie) throw fail('请先扫码登录 115', 401);
            headers.Cookie = validate115Cookie(cookie);
            headers.Referer = share ? `https://115cdn.com/s/${share.shareCode}?password=${encodeURIComponent(share.receiveCode)}&` : 'https://115cdn.com/';
        }
        if (data !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
        let result;
        try { result = await this.request({url, method, params, data, headers, timeout, responseType: 'text'}); }
        catch (cause) { throw Object.assign(fail('115 网络请求失败，请稍后重试', 502), {retryable: ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(cause.code)}); }
        if (result.status !== 200) throw fail('115 接口暂不可用，请稍后重试', 502);
        let value;
        try {
            if (typeof result.data === 'string' && Buffer.byteLength(result.data) > 2 * 1024 * 1024) throw new Error('large');
            value = typeof result.data === 'string' ? json.parse(result.data) : result.data;
        } catch { throw fail('115 接口返回格式异常', 502); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('115 接口返回格式异常', 502);
        if (value.state === false || value.state === 0 || (value.errno && Number(value.errno) !== 0)) {
            const code = Number(value.errno ?? value.code);
            if (/登录|login|cookie/i.test(String(value.error || value.msg || value.message || ''))) throw fail('115 登录已失效，请重新扫码', 401);
            throw Object.assign(fail(`115 请求未成功${Number.isFinite(code) ? `（代码 ${code}）` : ''}，请检查分享或稍后重试`, 502), {apiCode: code});
        }
        return value.data;
    }
    async startLogin(device = 'alipaymini') {
        if (!LOGIN_DEVICES.includes(device)) throw fail('不支持这个登录设备');
        const now = this.now();
        for (const [id, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(id);
        if (this.sessions.size >= 8) throw fail('登录二维码过多，请稍后重试', 429);
        const value = await this.call('https://qrcodeapi.115.com/api/1.0/web/1.0/token');
        if (!value?.uid || !value.sign || !Number.isFinite(Number(value.time))) throw fail('115 没有返回有效二维码', 502);
        const id = randomBytes(24).toString('base64url'), expiresAt = now + 180000;
        this.sessions.set(id, {uid: String(value.uid), sign: String(value.sign), time: Number(value.time), device, expiresAt, status: 'waiting', lastPoll: -Infinity});
        return {id, expiresAt, device};
    }
    session(id) {
        const session = this.sessions.get(id);
        if (!session) throw fail('二维码不存在或已过期，请重新获取', 410);
        return session;
    }
    async qrImage(id) {
        const session = this.session(id);
        if (session.expiresAt <= this.now()) throw fail('二维码已过期，请重新获取', 410);
        if (session.image) return session.image;
        let response;
        try { response = await this.request({url: 'https://qrcodeapi.115.com/api/1.0/mac/1.0/qrcode', params: {uid: session.uid}, headers: {'User-Agent': UA}, timeout: 15000, responseType: 'arraybuffer', maxRedirects: 0}); }
        catch { throw fail('二维码图片获取失败，请重试', 502); }
        const bytes = Buffer.from(response.data || '');
        if (response.status !== 200 || bytes.length > 256 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw fail('二维码图片格式异常', 502);
        session.image = bytes; return bytes;
    }
    async pollLogin(id) {
        const session = this.session(id);
        if (session.pending) return session.pending;
        const result = () => ({status: session.status, account: this.accounts.status()});
        if (['confirmed', 'canceled', 'expired'].includes(session.status)) return result();
        if (session.expiresAt <= this.now()) { session.status = 'expired'; return result(); }
        if (this.now() - session.lastPoll < 2000) return result();
        session.lastPoll = this.now();
        session.pending = (async () => {
            const value = await this.call('https://qrcodeapi.115.com/get/status/', {params: {uid: session.uid, time: session.time, sign: session.sign, _: this.now()}, timeout: 45000});
            // The live endpoint ends an unscanned long poll after ~30 seconds
            // with state=1/code=0/data={}. It is not a confirmation or failure.
            if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return {...result(), retrying: true};
            const status = Number(value?.status);
            if (status === 2) {
                const login = await this.call(`https://passportapi.115.com/app/1.0/${session.device}/1.0/login/qrcode`, {method: 'POST', data: new URLSearchParams({app: session.device, account: session.uid}).toString()});
                const value = login?.cookie;
                if (!value || typeof value !== 'object') throw fail('115 没有返回完整登录信息', 502);
                const cookie = ['UID', 'CID', 'SEID', 'KID'].filter(key => value[key]).map(key => {
                    if (typeof value[key] !== 'string' || /[;\r\n]/.test(value[key])) throw fail('115 登录信息格式异常', 502);
                    return `${key}=${value[key]}`;
                }).join('; ');
                await this.accounts.save115(cookie, session.device); session.status = 'confirmed';
            } else if (status === -1) session.status = 'expired';
            else if (status === -2) session.status = 'canceled';
            else if (status === 1) session.status = 'scanned';
            else if (status === 0) session.status = 'waiting';
            else throw fail('115 扫码状态异常，请重新获取二维码', 502);
            return result();
        })();
        try { return await session.pending; }
        catch (error) { if (error.retryable) return {...result(), retrying: true}; throw error; }
        finally { session.pending = null; }
    }
    async listShare(input, passcode = '') {
        const share = parse115Share(input, passcode), files = [], queue = [{id: '', path: ''}], seen = new Set(['']);
        let requests = 0;
        while (queue.length) {
            const folder = queue.shift(); let offset = 0;
            for (;;) {
                if (++requests > 200) throw fail('分享目录请求超过验证上限，请缩小分享范围', 413);
                const data = await this.call('https://115cdn.com/webapi/share/snap', {authenticated: true, share, params: {...shareParams(share), cid: folder.id, limit: this.pageSize, offset, asc: 1, format: 'json'}});
                if (!data || Number(data.share_state ?? data.shareinfo?.share_state) === 7) throw fail('115 分享已失效或无法访问', 404);
                if (!Array.isArray(data.list)) throw fail('115 分享目录返回异常', 502);
                const total = Number(data.count || 0);
                if (!data.list.length) {
                    if (total > offset) throw fail('115 分享分页不完整，请稍后重试', 502);
                    break;
                }
                for (const item of data.list) {
                    const name = String(item.n ?? item.file_name ?? '');
                    if (String(item.fc) === '0') {
                        const id = idText(item.cid);
                        if (!seen.has(id)) {
                            if (seen.size >= this.maxDirectories) throw fail('分享文件夹数量超过验证上限', 413);
                            seen.add(id); queue.push({id, path: folder.path + name + '/'});
                        }
                    } else if (String(item.fc) === '1' && MEDIA.test(name)) {
                        if (files.length >= this.maxFiles) throw fail('分享视频数量超过验证上限', 413);
                        files.push({...share, fileId: idText(item.fid), name, path: folder.path + name, size: Number(item.s || 0)});
                    }
                }
                offset += data.list.length;
                if ((total > 0 && offset >= total) || (total === 0 && data.list.length < this.pageSize)) break;
                if (offset > 100000) throw fail('分享分页超过验证上限', 413);
            }
        }
        if (!files.length) throw fail('分享中没有视频文件', 404);
        return files.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', {numeric: true}) || a.path.localeCompare(b.path));
    }
    async resolveFile(file) {
        if (!file || !/^[A-Za-z0-9]+$/.test(file.shareCode) || !/^[A-Za-z0-9]{0,20}$/.test(file.receiveCode)) throw fail('115 播放引用无效');
        const appShare = async () => {
            const encoded = this.cipher.encode(JSON.stringify({...shareParams(file), file_id: idText(file.fileId)}));
            const encrypted = await this.call('https://proapi.115.com/app/share/downurl', {method: 'POST', authenticated: true, share: file, data: new URLSearchParams({data: encoded.data}).toString()});
            try { return json.parse(this.cipher.decode(encrypted, encoded.key)); }
            catch { throw fail('115 App 播放信息返回异常', 502); }
        };
        let value, usedApp = this.useAppShare;
        if (usedApp) value = await appShare();
        else {
            try { value = await this.call('https://115cdn.com/webapi/share/downurl', {authenticated: true, share: file, params: {...shareParams(file), file_id: idText(file.fileId), dl: 1}}); }
            catch (error) {
                if (error.apiCode !== 50029) throw error;
                value = await appShare(); usedApp = true;
            }
        }
        const url = value?.url?.url;
        let parsed;
        try { parsed = new URL(url); } catch { throw fail('115 未返回有效播放地址', 502); }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw fail('115 返回的播放地址不可用', 502);
        if (usedApp) this.useAppShare = true;
        // Keep the platform account Cookie off CDN requests. This share API's
        // download link is UA-bound; media gets that exact UA, server-side.
        return {url: parsed.href, headers: {'User-Agent': UA}};
    }
}
const shareParams = share => ({share_code: share.shareCode, receive_code: share.receiveCode});
