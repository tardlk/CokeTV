import {randomBytes, createHash} from 'node:crypto';
import {LRUCache} from 'lru-cache';
import {NetdiskAccountStore} from './accounts.js';
import {Pan115, parse115Share, LOGIN_DEVICES} from './pan115.js';
import {Guangya, parseGuangyaShare} from './guangya.js';
import {GuangyaAccountStore} from './guangya-account.js';

const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const safeName = name => String(name || '视频').replace(/[$#]/g, ' ').slice(0, 300);
function shareURL(value) {
    if (typeof value !== 'string') return null;
    let url = value;
    if (url.startsWith('push://')) {
        try { url = decodeURIComponent(url.slice(7)); } catch { return null; }
    }
    try { parse115Share(url); return url; } catch {}
    try { parseGuangyaShare(url); return url; } catch { return null; }
}
export class NetdiskService {
    constructor(accounts, pan, guangyaAccounts, guangya) {
        this.accounts = accounts; this.pan = pan; this.inflight = new Map();
        this.guangyaAccounts = guangyaAccounts; this.guangya = guangya;
        this.refs = new LRUCache({max: 50000, maxSize: 64 * 1024 * 1024, ttl: 12 * 3600000, sizeCalculation: value => Buffer.byteLength(JSON.stringify(value))});
        this.shares = new LRUCache({max: 200, maxSize: 32 * 1024 * 1024, ttl: 10 * 60000, sizeCalculation: value => Buffer.byteLength(JSON.stringify(value))});
    }
    static async create(directory, request, guangyaRequest) {
        const accounts = await new NetdiskAccountStore(directory).init();
        const guangyaAccounts = await new GuangyaAccountStore(directory).init();
        return new NetdiskService(accounts, new Pan115({accounts, request}), guangyaAccounts, new Guangya({accounts: guangyaAccounts, request: guangyaRequest}));
    }
    status() { return this.accounts.status(); }
    current(revision) {
        if (!revision) return true;
        if (typeof revision !== 'string') return false;
        const account = revision.startsWith('guangya:') ? this.guangyaAccounts : this.accounts;
        return !!account?.status().connected && revision === account.status().revision;
    }
    isReference(value) { return typeof value === 'string' && value.startsWith('coketv-netdisk:'); }
    async safely(fn, provider = '115') {
        try { return await fn(); }
        catch (error) {
            if (error.statusCode === 401) throw fail(`${provider} 尚未登录或登录失效，请管理员在网盘管理中重新扫码`, 409);
            throw error;
        }
    }
    async files(source, url) {
        let provider = '115';
        try { parse115Share(url); } catch { parseGuangyaShare(url); provider = 'guangya'; }
        const account = provider === '115' ? this.accounts : this.guangyaAccounts;
        const pan = provider === '115' ? this.pan : this.guangya;
        const label = provider === '115' ? '115' : '光鸭';
        const revision = account.status().revision;
        if (!revision) throw fail(`请管理员先在网盘管理中登录 ${label}`, 409);
        const key = createHash('sha256').update(JSON.stringify([source, revision, url])).digest('hex');
        if (this.shares.has(key)) return this.shares.get(key);
        if (this.inflight.has(key)) return this.inflight.get(key);
        if (this.inflight.size >= 4) throw fail('网盘分享读取繁忙，请稍后重试', 429);
        const pending = this.safely(async () => {
            const files = await pan.listShare(url);
            if (!this.current(revision)) throw fail('网盘账号已更新，请刷新影片详情', 409);
            const result = files.map(file => {
                const id = randomBytes(32).toString('base64url');
                this.refs.set(id, {source, revision, file, provider});
                return {name: safeName(file.name), reference: `coketv-netdisk:${provider}:` + id};
            });
            this.shares.set(key, result); return result;
        }, label);
        this.inflight.set(key, pending);
        try { return await pending; } finally { this.inflight.delete(key); }
    }
    // Internal stable locator only; never serialize it into public source responses.
    identity(reference, source) {
        const match = typeof reference === 'string' && reference.match(/^coketv-netdisk:(115|guangya):([A-Za-z0-9_-]{43})$/);
        const entry = match && this.refs.get(match[2]);
        if (!entry || entry.source !== source || entry.provider !== match[1] || !this.current(entry.revision)) throw fail('网盘分集引用已过期，请刷新详情', 403);
        return JSON.stringify([entry.provider, entry.file.shareCode || entry.file.shareId, String(entry.file.fileId)]);
    }
    async resolve(reference, source, options = {}) {
        const match = typeof reference === 'string' && reference.match(/^coketv-netdisk:(115|guangya):([A-Za-z0-9_-]{43})$/);
        const id = match ? match[2] : '';
        const entry = this.refs.get(id);
        if (!entry || entry.provider !== match[1] || entry.source !== source || !this.current(entry.revision)) throw fail('网盘分集引用无效或已过期，请刷新影片详情', 403);
        const pan = entry.provider === '115' ? this.pan : this.guangya;
        const media = await this.safely(() => pan.resolveFile(entry.file, options), entry.provider === '115' ? '115' : '光鸭');
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
        if (operation === 'api' && this.isReference(query.play)) return this.resolve(query.play, resolved.instance.id, {userAgent: env.mediaUserAgent});
        const result = await runner.run({engine: resolved.script.engine, file: resolved.file, instanceId: resolved.instance.id}, query, env, operation);
        return operation === 'api' && query.ac === 'detail' && query.ids !== undefined ? this.expand(result, resolved.instance.id) : result;
    }
    register(app) {
        app.get('/admin/netdisk', async () => ({providers: [{id: '115', name: '115 网盘', ...this.status()}, {id: 'guangya', name: '光鸭云盘', ...this.guangyaAccounts.status()}]}));
        app.post('/admin/netdisk/guangya/login', async () => this.safely(() => this.guangya.startLogin(), '光鸭'));
        app.get('/admin/netdisk/guangya/login/:id/image', async req => ({image: await this.guangya.qrImage(req.params.id)}));
        app.post('/admin/netdisk/guangya/login/:id/poll', async req => this.safely(() => this.guangya.pollLogin(req.params.id), '光鸭'));
        app.post('/admin/netdisk/guangya/account', async req => {
            const generation = this.guangyaAccounts.generation;
            await this.guangya.validateCredentials(req.body);
            return {account: await this.guangyaAccounts.save(req.body, generation)};
        });
        for (const [id, accounts, provider] of [['115', this.accounts, this.pan], ['guangya', this.guangyaAccounts, this.guangya]]) {
            app.post(`/admin/netdisk/${id}/account/remove`, async req => {
                const result = accounts.remove(req.body?.revision);
                provider.sessions.clear();
                return {account: await result};
            });
        }
        app.post('/admin/netdisk/guangya/options', async req => ({account: await this.guangyaAccounts.setTransferAllowed(req.body?.allowTransfer)}));
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
