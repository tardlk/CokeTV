import util from 'util';
import http from 'node:http';
import {sourceOperation} from './source-operation.js';

const root = process.env.ROOT;
process.chdir(root);
const {withSourceEnvironment, redactSourceSecrets} = await import('./host/utils/source-env.js');
let drpy3Engine = null;
let currentSource = null;
let gateway = null;
let gatewayStarting = null;
let wsServer = null;

async function startGateway() {
    if (gateway) return gateway.server.address().port;
    if (gatewayStarting) return gatewayStarting;
    gatewayStarting = createGateway();
    try { return await gatewayStarting; } finally { gatewayStarting = null; }
}
async function createGateway() {
    const {default: Fastify} = await import('fastify');
    const server = Fastify({logger: false});
    const options = {rootDir: root, PORT: Number(process.env.DRPY_HTTP_PORT) || 54058};
    for (const name of ['webdav-proxy', 'ftp-proxy']) {
        const controller = await import(`./host/controllers/${name}.js`);
        server.register(controller.default, options);
    }
    try { await server.listen({host: '127.0.0.1', port: 0}); }
    catch (error) { await server.close().catch(() => {}); throw error; }
    gateway = server;
    return server.server.address().port;
}

const report = () => process.send?.({kind: 'stats', memory: process.memoryUsage(), engines: drpy3Engine ? ['dr3'] : []});
setInterval(report, 10000).unref();
for (const level of ['log', 'warn', 'error']) console[level] = (...args) => process.send?.({kind: 'log', level: level === 'log' ? 'info' : level, source: currentSource, message: redactSourceSecrets(util.format(...args)).slice(0, 8192)});

async function getEngine(name) {
    if (name !== 'dr3') throw new Error('此源需要迁移到 drpy3');
    if (!drpy3Engine) {
        const {createDrpy3Engine} = await import('./drpy3.js');
        drpy3Engine = await createDrpy3Engine(root);
        report();
    }
    return drpy3Engine;
}
async function hydrateEnv(raw, source) {
    if (!wsServer) {
        wsServer = http.createServer((request, reply) => { reply.writeHead(404); reply.end(); });
        await new Promise(resolve => wsServer.listen(0, '127.0.0.1', resolve));
        process.send?.({kind: 'ws', port: wsServer.address().port});
    }
    return {...raw, sourceInstanceId: source.instanceId, fServer: wsServer, getProxyUrl: () => raw.proxyUrl};
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
    await withSourceEnvironment({file: rawEnv.sourceEnvPath, params: rawEnv.ext, privatePaths: [root, source.file]}, async () => {
    try {
        process.env.DRPY_PUBLIC_URL = rawEnv.requestHost;
        process.env.DRPY_HTTP_PORT = String(rawEnv.localPort || new URL(rawEnv.requestHost).port || 54058);
        const engine = await getEngine(source.engine);
        const env = await hydrateEnv(rawEnv, source);
        const file = source.file;
        const page = Number(query.pg) || 1;
        const method = sourceOperation(query, operation);
        let result;
        if (method === 'proxy') result = await engine.proxy(file, env, query);
        else if (method === 'parse') result = await engine.play(file, env, query.flag || '', query.url || query.input || '');
        else if (method === 'play') result = await engine.play(file, env, query.flag, query.play);
        else if (method === 'category') {
            let filter = {};
            if (query.ext) {
                try { filter = JSON.parse(Buffer.from(query.ext, 'base64').toString()); }
                catch { filter = {}; }
            }
            result = await engine.category(file, env, query.t, page, 1, filter);
        } else if (method === 'detail') result = await engine.detail(file, env, String(query.ids).split(','));
        else if (method === 'action') result = await engine.action(file, env, query.action, query.value);
        else if (method === 'search') result = await engine.search(file, env, query.wd, 'quick' in query ? query.quick : 0, page);
        else if (method === 'refresh') { await engine.init(file, env, true); result = {ok: true, refreshed: true}; }
        else {
            const home = await engine.home(file, env, 'filter' in query ? query.filter : 1);
            process.send?.({kind: 'phase', id, method: 'homeVod'});
            const recommendations = await engine.homeVod(file, env);
            result = {...home, ...(Array.isArray(recommendations) && recommendations.length ? {list: recommendations} : {})};
        }
        process.send?.({kind: 'result', id, result});
    } catch (error) {
        const message = redactSourceSecrets(error.message);
        process.send?.({kind: 'result', id, error: message});
    } finally { currentSource = null; report(); }
    });
});

process.on('disconnect', () => { wsServer?.close(); process.exit(); });
process.on('SIGTERM', () => { wsServer?.close(); process.exit(); });
process.send?.({kind: 'ready'});
