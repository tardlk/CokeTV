import {randomBytes, createHash} from 'node:crypto';
import {LRUCache} from 'lru-cache';
import {NetdiskAccountStore} from './accounts.js';
import {Pan115, parse115Share, LOGIN_DEVICES} from './pan115.js';

const prefix = 'coketv-netdisk:115:';
const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const safeName = name => String(name || '视频').replace(/[$#]/g, ' ').slice(0, 300);
function shareURL(value) {
    if (typeof value !== 'string') return null;
    let url = value;
    if (url.startsWith('push://')) {
        try { url = decodeURIComponent(url.slice(7)); } catch { return null; }
    }
    try { parse115Share(url); return url; } catch { return null; }
}
export class NetdiskService {
    constructor(accounts, pan) {
        this.accounts = accounts; this.pan = pan; this.inflight = new Map();
        this.refs = new LRUCache({max: 50000, maxSize: 64 * 1024 * 1024, ttl: 12 * 3600000, sizeCalculation: value => Buffer.byteLength(JSON.stringify(value))});
        this.shares = new LRUCache({max: 200, maxSize: 32 * 1024 * 1024, ttl: 10 * 60000, sizeCalculation: value => Buffer.byteLength(JSON.stringify(value))});
    }
    static async create(directory, request) {
        const accounts = await new NetdiskAccountStore(directory).init();
        return new NetdiskService(accounts, new Pan115({accounts, request}));
    }
    status() { return this.accounts.status(); }
    current(revision) { return !revision || (this.accounts.status().connected && revision === this.accounts.status().revision); }
    isReference(value) { return typeof value === 'string' && value.startsWith('coketv-netdisk:'); }
    async safely(fn) {
        try { return await fn(); }
        catch (error) {
            if (error.statusCode === 401) throw fail('115 尚未登录或登录失效，请管理员在网盘管理中重新扫码', 409);
            throw error;
        }
    }
    async files(source, url) {
        const revision = this.accounts.status().revision;
        if (!revision) throw fail('请管理员先在网盘管理中登录 115', 409);
        const key = createHash('sha256').update(JSON.stringify([source, revision, url])).digest('hex');
        if (this.shares.has(key)) return this.shares.get(key);
        if (this.inflight.has(key)) return this.inflight.get(key);
        if (this.inflight.size >= 4) throw fail('网盘分享读取繁忙，请稍后重试', 429);
        const pending = this.safely(async () => {
            const files = await this.pan.listShare(url);
            if (!this.current(revision)) throw fail('网盘账号已更新，请刷新影片详情', 409);
            const result = files.map(file => {
                const id = randomBytes(32).toString('base64url');
                this.refs.set(id, {source, revision, file});
                return {name: safeName(file.name), reference: prefix + id};
            });
            this.shares.set(key, result); return result;
        });
        this.inflight.set(key, pending);
        try { return await pending; } finally { this.inflight.delete(key); }
    }
    async resolve(reference, source) {
        const id = typeof reference === 'string' && reference.startsWith(prefix) ? reference.slice(prefix.length) : '';
        const entry = this.refs.get(id);
        if (!entry || entry.source !== source || !this.current(entry.revision)) throw fail('网盘分集引用无效或已过期，请刷新影片详情', 403);
        const media = await this.safely(() => this.pan.resolveFile(entry.file));
        if (!this.current(entry.revision)) throw fail('网盘账号已更新，请刷新影片详情', 409);
        return {parse: 0, url: media.url, header: media.headers, netdiskRevision: entry.revision, netdiskFileName: entry.file.name};
    }
    async expand(result, source) {
        let value = result;
        if (typeof result === 'string') { try { value = JSON.parse(result); } catch { return result; } }
        const list = Array.isArray(value?.list) ? value.list : value?.vod_play_url ? [value] : Array.isArray(value) ? value : null;
        if (!list) return result;
        let count = 0, changed = false;
        const expanded = [];
        for (const vod of list) {
            if (typeof vod?.vod_play_url !== 'string') { expanded.push(vod); continue; }
            const lines = vod.vod_play_url.split('$$$'), next = [];
            for (const line of lines) {
                const episodes = [];
                for (const episode of line.split('#')) {
                    const separator = episode.indexOf('$'), raw = separator < 0 ? episode : episode.slice(separator + 1), url = shareURL(raw);
                    if (!url) { episodes.push(episode); continue; }
                    if (++count > 8) throw fail('本次影片详情中的网盘分享过多，请缩小范围', 413);
                    const files = await this.files(source, url);
                    episodes.push(...files.map(file => `${file.name}$${file.reference}`)); changed = true;
                }
                next.push(episodes.join('#'));
            }
            expanded.push({...vod, vod_play_url: next.join('$$$')});
        }
        if (!changed) return result;
        const output = Array.isArray(value?.list) ? {...value, list: expanded} : Array.isArray(value) ? expanded : expanded[0];
        return typeof result === 'string' ? JSON.stringify(output) : output;
    }
    async execute(resolved, query, env, runner, operation = 'api') {
        if (operation === 'api' && this.isReference(query.play)) return this.resolve(query.play, resolved.instance.id);
        const result = await runner.run({engine: resolved.script.engine, file: resolved.file, instanceId: resolved.instance.id}, query, env, operation);
        return operation === 'api' && query.ac === 'detail' && query.ids !== undefined ? this.expand(result, resolved.instance.id) : result;
    }
    register(app) {
        app.get('/admin/netdisk', async () => ({providers: [{id: '115', name: '115 网盘', ...this.status()}]}));
        app.post('/admin/netdisk/115/login', async req => this.safely(() => this.pan.startLogin(req.body?.device || 'alipaymini')));
        app.get('/admin/netdisk/115/login/:id/image', async req => ({image: 'data:image/png;base64,' + (await this.pan.qrImage(req.params.id)).toString('base64')}));
        app.post('/admin/netdisk/115/login/:id/poll', async req => this.safely(() => this.pan.pollLogin(req.params.id)));
        // Authenticated operational import for migrating an already-scanned
        // local account. Credentials never enter source state or responses.
        app.post('/admin/netdisk/115/account', async req => {
            if (!LOGIN_DEVICES.includes(req.body?.device)) throw fail('不支持这个登录设备');
            try { return {account: await this.accounts.save115(req.body?.cookie, req.body.device)}; }
            catch { throw fail('115 登录信息保存失败，请检查格式或服务器数据目录', 400); }
        });
    }
}
