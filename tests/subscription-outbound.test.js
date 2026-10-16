import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createApp} from '../src/server.js';
import {installPublicUpstream} from './fixtures/public-upstream.js';

// 本轮最重要的权限边界：区分「可信出口」与「外部订阅出口」。
//   trusted      = 管理员 / 内部源运行时 / 服务端绑定 URL 的能力票据
//   subscription = 仅持订阅 Token 且自行指定目标 URL
// 订阅出口无论 allowPrivateTargets 如何，都不得访问私网/回环/链路本地地址。
let app, directory, upstream, routing, publicUrl, base, authorization, runtimeKey, token, ownInstance, otherInstance;

before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-subscription-outbound-'));
    upstream = http.createServer((_request, response) => { response.writeHead(200, {'content-type': 'video/mp4'}); response.end('MEDIA'); });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    routing = installPublicUpstream(upstream.address().port);
    publicUrl = routing.url;
    app = await createApp({directory, seed: false});
    await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'sub-outbound-password', confirmPassword: 'sub-outbound-password'}});
    authorization = `Basic ${Buffer.from(':sub-outbound-password').toString('base64')}`;
    runtimeKey = app.runner.internalKey;
    token = app.store.state.subscriptions[0].token;
    const code = "var rule={title:'出口样本',host:'https://fixture.invalid',class_parse:async()=>({class:[]}),推荐:async()=>setResult([]),play_parse:true,lazy:async(a,b)=>({parse:0,url:b})};";
    const own = await app.store.saveScript('js', '出口样本-own.js', code);
    const other = await app.store.saveScript('js', '出口样本-other.js', code);
    const create = scriptId => app.inject({method: 'POST', url: '/admin/instances', headers: {authorization}, payload: {name: `站点-${scriptId}`, scriptId, params: '', enabled: true, searchable: true, filterable: false}});
    ownInstance = (await create(own.id)).json().id;
    otherInstance = (await create(other.id)).json().id;
    // 只把 ownInstance 放进订阅：用于验证「自己订阅的源 vs 别人的源」。
    await app.store.mutate(state => { state.subscriptions[0].instances = [ownInstance]; });
    await app.listen({host: '127.0.0.1', port: 0});
    base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { routing?.restore(); await app?.close(); await new Promise(resolve => upstream?.close(resolve)); await fs.rm(directory, {recursive: true, force: true}); });

const media = (url, credential = token) => app.inject(`/mediaProxy?url=${encodeURIComponent(url)}&token=${credential}`);
const req = (url, credential = token) => app.inject(`/req/${encodeURIComponent(url)}?token=${credential}`);
const httpCall = (url, headers = {}) => app.inject({method: 'POST', url: '/http', headers, payload: {url}});

test('/http 只对管理员与内部源运行时开放，订阅 Token 与匿名一律 403', async () => {
    assert.equal((await httpCall(publicUrl)).statusCode, 403, '匿名不应能调用 /http');
    assert.equal((await httpCall(`${publicUrl}/?token=${token}`)).statusCode, 403, '订阅 Token 不应能调用 /http');
    assert.equal((await app.inject({method: 'POST', url: `/http?token=${token}`, payload: {url: publicUrl}})).statusCode, 403);
    // 可信路径必须继续可用：管理员与内部运行时。
    assert.equal((await httpCall(publicUrl, {authorization})).statusCode, 200, '管理员应能调用 /http');
    assert.equal((await httpCall(publicUrl, {'x-drpy-runtime': runtimeKey})).statusCode, 200, '内部源运行时应能调用 /http');
});

test('订阅出口：公网目标可用，私网/回环/链路本地目标一律 403（不受 allowPrivateTargets 影响）', async () => {
    assert.equal((await media(`${publicUrl}/ok.mp4`)).statusCode, 200, '订阅应能访问公网目标');
    const privateTargets = [
        'http://127.0.0.1:1/x',
        `http://127.0.0.1:${app.server.address().port + 1}/health`,
        'http://10.1.2.3/x',
        'http://192.168.1.10:5000/x',
        'http://172.16.9.9/x',
        'http://[::1]/x',
        'http://169.254.0.23/x',
        'http://169.254.169.254/latest/meta-data/',
    ];
    for (const target of privateTargets) {
        assert.equal((await media(target)).statusCode, 403, `订阅不得访问 ${target}`);
        assert.equal((await req(target)).statusCode, 403, `订阅不得通过 /req 访问 ${target}`);
    }
    // 即便把 allowPrivateTargets 打开（家庭 NAS 默认），订阅侧依然不允许。
    await app.store.mutate(state => { state.settings.allowPrivateTargets = true; });
    assert.equal((await media('http://127.0.0.1:1/x')).statusCode, 403);
    assert.equal((await media('http://192.168.1.10/x')).statusCode, 403);
    // 显式把它写进白名单也不能放行：白名单不是内网通行证。
    await app.store.mutate(state => { state.settings.targetAllowlist = ['127.0.0.1', '192.168.0.0/16']; });
    try {
        assert.equal((await media('http://127.0.0.1:1/x')).statusCode, 403);
        assert.equal((await media('http://192.168.1.10/x')).statusCode, 403);
    } finally { await app.store.mutate(state => { state.settings.targetAllowlist = []; }); }
});

test('可信出口：管理员/内部运行时仍由 allowPrivateTargets 与白名单控制', async () => {
    const privateTarget = `http://127.0.0.1:${upstream.address().port}/loopback.mp4`;
    const asAdmin = () => app.inject({url: `/mediaProxy?url=${encodeURIComponent(privateTarget)}`, headers: {authorization}});
    const asRuntime = () => app.inject({url: `/mediaProxy?url=${encodeURIComponent(privateTarget)}`, headers: {'x-drpy-runtime': runtimeKey}});
    assert.equal((await asAdmin()).statusCode, 200, 'allowPrivateTargets=true 时可信出口可访问 LAN');
    assert.equal((await asRuntime()).statusCode, 200);
    await app.store.mutate(state => { state.settings.allowPrivateTargets = false; });
    try {
        assert.equal((await asAdmin()).statusCode, 403);
        assert.equal((await asRuntime()).statusCode, 403);
    } finally { await app.store.mutate(state => { state.settings.allowPrivateTargets = true; }); }
});

test('订阅出口豁免 CokeTV 自身 origin，可进入既有代理链；但其他端口仍被拒绝', async () => {
    // CokeTV 自己的 origin：精确豁免，用于「订阅 → 自己的 /proxy/…」历史链路。
    assert.equal((await media(`${base}/health`)).statusCode, 200, '订阅应能访问 CokeTV 自身 origin');
    // 同 host 不同端口不是 selfOrigin，必须拒绝。
    const otherPort = `http://127.0.0.1:${app.server.address().port + 1}/health`;
    assert.equal((await media(otherPort)).statusCode, 403);
});

test('订阅只能访问自己订阅内的源；订阅外的源 403', async () => {
    assert.equal((await app.inject(`/api/${ownInstance}?token=${token}&do=js`)).statusCode, 200, '订阅内的源应可用');
    assert.equal((await app.inject(`/api/${otherInstance}?token=${token}&do=js`)).statusCode, 403, '订阅外的源必须拒绝');
    // 管理员不受订阅归属限制。
    assert.equal((await app.inject({url: `/api/${otherInstance}?do=js`, headers: {authorization}})).statusCode, 200);
});
