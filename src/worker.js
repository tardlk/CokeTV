import {pathToFileURL} from 'url';
import path from 'path';
import net from 'net';
import http from 'http';
import {spawn} from 'child_process';
import util from 'util';

const root = process.env.ROOT;
process.chdir(root);
const importRuntime = file => import(pathToFileURL(path.join(root, file)).href);
await importRuntime('utils/esm-register.mjs');
const {withSourceEnvironment, redactSourceSecrets} = await importRuntime('utils/source-env.js');
const engines = new Map();
let python = null;
let pythonReady = null;
let currentSource = null;
let wsServer = null;
let wsPort = null;
let gateway = null;

async function startGateway() {
    if (gateway) return gateway.server.address().port;
    const {default: Fastify} = await import('fastify');
    const server = Fastify({logger: false});
    const options = {rootDir: root, PORT: Number(process.env.DRPY_HTTP_PORT) || 5758};
    for (const name of ['webdav-proxy', 'ftp-proxy']) {
        const controller = await importRuntime(`controllers/${name}.js`);
        server.register(controller.default, options);
    }
    await server.listen({host: '127.0.0.1', port: 0});
    gateway = server;
    return server.server.address().port;
}

const report = () => process.send?.({kind: 'stats', memory: process.memoryUsage(), engines: [...engines.keys()], pythonPid: python?.pid || null});
setInterval(report, 10000).unref();
for (const level of ['log', 'warn', 'error']) console[level] = (...args) => process.send?.({kind: 'log', level: level === 'log' ? 'info' : level, source: currentSource, message: redactSourceSecrets(util.format(...args)).slice(0, 8192)});

async function startPython() {
    if (pythonReady) return pythonReady;
    pythonReady = (async () => {
        python = spawn(process.env.PYTHON_PATH || 'python3', [path.join(root, 'spider/py/core/t4_daemon.py')], {
            cwd: path.join(root, 'spider/py'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
        });
        let failure;
        python.once('error', error => { failure = error; });
        python.once('exit', code => { failure = new Error(`Python 服务退出 (${code})`); python = null; pythonReady = null; });
        for (const output of [python.stdout, python.stderr]) output.on('data', bytes => console.log(bytes.toString().trim()));
        const end = Date.now() + 10000;
        while (Date.now() < end) {
            if (failure) throw failure;
            const ready = await new Promise(resolve => {
                const socket = net.connect(Number(process.env.DRPY_PY_PORT), '127.0.0.1');
                socket.once('connect', () => { socket.destroy(); resolve(true); });
                socket.once('error', () => resolve(false));
                socket.setTimeout(250, () => { socket.destroy(); resolve(false); });
            });
            if (ready) return;
            await new Promise(resolve => setTimeout(resolve, 80));
        }
        throw new Error('Python 守护进程启动超时，请检查解释器和源依赖');
    })().catch(error => { python?.kill(); pythonReady = null; throw error; });
    return pythonReady;
}

async function getEngine(name) {
    const key = name === 'dr2' ? 'js' : name;
    if (engines.has(key)) return engines.get(key);
    if (key === 'py') await startPython();
    if (key === 'cat') {
        await importRuntime('libs_drpy/drpyInject.js');
        const loader = await importRuntime('libs_drpy/moduleLoader.js');
        globalThis.require = loader.rootRequire;
        loader.initializeGlobalDollar();
    }
    const filenames = {js: 'drpyS', py: 'hipy', php: 'php', cat: 'catvod'};
    if (!filenames[key]) throw new Error(`不支持的执行引擎: ${name}`);
    const module = await importRuntime(`libs/${filenames[key]}.js`);
    const engine = module.default || module;
    engines.set(key, engine);
    report();
    return engine;
}

async function hydrateEnv(raw, source) {
    if (!wsServer) {
        wsServer = http.createServer((req, res) => { res.writeHead(404); res.end(); });
        await new Promise(resolve => wsServer.listen(0, '127.0.0.1', resolve));
        wsPort = wsServer.address().port;
        process.send?.({kind: 'ws', port: wsPort});
    }
    const env = {...raw, sourceInstanceId: source.instanceId, fServer: wsServer, getProxyUrl: () => raw.proxyUrl};
    env.getRule = async moduleName => {
        // 相同引擎内的跨规则调用保留原模块名。
        const target = path.join(path.dirname(source.file), `${moduleName}${path.extname(source.file)}`);
        const engine = await getEngine(source.engine);
        const moduleObject = await engine.init(target, env);
        moduleObject.callRuleFn = (method, args = []) => {
            const functions = {'一级': 'category', '二级': 'detail', '搜索': 'search', lazy: 'play', 推荐: 'homeVod', class_parse: 'home', proxy_rule: 'proxy', action: 'action'};
            return functions[method] ? engine[functions[method]](target, env, ...args) : moduleObject[method]?.(...args);
        };
        return moduleObject;
    };
    return env;
}

process.on('message', async message => {
    if (message.kind === 'gateway') {
        try { process.send?.({kind: 'gatewayReady', port: await startGateway()}); }
        catch (error) { process.send?.({kind: 'gatewayReady', error: error.message}); }
        return;
    }
    if (message.kind !== 'run') return;
    const {id, source, query, env: rawEnv, operation} = message;
    currentSource = source.instanceId;
    await withSourceEnvironment({file: rawEnv.sourceEnvPath}, async () => {
    try {
        process.env.DRPY_PUBLIC_URL = rawEnv.requestHost;
        process.env.DRPY_HTTP_PORT = String(rawEnv.localPort || new URL(rawEnv.requestHost).port || 5758);
        const engine = await getEngine(source.engine);
        const env = await hydrateEnv(rawEnv, source);
        const file = source.file;
        const page = Math.max(1, Number(query.pg) || 1);
        let result;
        if (operation === 'proxy') result = await engine.proxy(file, env, query);
        else if (operation === 'parse') result = await engine.jx(file, env, query);
        else if (operation === 'syntax') result = {ok: true};
        else if ('play' in query) result = await engine.play(file, env, query.flag || '', query.play, []);
        else if ('ac' in query && 't' in query) {
            let filter = {};
            if (query.ext) {
                try { filter = JSON.parse(Buffer.from(query.ext, 'base64').toString()); }
                catch { throw new Error('筛选参数 ext 必须为 Base64 JSON'); }
            }
            result = await engine.category(file, env, query.t, page, 1, filter);
        } else if ('ac' in query && 'ids' in query) result = await engine.detail(file, env, String(query.ids).split(','));
        else if ('ac' in query && 'action' in query) result = await engine.action(file, env, query.action, query.value);
        else if ('wd' in query) result = await engine.search(file, env, query.wd, query.quick || 0, page);
        else if ('refresh' in query) { await engine.init(file, env, true); result = {ok: true, refreshed: true}; }
        else {
            const home = await engine.home(file, env, query.filter ?? 1);
            const recommendations = await engine.homeVod(file, env);
            result = {...home, ...(Array.isArray(recommendations) ? {list: recommendations} : {})};
        }
        process.send?.({kind: 'result', id, result});
    } catch (error) {
        process.send?.({kind: 'result', id, error: redactSourceSecrets(error.message)});
    } finally { currentSource = null; report(); }
    });
});

process.on('disconnect', () => { python?.kill(); wsServer?.close(); process.exit(); });
process.on('SIGTERM', () => { python?.kill(); wsServer?.close(); process.exit(); });
if (process.env.DRPY_PLUGINS === '1') {
    const manager = await importRuntime('utils/pluginManager.js');
    manager.startAllPlugins(root);
}
process.send?.({kind: 'ready'});
