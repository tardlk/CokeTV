import Fastify from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createAuth} from '../src/auth.js';
import {Pan115} from '../src/netdisk/pan115.js';
import {NetdiskAccountStore} from '../src/netdisk/accounts.js';
import {createPlaybackSessions} from '../src/playback.js';
import {streamMedia} from '../src/media.js';
import {assertTargetAllowed} from '../src/ssrf.js';

const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
export async function createNetdiskVerifier({directory, password, request, mediaGuard = url => assertTargetAllowed(url, {allowPrivate: false})} = {}) {
    if (!directory || !password) throw new Error('须指定独立验证目录和访问密码');
    await fs.mkdir(directory, {recursive: true, mode: 0o700});
    const accounts = await new NetdiskAccountStore(directory).init();
    const pan = new Pan115({accounts, request});
    const auth = await createAuth({directory, atomic: async (file, body, options) => {
        const temp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
        try { await fs.writeFile(temp, body, {...options, flag: 'wx'}); await fs.rename(temp, file); }
        finally { await fs.rm(temp, {force: true}); }
    }});
    if (auth.needsSetup()) await auth.setup({body: {password, confirmPassword: password}});
    const app = Fastify({logger: false, bodyLimit: 65536});
    const tickets = createPlaybackSessions(), shares = new Map(), buckets = new Map();
    app.decorate('accounts', accounts);
    app.setErrorHandler((error, _request, reply) => {
        const message = error.statusCode ? error.message : '验证服务出现错误，请稍后重试';
        reply.code(error.statusCode || 500).send({error: message});
    });
    app.addHook('preHandler', async (req, reply) => {
        reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('X-Content-Type-Options', 'nosniff');
        const route = req.routeOptions?.url || '';
        if (route.startsWith('/api/')) {
            const ip = req.ip, now = Date.now(), bucket = buckets.get(ip);
            if (!bucket || now - bucket.start > 60000) buckets.set(ip, {start: now, count: 1});
            else if (++bucket.count > 120) throw fail('请求过于频繁，请稍后再试', 429);
            await auth.guard(req, reply);
            if (reply.sent) return;
            if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw fail('不允许跨站请求', 403);
        }
    });
    app.get('/health', async () => ({ok: true, purpose: '115-verification'}));
    app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send(await fs.readFile(new URL('./netdisk-verify.html', import.meta.url), 'utf8')));
    app.get('/api/status', async () => ({account: accounts.status()}));
    app.post('/api/login/start', async req => pan.startLogin(req.body?.device || 'alipaymini'));
    app.get('/api/login/:id/image', async (req, reply) => reply.type('image/png').send(await pan.qrImage(req.params.id)));
    app.post('/api/login/:id/poll', async req => pan.pollLogin(req.params.id));
    app.post('/api/share', async req => {
        const {url, passcode = ''} = req.body || {};
        if (typeof url !== 'string' || url.length > 2000) throw fail('请填写分享链接');
        if (typeof passcode !== 'string' || passcode.length > 20) throw fail('提取码格式不正确');
        const files = await pan.listShare(url.trim(), passcode.trim());
        const now = Date.now();
        for (const [id, value] of shares) if (value.expiresAt <= now) shares.delete(id);
        if (shares.size >= 16) shares.delete(shares.keys().next().value);
        const id = randomBytes(24).toString('base64url');
        shares.set(id, {files, revision: accounts.status().revision, expiresAt: now + 3600000});
        return {id, files: files.map((file, index) => ({index, name: file.name, path: file.path, size: file.size}))};
    });
    const mediaPath = (url, headers, revision, name = '') => {
        const ticket = tickets.create(revision, url, headers);
        const extension = /\.m3u8(?:[?#]|$)/i.test(url) ? 'm3u8' : name.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() || 'bin';
        return `/media/${ticket}/stream.${extension}`;
    };
    app.post('/api/play', async req => {
        const {share, index} = req.body || {}, entry = shares.get(share), revision = accounts.status().revision;
        if (!entry || entry.expiresAt <= Date.now() || entry.revision !== revision) throw fail('分享会话已过期，请重新读取', 410);
        if (!Number.isInteger(index) || index < 0 || !entry.files[index]) throw fail('请选择有效的分集');
        const file = entry.files[index], media = await pan.resolveFile(file);
        // Resolving one existing file does not permit caller-supplied URLs or IDs.
        return {url: mediaPath(media.url, media.headers, revision, file.name), name: file.name};
    });
    app.route({method: ['GET', 'HEAD'], url: '/media/:ticket/:file', handler: async (req, reply) => {
        const payload = tickets.get(req.params.ticket), revision = accounts.status().revision;
        if (!payload || payload.kind !== 'media' || payload.source !== revision || !accounts.cookie() || !/^stream\.[a-z0-9]+$/.test(req.params.file)) throw fail('播放链接已过期，请重新选择分集', 403);
        const base = `http://${req.headers.host}`;
        return streamMedia(payload.url, payload.headers, req, reply, {base, guard: mediaGuard,
            wrapUrl: url => base + mediaPath(url, payload.headers, revision)});
    }});
    return app;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const directory = process.env.NETDISK_TEST_DIR, password = process.env.NETDISK_TEST_PASSWORD;
    const app = await createNetdiskVerifier({directory, password});
    await app.listen({host: '127.0.0.1', port: Number(process.env.NETDISK_TEST_PORT) || 54061});
    console.log('115 独立验证服务已启动，仅本机访问。');
    const close = async () => { await app.close(); process.exit(); };
    process.on('SIGINT', close); process.on('SIGTERM', close);
}
