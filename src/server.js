import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import formbody from '@fastify/formbody';
import staticPlugin from '@fastify/static';
import fs from 'fs/promises';
import path from 'path';
import net from 'net';
import {execFile} from 'child_process';
import {promisify} from 'util';
import {pathToFileURL} from 'url';
import dotenv from 'dotenv';
import {Store, token} from './store.js';
import {Runner} from './runner.js';
import {ROOT, ENGINE_DIRS, EXTENSIONS, inside, validFilename} from './paths.js';
import {createAuth} from './auth.js';
import {buildSubscription, authorizedSubscription} from './subscriptions.js';
import {buildContext} from './context.js';
import {localToken, rewritePlaylist, streamMedia} from './media.js';
import {syntaxCheck, importBundle, decodeSource, detectSourceEngine} from './sources.js';
import {sourceTemplate} from './source-templates.js';
import {createPlaybackSessions, playbackUrl, playbackHeaders, mediaType} from './playback.js';
import {assertTargetAllowed} from './ssrf.js';
import {guardedHttp} from './outbound.js';
import {decodeMediaTarget, decodeMediaHeaders, unwrapMediaProxy} from './media-params.js';
import {createTvboxImporter} from './tvbox-import.js';
import {registerCatSubscriptions} from './cat-subscriptions.js';
import {NetdiskService} from './netdisk/service.js';

dotenv.config();
const exec = promisify(execFile);
const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const checkString = (value, max = 200) => typeof value === 'string' && value.trim() && value.length <= max;
function validateEnvironment(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw fail('环境变量须为键值对象');
    if (Object.keys(values).length > 100 || JSON.stringify(values).length > 100000) throw fail('源环境变量超过限制');
    for (const [key, value] of Object.entries(values)) {
        if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw fail(`变量名无效：${key}`);
        if (!['string', 'number', 'boolean', 'object'].includes(typeof value) || value === null) throw fail(`变量值无效：${key}`);
    }
}

export async function createApp({directory, seed = true, netdiskRequest} = {}) {
    const store = await new Store(directory).init({seed});
    const runner = new Runner(store);
    const auth = await createAuth(store);
    const netdisk = await NetdiskService.create(store.directory, netdiskRequest);
    const playback = createPlaybackSessions();
    const tvboxImporter = createTvboxImporter(store);
    let catSubscriptions;
    const app = Fastify({logger: false, bodyLimit: 8 * 1024 * 1024, trustProxy: process.env.TRUST_PROXY === '1', routerOptions: {maxParamLength: 4096}});
    await app.register(formbody);
    await app.register(multipart, {limits: {fileSize: 16 * 1024 * 1024, files: 1}});
    app.decorate('store', store); app.decorate('runner', runner);
    app.decorate('netdisk', netdisk);
    app.setErrorHandler((error, request, reply) => {
        runner.log({level: 'error', message: error.message});
        reply.code(error.statusCode || 500).send({error: error.message, ...(error.importCode ? {code: error.importCode} : {})});
    });
    // 限流与鉴权失败计数。阈值可用 RATE_LIMIT_PER_MINUTE / ADMIN_AUTH_FAIL_PER_MINUTE 调整。
    // 注意：TRUST_PROXY=1 时 request.ip 取自 X-Forwarded-For，需确保前置反代可信且会覆写该头，
    // 否则攻击者可伪造 IP 绕过限流。
    const rateBuckets = new Map();
    const rateLimitPerMinute = Number(process.env.RATE_LIMIT_PER_MINUTE) || 1200;
    const adminFailLimit = Number(process.env.ADMIN_AUTH_FAIL_PER_MINUTE) || 20;
    const allowRequest = (key, max = rateLimitPerMinute) => {
        const now = Date.now();
        const bucket = rateBuckets.get(key);
        if (!bucket || now - bucket.start >= 60000) { rateBuckets.set(key, {start: now, count: 1}); return true; }
        bucket.count += 1;
        return bucket.count <= max;
    };
    const adminFailures = new Map();
    const adminFailureCount = key => {
        const bucket = adminFailures.get(key);
        return bucket && Date.now() - bucket.start < 60000 ? bucket.count : 0;
    };
    const recordAdminFailure = key => {
        const now = Date.now();
        const bucket = adminFailures.get(key);
        if (!bucket || now - bucket.start >= 60000) adminFailures.set(key, {start: now, count: 1});
        else bucket.count += 1;
        if (adminFailures.size > 20000) adminFailures.clear();
    };
    // 鉴权必须基于「匹配到的路由模式」，不能用原始请求 URL：Fastify 用解码后的路径
    // 做路由匹配，而 request.url 保留百分号编码与 absolute-form 形态，二者不一致会
    // 产生 `/ %61 dmin/state`、`GET http://host/admin/state` 等绕过路径（曾导致未授权 RCE）。
    // 注意 `/admin`（SPA 外壳，不带斜杠）刻意保持公开：管理页面本身要先加载出登录框。
    const ADMIN_ROUTES = /^\/admin\//;
    app.addHook('preHandler', async (request, reply) => {
        const route = request.routeOptions?.url || '';
        if (route === '/admin/access/setup') return;
        if (!ADMIN_ROUTES.test(route)) return;
        const ip = request.ip || request.raw?.socket?.remoteAddress || 'local';
        // /admin/* 一并限流：密码校验（scrypt）再便宜也不该被未鉴权请求无限触发。
        if (!allowRequest(`admin:${ip}`)) return reply.code(429).send({error: '管理接口请求过于频繁，请稍后再试'});
        if (adminFailureCount(`adminfail:${ip}`) >= adminFailLimit) return reply.code(429).send({error: '访问密码尝试过于频繁，请稍后再试'});
        await auth.guard(request, reply);
        // 只在真正鉴权失败时计数，正常登录不受影响。
        if (reply.statusCode === 401) recordAdminFailure(`adminfail:${ip}`);
        if (!reply.sent && route.startsWith('/admin/netdisk/') && request.method === 'POST' && request.headers.origin) {
            const origins = [`${request.protocol}://${request.headers.host}`, store.state.settings.publicUrl].filter(Boolean).map(value => { try { return new URL(value).origin; } catch { return ''; } });
            if (!origins.includes(request.headers.origin)) throw fail('不允许跨站修改网盘账号', 403);
        }
    });
    app.get('/access/status', async () => ({requiresSetup: auth.needsSetup()}));
    app.post('/admin/access/setup', async request => auth.setup(request));
    app.addHook('onClose', async () => runner.close());
    netdisk.register(app);
    const baseUrl = request => store.state.settings.publicUrl.replace(/\/$/, '') || `${request.protocol}://${request.headers.host}`;
    const contextFor = (request, instance, script, extra) => ({...buildContext(baseUrl(request), instance, script, extra), sourceEnvPath: store.state.instances.some(s => s.id === instance.id) ? store.sourceEnvPath(instance.id) : null, localPort: app.server.address()?.port || Number(process.env.PORT) || 54058});
    const serveMedia = async (request, reply, target, headers, suppliedToken, mint, wrapUrl) => {
        const base = baseUrl(request);
        const parsed = new URL(target);
        const ownPort = app.server.address()?.port || Number(process.env.PORT) || 54058;
        const own = parsed.origin === new URL(base).origin || (['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && Number(parsed.port) === ownPort);
        if (own) {
            const originalHost = parsed.host;
            // Native media loops back behind the proxy: remove the external mount.
            const mount = new URL(base).pathname.replace(/\/$/, '');
            if (wrapUrl && mount && parsed.pathname.startsWith(mount + '/')) parsed.pathname = parsed.pathname.slice(mount.length);
            if (suppliedToken) parsed.searchParams.set('token', suppliedToken);
            parsed.protocol = 'http:'; parsed.host = `127.0.0.1:${ownPort}`;
            headers = {...headers, host: originalHost};
            if (await auth.isAdmin(request)) headers.authorization = request.headers.authorization;
            if (request.headers['x-drpy-runtime'] === runner.internalKey) headers['x-drpy-runtime'] = runner.internalKey;
        }
        return streamMedia(parsed.href, headers, request, reply, {base, token: suppliedToken, mint, wrapUrl, guard: targetGuard});
    };
    // 代理出口 SSRF 策略：永久拒绝云元数据；内网/回环可按设置开关；可选白名单。
    const selfOrigins = () => {
        const port = app.server.address()?.port || Number(process.env.PORT) || 54058;
        return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
    };
    const targetGuard = url => assertTargetAllowed(url, {
        allowPrivate: store.state.settings.allowPrivateTargets !== false,
        allowlist: store.state.settings.targetAllowlist || [],
        selfOrigins: selfOrigins(),
    });
    // 调用方提供的出站请求头白名单：禁止改写 Host/Cookie/Authorization/转发头，
    // 否则 /mediaProxy 会变成「带自定义请求头的开放代理」。源能力票据绑定的头不受此限。
    const BLOCKED_PROXY_HEADERS = new Set(['host', 'cookie', 'authorization', 'proxy-authorization', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-drpy-runtime', 'connection', 'content-length', 'transfer-encoding']);
    const safeProxyHeaders = value => Object.fromEntries(Object.entries(playbackHeaders(value)).filter(([key]) => !BLOCKED_PROXY_HEADERS.has(key.toLowerCase())));
    // 「源返回」的头发往上游时用 playbackHeaders 的同口径净化：只屏蔽
    // host/x-drpy-runtime/connection/content-length 与换行，**保留 Cookie/Authorization**——
    // 站点登录媒体拉流普遍依赖它们。只有调用方传入的头才用上面的 safeProxyHeaders。
    const sanitizeSourceHeaders = value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        return playbackHeaders(value);
    };
    // 源执行 / 源代理入口：管理员、内部运行时或订阅 Token。
    const authorize = async (request, id) => {
        if (await auth.isAdmin(request) || request.headers['x-drpy-runtime'] === runner.internalKey) return null;
        const ticket = playback.allows(request, id) ? playback.get(request.query.token) : null;
        if (ticket) return {token: request.query.token, headers: ticket.headers || {}};
        const sub = authorizedSubscription(store.state, request.query.token || request.body?.token, id);
        if (!sub) throw fail('订阅访问凭证无效或该源不在订阅中', 403);
        return sub;
    };
    // 需要凭据但无 URL 绑定的服务入口（图片、/http、webdav/ftp 网关）：不接受播放票。
    const authorizeService = async request => {
        if (await auth.isAdmin(request) || request.headers['x-drpy-runtime'] === runner.internalKey) return null;
        const sub = authorizedSubscription(store.state, request.query.token || request.body?.token);
        if (!sub) throw fail('访问凭证无效', 403);
        return sub;
    };
    // 代理出口：管理员/内部、订阅 Token，或一张恰好绑定到该 URL 的代理能力票。
    const authorizeProxy = async (request, target) => {
        const ticket = playback.get(request.query.token);
        if (ticket && ticket.kind === 'proxy' && target && ticket.url === target && netdisk.current(ticket.netdiskRevision) && (!ticket.source || store.state.instances.some(item => item.id === ticket.source && item.enabled))) return ticket;
        if (await auth.isAdmin(request) || request.headers['x-drpy-runtime'] === runner.internalKey) return {kind: 'admin'};
        const sub = authorizedSubscription(store.state, request.query.token || request.body?.token);
        if (sub) return {kind: 'subscription', token: sub.token};
        throw fail('媒体访问凭证无效或已过期', 403);
    };
    const sourceFor = request => {
        const engine = Object.keys(ENGINE_DIRS).includes(request.query.do) ? request.query.do : 'js';
        const result = store.resolve(request.params.module, engine);
        if (request.query.extend) {
            const instance = store.state.instances.find(s => s.scriptId === result.script.id && s.enabled && s.params === request.query.extend);
            if (instance) result.instance = instance;
        }
        return result;
    };
    const run = async (request, query, operation = 'api') => {
        const {script, instance, file} = sourceFor(request);
        const sub = await authorize(request, instance.id);
        const env = contextFor(request, instance, script, {token: sub?.token, proxyPath: request.params['*'] || ''});
        const result = await netdisk.execute({script, instance, file}, query, env, runner, operation);
        return {result, sub, instance, script, env};
    };

    // 安全响应头与公开接口限流（低危收敛 L1/L2）：/health 只回 {ok, version}，
    // 详细运行信息移到需鉴权的 /admin/health。
    app.addHook('onSend', async (request, reply, payload) => {
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Referrer-Policy', 'no-referrer');
        reply.header('X-Frame-Options', 'SAMEORIGIN');
        if (request.routeOptions?.url?.startsWith('/admin/netdisk')) reply.header('Cache-Control', 'private, no-store');
        return payload;
    });
    const URL_PROXY_ROUTES = ['/unified-proxy/proxy', '/file-proxy/proxy', '/m3u8-proxy/playlist', '/m3u8-proxy/ts', '/m3u8-proxy/proxy'];
    const TICKET_RATE_ROUTES = new Set(['/mediaProxy', '/req/*', ...URL_PROXY_ROUTES]);
    const PUBLIC_RATE_PATHS = /^\/(?:cat\/|watch\/|mediaProxy$|req\/|m3u8-proxy\/|unified-proxy\/|file-proxy\/|proxy\/|subscription\/|config$|config\/)/;
    app.addHook('onRequest', async (request, reply) => {
        const route = request.routeOptions?.url || '';
        if (!PUBLIC_RATE_PATHS.test(route)) return;
        if (['GET', 'HEAD'].includes(request.method) && route === '/cat/:id/:credential/media/:source/:ticket/:file' && catSubscriptions?.allowsMedia(request)) return;
        // 只豁免 GET/HEAD 媒体转发中绑定当前目标 URL 的 proxy 票据，保留 HLS 分片/key 的余量。
        // media 票据可驱动同源 /proxy/ 执行源逻辑（不绑定 URL），必须照常计入公开限流。
        if (['GET', 'HEAD'].includes(request.method) && TICKET_RATE_ROUTES.has(route)) {
            const ticket = playback.get(request.query.token);
            let target;
            try { target = route === '/req/*' ? request.params['*'] : decodeMediaTarget(request.query.url); } catch {}
            if (ticket?.kind === 'proxy' && target && ticket.url === target && netdisk.current(ticket.netdiskRevision) && (!ticket.source || store.state.instances.some(item => item.id === ticket.source && item.enabled))) return;
        }
        if (rateBuckets.size > 20000) rateBuckets.clear();
        if (!allowRequest(`public:${request.ip || request.raw?.socket?.remoteAddress || 'local'}`)) reply.code(429).send({error: '请求过于频繁，请稍后再试'});
    });
    app.get('/health', async () => ({ok: true, version: '0.1.0'}));
    app.get('/admin/health', async () => ({ok: true, version: '0.1.0', memory: process.memoryUsage(), runtime: runner.status()}));
    app.get('/admin/state', async request => { await store.refreshEnvironment(); return {...store.state, runtime: runner.status(), baseUrl: baseUrl(request)}; });
    app.get('/watch/sources', async () => store.state.instances.filter(instance => instance.enabled).flatMap(instance => {
        const script = store.state.scripts.find(item => item.id === instance.scriptId);
        return script ? [{id: instance.id, name: instance.name, enabled: true, searchable: instance.searchable, filterable: instance.filterable, script: {engine: script.engine}}] : [];
    }));
    const watchSource = request => {
        if (!store.state.instances.some(instance => instance.id === request.params.id)) throw fail('源不存在', 404);
        const resolved = store.resolve(request.params.id);
        if (!resolved.instance.enabled) throw fail('此源已停用，请选择其他源', 409);
        return resolved;
    };
    const watchHandler = async request => {
        const {instance, script, file} = watchSource(request);
        const {ac, t, pg = '1', wd, ids, ext} = request.query;
        let query = {};
        if (wd !== undefined) {
            if (!instance.searchable) throw fail('此源不支持搜索');
            if (!checkString(wd, 200)) throw fail('搜索内容不能为空');
            query = {wd, pg};
        } else if (ac === 'detail') {
            if (!checkString(ids, 10000)) throw fail('影片 ID 无效');
            query = {ac, ids};
        } else if (ac === 'list') query = {ac, t: t || '', pg, ...(ext ? {ext} : {})};
        return netdisk.execute({script, instance, file}, query, contextFor(request, instance, script), runner);
    };
    app.get('/watch/sources/:id', watchHandler);
    app.get('/admin/watch/:id', watchHandler);
    const playHandler = async (request, {native = false, subscription = null} = {}) => {
        const {instance, script, file} = watchSource(request);
        const {play, flag = '', parser} = request.body || {};
        if (!checkString(play, 50000) || typeof flag !== 'string') throw fail('请选择要播放的剧集');
        const env = contextFor(request, instance, script, {token: subscription?.token});
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
        if (native) return {parse: 0, url, headers, type: mediaType(url, result.type) || result.netdiskFileName?.match(/\.(mkv|mp4|m4v|webm|mov|avi)$/i)?.[1]?.toLowerCase() || '', ...(result.netdiskRevision ? {netdiskRevision: result.netdiskRevision} : {})};
        const ticket = playback.create(instance.id, url, headers, result.netdiskRevision ? {netdiskRevision: result.netdiskRevision} : {});
        return {url: `/watch/media/${ticket}`, type: mediaType(url, result.type), parses: options, parser: parser ?? null};
    };
    app.post('/watch/sources/:id/play', playHandler);
    app.post('/admin/watch/:id/play', playHandler);
    catSubscriptions = registerCatSubscriptions(app, {
        store, baseUrl, serveMedia,
        execute: (request, resolved, query, sub) => netdisk.execute(resolved, query, contextFor(request, resolved.instance, resolved.script, {token: sub.token}), runner),
        isNetdiskCurrent: revision => netdisk.current(revision),
        play: (request, {instance}, body, subscription) => {
            const nativeRequest = Object.create(request);
            nativeRequest.params = {id: instance.id}; nativeRequest.body = body;
            return playHandler(nativeRequest, {native: true, subscription});
        },
    });
    app.route({method: ['GET', 'HEAD'], url: '/watch/media/:ticket', handler: async (request, reply) => {
        const session = playback.get(request.params.ticket);
        if (!session || session.kind !== 'media' || !netdisk.current(session.netdiskRevision) || !store.state.instances.some(item => item.id === session.source && item.enabled)) throw fail('播放链接已过期，请重新选择剧集', 403);
        // 只抓服务端票据绑定的 URL 与请求头，绝不接受请求方传入的目标。
        return serveMedia(request, reply, session.url, session.headers || {}, request.params.ticket,
            url => playback.createProxy(url, session.headers || {}, session.netdiskRevision ? {netdiskRevision: session.netdiskRevision, source: session.source} : {}));
    }});
    app.get('/admin/logs', async request => runner.logs.filter(entry => !request.query.source || entry.source === request.query.source).slice(-150));
    app.post('/admin/scan', async () => ({added: await store.mutate(() => store.scan())}));
    app.get('/admin/instances/:id/environment', async request => {
        await store.refreshEnvironment();
        return {values: await store.readSourceEnvironment(request.params.id), defaults: store.state.settings.env};
    });
    app.put('/admin/instances/:id/environment', async request => {
        const values = request.body?.values;
        validateEnvironment(values);
        await store.atomic(store.sourceEnvPath(request.params.id), JSON.stringify(values, null, 2), {mode: 0o600});
        await fs.chmod(store.sourceEnvPath(request.params.id), 0o600);
        runner.reset('源环境变量已更新');
        return {ok: true};
    });
    app.get('/admin/scripts/:id', async request => {
        const script = store.state.scripts.find(s => s.id === request.params.id);
        if (!script) throw fail('脚本不存在', 404);
        let revisions = [];
        try { revisions = (await fs.readdir(path.join(store.directory, 'revisions', script.id))).sort().reverse().slice(0, 20); } catch {}
        return {...script, code: await decodeSource(script.engine, await fs.readFile(store.scriptPath(script), 'utf8')), revisions};
    });
    app.post('/admin/scripts/create', async request => {
        const {type, name} = request.body || {};
        if (!['js', 'py', 'php'].includes(type) || !checkString(name, 176)) throw fail('请选择类型并填写脚本名');
        const scriptName = name.trim();
        const file = scriptName + EXTENSIONS[type];
        validFilename(type, file);
        const code = sourceTemplate(type, scriptName);
        await syntaxCheck(type, file, code, store.state.settings);
        return store.saveScript(type, file, code, {createOnly: true});
    });
    app.post('/admin/scripts', async request => {
        const {engine, name, code} = request.body || {};
        validFilename(engine, name);
        if (typeof code !== 'string' || !code.trim()) throw fail('脚本内容不能为空');
        await syntaxCheck(engine, name, code, store.state.settings);
        const result = await store.saveScript(engine, name, code);
        runner.reset('脚本已更新');
        return result;
    });
    app.post('/admin/scripts/:id/restore', async request => {
        const script = store.state.scripts.find(s => s.id === request.params.id);
        if (!script) throw fail('脚本不存在', 404);
        const revision = request.body?.revision;
        if (!/^\d+-[a-f0-9]+\.txt$/.test(revision || '')) throw fail('版本无效');
        const code = await fs.readFile(inside(path.join(store.directory, 'revisions', script.id), revision), 'utf8');
        await syntaxCheck(script.engine, script.file, code, store.state.settings);
        await store.saveScript(script.engine, script.file, code); runner.reset();
        return {ok: true};
    });
    app.post('/admin/upload', async request => {
        let engine = 'auto'; let file;
        for await (const part of request.parts()) {
            if (part.type === 'file') file = {name: part.filename, bytes: await part.toBuffer()};
            else if (part.fieldname === 'engine') engine = part.value;
        }
        if (!file) throw fail('请选择文件');
        let result;
        if (/\.zip$/i.test(file.name)) result = await importBundle(store, engine, file.bytes);
        else {
            const code = file.bytes.toString('utf8');
            if (engine === 'auto') engine = await detectSourceEngine(file.name, code);
            validFilename(engine, file.name, {library: true});
            await syntaxCheck(engine, file.name, code, store.state.settings);
            if (file.name.startsWith('_')) {
                await store.atomic(inside(store.runtime, `spider/${ENGINE_DIRS[engine]}/${file.name}`), code);
                result = {files: 1, library: true};
            } else result = await store.saveScript(engine, file.name, code);
        }
        runner.reset('源包已更新'); return result;
    });
    app.post('/admin/import/tvbox/preview', async request => tvboxImporter.preview(request.body?.url));
    app.post('/admin/import/tvbox', async request => {
        const result = await tvboxImporter.commit(request.body);
        if (result.imported) runner.reset('TVBox 源已导入');
        return result;
    });
    const instanceFields = body => {
        if (!checkString(body.name)) throw fail('站点名称不能为空');
        if (typeof body.params !== 'string' || body.params.length > 50000) throw fail('参数必须为文本，且小于 50KB');
        return {name: body.name.trim(), params: body.params, enabled: !!body.enabled, searchable: !!body.searchable,
            filterable: !!body.filterable};
    };
    app.post('/admin/instances', async request => {
        const body = request.body || {}; const fields = instanceFields(body);
        if (!store.state.scripts.some(s => s.id === body.scriptId)) throw fail('脚本不存在');
        return store.mutate(state => {
            const instance = {id: token().slice(0, 16), scriptId: body.scriptId, ...fields};
            state.instances.push(instance); return instance;
        });
    });
    app.put('/admin/instances/:id', async request => {
        const fields = instanceFields(request.body || {});
        const result = await store.mutate(state => {
            const instance = state.instances.find(s => s.id === request.params.id);
            if (!instance) throw fail('站点不存在', 404);
            Object.assign(instance, fields); return instance;
        });
        runner.reset('站点参数已更新'); return result;
    });
    app.post('/admin/instances/batch', async request => {
        const {ids, enabled} = request.body || {};
        if (!Array.isArray(ids) || typeof enabled !== 'boolean') throw fail('批量参数无效');
        await store.mutate(state => { for (const instance of state.instances) if (ids.includes(instance.id)) instance.enabled = enabled; });
        return {ok: true};
    });
    app.delete('/admin/instances/batch', async request => {
        const ids = request.body?.ids;
        if (!Array.isArray(ids) || !ids.length || ids.length > 10000 || ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw fail('请选择需要删除的源');
        const selected = new Set(ids);
        const deleted = await store.mutate(state => {
            const count = state.instances.filter(item => selected.has(item.id)).length;
            state.instances = state.instances.filter(item => !selected.has(item.id));
            for (const sub of state.subscriptions) sub.instances = sub.instances.filter(id => !selected.has(id));
            return count;
        });
        if (deleted) runner.reset('所选源已删除');
        return {ok: true, deleted};
    });
    app.delete('/admin/instances/:id', async request => {
        await store.mutate(state => {
            state.instances = state.instances.filter(s => s.id !== request.params.id);
            for (const sub of state.subscriptions) sub.instances = sub.instances.filter(id => id !== request.params.id);
        });
        runner.reset(); return {ok: true};
    });
    app.post('/admin/verify/:id', async request => {
        const {script, instance, file} = store.resolve(request.params.id);
        const env = contextFor(request, instance, script);
        const step = request.body?.step || 'home';
        const queries = {home: {}, category: {ac: 'list', t: request.body?.value || '', pg: '1'},
            search: {wd: request.body?.value || '测试', pg: '1'}, detail: {ac: 'detail', ids: request.body?.value || ''},
            play: {play: request.body?.value || '', flag: request.body?.flag || ''}};
        if (!queries[step]) throw fail('验证步骤无效');
        const started = Date.now();
        try {
            const result = await runner.run({engine: script.engine, file, instanceId: instance.id}, queries[step], env);
            await store.mutate(state => { const item = state.instances.find(s => s.id === instance.id); if (item) item.lastCheck = {step, ok: true, time: new Date().toISOString(), cost: Date.now() - started}; });
            return {ok: true, cost: Date.now() - started, result};
        } catch (error) {
            await store.mutate(state => { const item = state.instances.find(s => s.id === instance.id); if (item) item.lastCheck = {step, ok: false, error: error.message, time: new Date().toISOString()}; });
            throw error;
        }
    });
    const subscriptionFields = body => {
        if (!checkString(body.name) || !Array.isArray(body.instances)) throw fail('订阅名称或源列表无效');
        if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 2000)) throw fail('订阅描述无效');
        return {name: body.name.trim(), description: body.description || '', enabled: !!body.enabled, instances: [...new Set(body.instances)].filter(id => store.state.instances.some(s => s.id === id))};
    };
    app.post('/admin/subscriptions', async request => store.mutate(state => {
        const sub = {id: token().slice(0, 16), token: token(), ...subscriptionFields(request.body || {})};
        state.subscriptions.push(sub); return sub;
    }));
    app.put('/admin/subscriptions/:id', async request => store.mutate(state => {
        const sub = state.subscriptions.find(s => s.id === request.params.id);
        if (!sub) throw fail('订阅不存在', 404);
        Object.assign(sub, subscriptionFields(request.body || {})); return sub;
    }));
    app.post('/admin/subscriptions/:id/token', async request => store.mutate(state => {
        const sub = state.subscriptions.find(s => s.id === request.params.id);
        if (!sub) throw fail('订阅不存在', 404);
        sub.token = token(); return sub;
    }));
    app.delete('/admin/subscriptions/:id', async request => {
        await store.mutate(state => { state.subscriptions = state.subscriptions.filter(s => s.id !== request.params.id); }); return {ok: true};
    });
    app.get('/admin/subscriptions/:id/preview', async request => {
        const sub = store.state.subscriptions.find(s => s.id === request.params.id);
        if (!sub) throw fail('订阅不存在', 404);
        return buildSubscription(store.state, sub, baseUrl(request));
    });
    app.put('/admin/settings', async request => {
        const value = request.body || {};
        if (value.publicUrl && !/^https?:\/\/[^\s]+$/.test(value.publicUrl)) throw fail('对外地址须为 http:// 或 https:// 地址');
        if (!Number.isInteger(value.timeout) || value.timeout < 1000 || value.timeout > 300000) throw fail('超时范围为 1–300 秒');
        if (!checkString(value.pythonPath, 1000) || !checkString(value.phpPath, 1000)) throw fail('解释器路径不能为空');
        if (!value.env || Array.isArray(value.env) || typeof value.env !== 'object' || !Array.isArray(value.plugins) || !Array.isArray(value.parses) || !Array.isArray(value.lives)) throw fail('运行配置须为合法 JSON 对象/数组');
        await store.mutate(state => { state.settings = {publicUrl: value.publicUrl || '', timeout: value.timeout, pythonPath: value.pythonPath, phpPath: value.phpPath, browserPath: value.browserPath || '', env: value.env, plugins: value.plugins, parses: value.parses, lives: value.lives, jsonPublic: value.jsonPublic === true, allowPrivateTargets: value.allowPrivateTargets !== false, targetAllowlist: Array.isArray(value.targetAllowlist) ? value.targetAllowlist.filter(item => typeof item === 'string').slice(0, 200) : (state.settings.targetAllowlist || [])}; });
        await store.syncEnvironment(); runner.reset('运行配置已更新'); return {ok: true};
    });
    app.get('/admin/dependencies', async () => {
        const probe = async (file, args) => {
            try { const {stdout, stderr} = await exec(file, args, {timeout: 5000}); return {ok: true, version: (stdout || stderr).split('\n')[0]}; }
            catch (error) { return {ok: false, error: error.code === 'ENOENT' ? '未找到可执行文件' : error.message}; }
        };
        const settings = store.state.settings;
        return {node: {ok: true, version: process.version}, python: await probe(settings.pythonPath, ['--version']), php: await probe(settings.phpPath, ['-v']), runtime: runner.status()};
    });
    app.get('/admin/export', async (_, reply) => {
        await store.refreshEnvironment();
        const environments = Object.fromEntries(await Promise.all(store.state.instances.map(async instance => [instance.id, await store.readSourceEnvironment(instance.id)])));
        return reply.header('Content-Disposition', 'attachment; filename="coketv-config.json"').send({...store.state, environments});
    });
    app.post('/admin/import', async request => {
        const value = request.body;
        if (value?.version !== 1 || !Array.isArray(value.instances) || !Array.isArray(value.subscriptions)) throw fail('管理配置格式不正确');
        for (const item of value.instances) {
            instanceFields(item);
            if (!/^[a-zA-Z0-9_-]{1,100}$/.test(item.id || '') || !store.state.scripts.some(s => s.id === item.scriptId)) throw fail('导入配置引用了不存在的脚本，请先导入源包');
        }
        for (const sub of value.subscriptions) {
            if (!checkString(sub.id, 100) || !checkString(sub.token, 200) || !checkString(sub.name) || !Array.isArray(sub.instances) || sub.instances.some(id => !value.instances.some(item => item.id === id))) throw fail('导入订阅格式或站点引用不正确');
        }
        if (value.environments !== undefined) {
            if (!value.environments || typeof value.environments !== 'object' || Array.isArray(value.environments)) throw fail('源环境备份无效');
            for (const [id, variables] of Object.entries(value.environments)) {
                if (!value.instances.some(item => item.id === id)) throw fail('源环境备份引用了未知实例');
                validateEnvironment(variables);
            }
        }
        await store.mutate(async state => {
            state.instances = value.instances; state.subscriptions = value.subscriptions;
            for (const [id, variables] of Object.entries(value.environments || {})) {
                const file = store.sourceEnvPath(id);
                await store.atomic(file, JSON.stringify(variables, null, 2), {mode: 0o600}); await fs.chmod(file, 0o600);
            }
        });
        runner.reset('管理配置已导入'); return {ok: true};
    });

    const subscriptionHandler = async request => {
        const sub = request.params.id ? store.state.subscriptions.find(s => s.id === request.params.id) : store.state.subscriptions.find(s => s.id === request.query.sub) || store.state.subscriptions[0];
        if (!sub || !sub.enabled || (!await auth.isAdmin(request) && sub.token !== request.query.token)) throw fail('订阅不存在、已停用或凭证无效', 403);
        return buildSubscription(store.state, sub, baseUrl(request));
    };
    app.get('/subscription/:id', subscriptionHandler);
    app.get('/config', subscriptionHandler); app.get('/config/1', subscriptionHandler);
    app.route({method: ['GET', 'POST'], url: '/api/:module', handler: async request => {
        const query = {...request.query, ...(request.body || {})};
        const {result, sub, instance, script} = await run(request, query);
        if (typeof result?.url === 'string') {
            try {
                const parsed = new URL(result.url, baseUrl(request));
                const segments = parsed.pathname.split('/');
                if (parsed.origin === new URL(baseUrl(request)).origin && segments[1] === 'proxy' && decodeURIComponent(segments[2] || '') === script.file.replace(/\.[^.]+$/, '')) {
                    segments[2] = instance.id; parsed.pathname = segments.join('/'); result.url = parsed.href;
                }
            } catch {}
            result.url = localToken(result.url, baseUrl(request), sub?.token);
        }
        if (netdisk.isReference(query.play)) return {parse: 0, url: result.url, header: result.header || {}};
        return result;
    }});
    app.get('/proxy/:module/*', async (request, reply) => {
        const query = {...request.query, __range: request.headers.range || '', __mediaProxy: `${baseUrl(request)}/mediaProxy`};
        const {result, sub, instance, script} = await run(request, query, 'proxy');
        if (!Array.isArray(result) || result.length < 3) throw new Error('源代理返回格式无效');
        const [status = 200, type = 'application/octet-stream', content = '', headers = {}, bytes] = result;
        // 源返回的头必须保留 Cookie/Authorization（站点登录媒体拉流依赖），
        // 只有调用方传入的头才用更严的 safeProxyHeaders。
        const carried = typeof content === 'string' ? unwrapMediaProxy(content, baseUrl(request)) : null;
        const target = carried?.url || content;
        const streamHeaders = sanitizeSourceHeaders({...(carried?.headers || {}), ...(headers && typeof headers === 'object' && !Array.isArray(headers) ? headers : {})});
        const mint = url => playback.createProxy(url, streamHeaders);
        for (const key of Object.keys(headers || {})) if (key.toLowerCase() === 'location') headers[key] = localToken(headers[key], baseUrl(request), sub?.token);
        if ([2, 3].includes(bytes) && typeof target === 'string' && /^https?:/.test(target)) {
            // toBytes=3：宿主直接拉流；toBytes=2：302 到绑定能力票据的 /mediaProxy。
            // 两条路径携带同一组头，规避播放器 302 丢自定义头。
            if (bytes === 3) return serveMedia(request, reply, target, streamHeaders, sub?.token, mint);
            return reply.redirect(`/mediaProxy?${new URLSearchParams({url: target, token: playback.createProxy(target, streamHeaders)})}`);
        }
        let body = bytes === 1 ? Buffer.from(String(content).split('base64,').pop(), 'base64') : content;
        if (typeof body === 'string' && (body.startsWith('#EXTM3U') || /mpegurl/i.test(type))) body = rewritePlaylist(body, `${baseUrl(request)}${request.url}`, baseUrl(request), {token: sub?.token, mint, alias: {name: script.file.replace(/\.[^.]+$/, ''), id: instance.id}});
        return reply.code(Number(status)).headers(headers || {}).type(type).send(body);
    });
    const mediaProxyHandler = async (request, reply) => {
        const target = decodeMediaTarget(request.query.url);
        const info = await authorizeProxy(request, target);
        // Capability-bound headers win even when caller also sends credentials.
        // Incoming Basic/runtime credentials are never implicitly copied out.
        const supplied = info.kind === 'proxy' ? info.headers || {} : decodeMediaHeaders(request.query);
        const headers = info.kind === 'subscription' ? safeProxyHeaders(supplied) : playbackHeaders(supplied);
        const token = info.kind === 'proxy' ? request.query.token : info.token;
        return serveMedia(request, reply, target, headers, token, url => playback.createProxy(url, headers));
    };
    app.route({method: ['GET', 'HEAD'], url: '/mediaProxy', handler: mediaProxyHandler});
    for (const route of URL_PROXY_ROUTES) app.route({method: ['GET', 'HEAD'], url: route, handler: mediaProxyHandler});
    for (const route of ['/webdav/*', '/ftp/*']) app.route({method: ['GET', 'HEAD', 'POST'], url: route, handler: async (request, reply) => {
        const sub = await authorizeService(request);
        const port = await runner.gateway();
        const headers = {...request.headers, host: request.headers.host};
        delete headers['content-length'];
        // 不接受调用方自带的 config：目标主机与凭据只能取自服务端保存的配置，避免被当作带凭据的开放代理。
        const forwarded = new URL(request.url, 'http://127.0.0.1');
        forwarded.searchParams.delete('config');
        const target = `http://127.0.0.1:${port}${forwarded.pathname}${forwarded.search}`;
        return streamMedia(target, headers, request, reply,
            {base: baseUrl(request), token: sub?.token, method: request.method, body: request.body ? JSON.stringify(request.body) : undefined});
    }});
    app.post('/http', async (request, reply) => {
        await authorizeService(request);
        const {url, method = 'GET', headers = {}, params = {}, data, responseType, maxRedirects} = request.body || {};
        if (!/^https?:/.test(url || '')) throw fail('HTTP 请求地址无效');
        const response = await guardedHttp({url, method, headers, params, data, responseType, maxRedirects, timeout: store.state.settings.timeout}, targetGuard);
        return reply.code(response.status).send({status: response.status, headers: response.headers, data: response.data});
    });
    app.get('/req/*', async (request, reply) => {
        const target = request.params['*'];
        const info = await authorizeProxy(request, target);
        const headers = info.headers || {};
        const token = info.kind === 'proxy' ? request.query.token : info.token;
        return streamMedia(target, headers, request, reply, {base: baseUrl(request), token, mint: url => playback.createProxy(url, headers), guard: targetGuard});
    });
    const images = new Map();
    app.post('/image/upload', async request => {
        await authorizeService(request);
        const {imageId, base64Data} = request.body || {};
        if (!checkString(imageId, 100) || !/^data:image\/[^;]+;base64,/.test(base64Data || '') || base64Data.length > 700000) throw fail('图片格式不正确或超过大小限制');
        const comma = base64Data.indexOf(',');
        images.set(imageId, {type: base64Data.slice(5, base64Data.indexOf(';')), bytes: Buffer.from(base64Data.slice(comma + 1), 'base64'), time: Date.now()});
        if (images.size > 100) images.delete(images.keys().next().value);
        return {success: true, data: {imageId, imageUrl: `/image/${encodeURIComponent(imageId)}`}};
    });
    app.get('/image/:id', async (request, reply) => {
        const image = images.get(request.params.id);
        if (!image || Date.now() - image.time > 3600000) { images.delete(request.params.id); throw fail('图片不存在或已过期', 404); }
        return reply.type(image.type).send(image.bytes);
    });
    app.get('/parse/:jx', async request => {
        const sub = await authorize(request);
        const name = request.params.jx;
        validFilename('js', `${name}.js`);
        const file = inside(store.runtime, `jx/${name}.js`);
        const env = contextFor(request, {id: name, params: request.query.extend || ''}, {engine: 'js', file: `${name}.js`}, {token: sub?.token});
        return runner.run({engine: 'js', file, instanceId: name}, request.query, env, 'parse');
    });

    // H1：data/runtime/json/ 里的参数文件可能含 Cookie/Token，默认不再匿名可读。
    // 源自身的回环请求带 x-drpy-runtime 头放行；管理员与订阅 Token 亦可读取。
    // settings.jsonPublic=true 可恢复旧的公开行为（公网部署不建议）。
    const JSON_TYPES = {json: 'application/json; charset=utf-8', m3u8: 'application/vnd.apple.mpegurl', ts: 'video/mp2t', xml: 'application/xml; charset=utf-8', txt: 'text/plain; charset=utf-8', js: 'text/javascript; charset=utf-8'};
    app.get('/json/*', async (request, reply) => {
        if (store.state.settings.jsonPublic !== true) {
            const allowed = await auth.isAdmin(request) || request.headers['x-drpy-runtime'] === runner.internalKey || authorizedSubscription(store.state, request.query.token || request.body?.token);
            if (!allowed) throw fail('参数文件不可匿名访问', 403);
        }
        const relative = request.params['*'];
        let target;
        try { target = inside(path.join(store.runtime, 'json'), relative); }
        catch { throw fail('参数文件路径无效', 403); }
        let content;
        try { content = await fs.readFile(target); }
        catch (error) { if (['ENOENT', 'EISDIR'].includes(error.code)) throw fail('参数文件不存在', 404); throw error; }
        const extension = (relative.split('.').pop() || '').toLowerCase();
        return reply.type(JSON_TYPES[extension] || 'application/octet-stream').send(content);
    });
    await app.register(staticPlugin, {root: path.join(ROOT, 'dist/assets'), prefix: '/assets/', decorateReply: false});
    app.get('/', async (_, reply) => reply.type('text/html').send(await fs.readFile(path.join(ROOT, 'dist/index.html'))));
    app.get('/sources/:id/edit', async (_, reply) => reply.type('text/html').send(await fs.readFile(path.join(ROOT, 'dist/index.html'))));
    for (const url of ['/admin', '/watch', '/watch/play', '/watch/history']) app.get(url, async (_, reply) => reply.type('text/html').send(await fs.readFile(path.join(ROOT, 'dist/index.html'))));
    app.server.on('upgrade', (request, socket, head) => {
        // 源需要的 WebSocket 继续经主端口，管理页面本身不建立日志 WS。
        if (!runner.wsPort) { socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
        const upstream = net.connect(runner.wsPort, '127.0.0.1', () => {
            const header = `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${Object.entries(request.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`;
            upstream.write(header); if (head.length) upstream.write(head); socket.pipe(upstream).pipe(socket);
        });
        upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); socket.on('close', () => upstream.destroy());
    });
    return app;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const app = await createApp();
    await app.listen({port: Number(process.env.PORT) || 54058, host: process.env.HOST || '0.0.0.0'});
    console.log(`CokeTV 已启动：http://127.0.0.1:${app.server.address().port}`);
    console.log(`访问密码配置：${path.join(app.store.directory, 'admin.json')}（或使用 ADMIN_PASSWORD）`);
    try {
        const code = (await fs.readFile(path.join(app.store.directory, 'setup-code.txt'), 'utf8')).trim();
        console.log('============================================================');
        console.log(`首次部署初始化码：${code}`);
        console.log('进入 /admin 创建访问密码时必须填写该码；创建成功后文件自动删除。');
        console.log('============================================================');
    } catch { /* 已创建密码或使用 ADMIN_PASSWORD，无需引导码 */ }
    const close = async () => { await app.close(); process.exit(); };
    process.on('SIGINT', close); process.on('SIGTERM', close);
}
