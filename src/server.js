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

export async function createApp({directory, seed = true} = {}) {
    const store = await new Store(directory).init({seed});
    const runner = new Runner(store);
    const auth = await createAuth(store);
    const app = Fastify({logger: false, bodyLimit: 8 * 1024 * 1024, trustProxy: process.env.TRUST_PROXY === '1'});
    await app.register(formbody);
    await app.register(multipart, {limits: {fileSize: 16 * 1024 * 1024, files: 1}});
    app.decorate('store', store); app.decorate('runner', runner);
    app.setErrorHandler((error, request, reply) => {
        runner.log({level: 'error', message: error.message});
        reply.code(error.statusCode || 500).send({error: error.message, ...(error.importCode ? {code: error.importCode} : {})});
    });
    app.addHook('preHandler', async (request, reply) => {
        if (request.url.startsWith('/admin/')) return auth.guard(request, reply);
    });
    app.addHook('onClose', async () => runner.close());
    const baseUrl = request => store.state.settings.publicUrl.replace(/\/$/, '') || `${request.protocol}://${request.headers.host}`;
    const contextFor = (request, instance, script, extra) => ({...buildContext(baseUrl(request), instance, script, extra), sourceEnvPath: store.state.instances.some(s => s.id === instance.id) ? store.sourceEnvPath(instance.id) : null, localPort: app.server.address()?.port || Number(process.env.PORT) || 54058});
    const serveMedia = (request, reply, target, headers, suppliedToken) => {
        const base = baseUrl(request);
        const parsed = new URL(target);
        const ownPort = app.server.address()?.port || Number(process.env.PORT) || 54058;
        const own = parsed.origin === new URL(base).origin || (['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && Number(parsed.port) === ownPort);
        if (own) {
            const originalHost = parsed.host;
            if (suppliedToken) parsed.searchParams.set('token', suppliedToken);
            parsed.protocol = 'http:'; parsed.host = `127.0.0.1:${ownPort}`;
            headers = {...headers, host: originalHost};
            if (auth.isAdmin(request)) headers.authorization = request.headers.authorization;
            if (request.headers['x-drpy-runtime'] === runner.internalKey) headers['x-drpy-runtime'] = runner.internalKey;
        }
        return streamMedia(parsed.href, headers, request, reply, {base, token: suppliedToken});
    };
    const authorize = (request, id) => {
        if (auth.isAdmin(request) || request.headers['x-drpy-runtime'] === runner.internalKey) return null;
        const sub = authorizedSubscription(store.state, request.query.token || request.body?.token, id);
        if (!sub) throw fail('订阅访问凭证无效或该源不在订阅中', 403);
        return sub;
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
        const sub = authorize(request, instance.id);
        const env = contextFor(request, instance, script, {token: sub?.token, proxyPath: request.params['*'] || ''});
        const result = await runner.run({engine: script.engine, file, instanceId: instance.id}, query, env, operation);
        return {result, sub, instance, script, env};
    };

    app.get('/health', async () => ({ok: true, version: '0.1.0', memory: process.memoryUsage(), runtime: runner.status()}));
    app.get('/admin/state', async request => { await store.refreshEnvironment(); return {...store.state, runtime: runner.status(), baseUrl: baseUrl(request)}; });
    app.get('/admin/logs', async request => runner.logs.filter(entry => !request.query.source || entry.source === request.query.source).slice(-150));
    app.post('/admin/scan', async () => ({added: await store.mutate(() => store.scan())}));
    app.get('/admin/instances/:id/environment', async request => {
        await store.refreshEnvironment();
        return {values: await store.readSourceEnvironment(request.params.id), defaults: store.state.settings.env};
    });
    app.put('/admin/instances/:id/environment', async request => {
        const values = request.body?.values;
        validateEnvironment(values);
        await store.atomic(store.sourceEnvPath(request.params.id), JSON.stringify(values, null, 2));
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
        await store.mutate(state => { state.settings = {publicUrl: value.publicUrl || '', timeout: value.timeout, pythonPath: value.pythonPath, phpPath: value.phpPath, browserPath: value.browserPath || '', env: value.env, plugins: value.plugins, parses: value.parses, lives: value.lives}; });
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
                await store.atomic(file, JSON.stringify(variables, null, 2)); await fs.chmod(file, 0o600);
            }
        });
        runner.reset('管理配置已导入'); return {ok: true};
    });

    const subscriptionHandler = async request => {
        const sub = request.params.id ? store.state.subscriptions.find(s => s.id === request.params.id) : store.state.subscriptions.find(s => s.id === request.query.sub) || store.state.subscriptions[0];
        if (!sub || !sub.enabled || (!auth.isAdmin(request) && sub.token !== request.query.token)) throw fail('订阅不存在、已停用或凭证无效', 403);
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
        return result;
    }});
    app.get('/proxy/:module/*', async (request, reply) => {
        const query = {...request.query, __range: request.headers.range || '', __mediaProxy: `${baseUrl(request)}/mediaProxy`};
        const {result, sub, instance, script} = await run(request, query, 'proxy');
        if (!Array.isArray(result) || result.length < 3) throw new Error('源代理返回格式无效');
        const [status = 200, type = 'application/octet-stream', content = '', headers = {}, bytes] = result;
        for (const key of Object.keys(headers || {})) if (key.toLowerCase() === 'location') headers[key] = localToken(headers[key], baseUrl(request), sub?.token);
        if ([2, 3].includes(bytes) && /^https?:/.test(content)) {
            if (bytes === 3) return serveMedia(request, reply, content, headers, sub?.token);
            const params = new URLSearchParams({url: content, headers: JSON.stringify(headers)});
            if (sub) params.set('token', sub.token);
            return reply.redirect(`/mediaProxy?${params}`);
        }
        let body = bytes === 1 ? Buffer.from(String(content).split('base64,').pop(), 'base64') : content;
        if (typeof body === 'string' && (body.startsWith('#EXTM3U') || /mpegurl/i.test(type))) body = rewritePlaylist(body, `${baseUrl(request)}${request.url}`, baseUrl(request), sub?.token, {}, {name: script.file.replace(/\.[^.]+$/, ''), id: instance.id});
        return reply.code(Number(status)).headers(headers || {}).type(type).send(body);
    });
    app.route({method: ['GET', 'HEAD'], url: '/mediaProxy', handler: async (request, reply) => {
        const sub = authorize(request);
        let headers = {};
        if (request.query.headers) { try { headers = JSON.parse(request.query.headers); } catch { throw fail('媒体请求头须为 JSON'); } }
        return serveMedia(request, reply, request.query.url, headers, sub?.token);
    }});
    const decode = value => {
        if (!value) return '';
        if (/^https?:|^\{|^\[/.test(value)) return value;
        try { const text = Buffer.from(value, 'base64').toString(); if (/^https?:|^\{|^\[/.test(text)) return text; } catch {}
        return value;
    };
    for (const route of ['/unified-proxy/proxy', '/file-proxy/proxy', '/m3u8-proxy/playlist', '/m3u8-proxy/ts', '/m3u8-proxy/proxy']) {
        app.route({method: ['GET', 'HEAD'], url: route, handler: async (request, reply) => {
            const sub = authorize(request);
            let headers = {};
            try { headers = JSON.parse(decode(request.query.headers) || '{}'); } catch { throw fail('请求头格式不正确'); }
            return serveMedia(request, reply, decode(request.query.url), headers, sub?.token);
        }});
    }
    for (const route of ['/webdav/*', '/ftp/*']) app.route({method: ['GET', 'HEAD', 'POST'], url: route, handler: async (request, reply) => {
        const sub = authorize(request);
        const port = await runner.gateway();
        const headers = {...request.headers, host: request.headers.host};
        delete headers['content-length'];
        return streamMedia(`http://127.0.0.1:${port}${request.url}`, headers, request, reply,
            {base: baseUrl(request), token: sub?.token, method: request.method, body: request.body ? JSON.stringify(request.body) : undefined});
    }});
    app.post('/http', async (request, reply) => {
        authorize(request);
        const {default: axios} = await import('axios');
        const {url, method = 'GET', headers = {}, params = {}, data, responseType, maxRedirects} = request.body || {};
        if (!/^https?:/.test(url || '')) throw fail('HTTP 请求地址无效');
        const response = await axios({url, method, headers, params, data, responseType, maxRedirects, timeout: store.state.settings.timeout, validateStatus: () => true});
        return reply.code(response.status).send({status: response.status, headers: response.headers, data: response.data});
    });
    app.get('/req/*', async (request, reply) => {
        const sub = authorize(request);
        return streamMedia(request.params['*'], {}, request, reply, {base: baseUrl(request), token: sub?.token});
    });
    const images = new Map();
    app.post('/image/upload', async request => {
        authorize(request);
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
        const sub = authorize(request);
        const name = request.params.jx;
        validFilename('js', `${name}.js`);
        const file = inside(store.runtime, `jx/${name}.js`);
        const env = contextFor(request, {id: name, params: request.query.extend || ''}, {engine: 'js', file: `${name}.js`}, {token: sub?.token});
        return runner.run({engine: 'js', file, instanceId: name}, request.query, env, 'parse');
    });

    await app.register(staticPlugin, {root: path.join(store.runtime, 'json'), prefix: '/json/', decorateReply: false});
    await app.register(staticPlugin, {root: path.join(ROOT, 'dist/assets'), prefix: '/assets/', decorateReply: false});
    app.get('/', async (_, reply) => reply.type('text/html').send(await fs.readFile(path.join(ROOT, 'dist/index.html'))));
    app.get('/sources/:id/edit', async (_, reply) => reply.type('text/html').send(await fs.readFile(path.join(ROOT, 'dist/index.html'))));
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
    const close = async () => { await app.close(); process.exit(); };
    process.on('SIGINT', close); process.on('SIGTERM', close);
}
