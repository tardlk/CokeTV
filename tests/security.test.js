import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import {createApp} from '../src/server.js';
import {createAuth} from '../src/auth.js';

let app, directory, upstream, upstreamUrl, source, authorization, subscriptionToken;
const received = [];

// 用原生 socket 发送 absolute-form 请求行（app.inject 无法构造这种形态）。
const rawRequest = (port, requestLine) => new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(`${requestLine}\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`));
    let data = '';
    socket.on('data', chunk => { data += chunk; });
    socket.on('end', () => resolve(Number(data.split('\r\n')[0].split(' ')[1])));
    socket.on('error', () => resolve(0));
});

before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-security-'));
    upstream = http.createServer((req, res) => {
        received.push({url: req.url, headers: req.headers});
        if (req.url === '/redirect-meta') { res.writeHead(302, {Location: 'http://169.254.169.254/latest/meta-data/'}); res.end(); return; }
        if (req.url === '/playlist.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end('#EXTM3U\n#EXTINF:1,\nsegment.ts\n'); return; }
        res.setHeader('Content-Type', 'video/mp4'); res.end('media-bytes');
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
    app = await createApp({directory, seed: false});
    const setupCode = (await fs.readFile(path.join(directory, 'setup-code.txt'), 'utf8')).trim();
    assert.equal((await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'security-password', confirmPassword: 'security-password', setupCode}})).statusCode, 200);
    authorization = `Basic ${Buffer.from(':security-password').toString('base64')}`;
    const code = `var rule={title:'安全样本',host:'https://fixture.invalid',class_parse:async()=>({class:[]}),推荐:async()=>setResult([]),二级:async()=>({vod_name:'样本',vod_play_from:'线路一',vod_play_url:'第1集$${upstreamUrl}/playlist.m3u8'}),play_parse:true,lazy:async(a,b)=>({parse:0,url:b})};`;
    const script = await app.store.saveScript('js', '安全样本.js', code);
    source = script.id;
    subscriptionToken = app.store.state.subscriptions[0].token;
    await app.listen({host: '127.0.0.1', port: 0});
});
after(async () => { await app?.close(); await new Promise(resolve => upstream?.close(resolve)); await fs.rm(directory, {recursive: true, force: true}); });

// ---- C1：管理鉴权基于匹配路由 ----
test('C1 百分号编码前缀无法绕过管理鉴权', async () => {
    for (const url of ['/%61dmin/state', '/%61%64%6d%69%6e/state', '/./%61dmin/state', '/ADMIN/state', '/%61dmin/export', '/%61dmin/logs']) {
        const response = await app.inject(url);
        assert.ok([401, 404].includes(response.statusCode), `${url} => ${response.statusCode}`);
    }
});
test('C1 absolute-form 请求行无法绕过管理鉴权', async () => {
    const port = app.server.address().port;
    assert.equal(await rawRequest(port, `GET http://127.0.0.1:${port}/admin/state HTTP/1.1`), 401);
    assert.equal(await rawRequest(port, `GET http://127.0.0.1:${port}/admin/export HTTP/1.1`), 401);
});
test('C1 合法路径不回归，免鉴权路由与观影页仍可用', async () => {
    assert.equal((await app.inject('/admin/state')).statusCode, 401);
    assert.equal((await app.inject({url: '/admin/state', headers: {authorization}})).statusCode, 200);
    for (const route of ['/', '/admin', '/watch', '/watch/play', '/watch/history']) assert.equal((await app.inject(route)).statusCode, 200);
    assert.equal((await app.inject('/access/status')).json().requiresSetup, false);
});
test('C1 未授权写入请求被拒且不改动状态文件', async () => {
    const stateFile = path.join(directory, 'state.json');
    const before = await fs.readFile(stateFile, 'utf8');
    assert.equal((await app.inject({method: 'PUT', url: '/%61dmin/settings', payload: {}})).statusCode, 401);
    assert.equal((await app.inject({method: 'POST', url: '/%61dmin/scripts', payload: {engine: 'js', name: 'rce.js', code: 'var a=1'}})).statusCode, 401);
    assert.equal((await app.inject({method: 'POST', url: '/%61dmin/verify/x', payload: {step: 'home'}})).statusCode, 401);
    assert.equal(await fs.readFile(stateFile, 'utf8'), before);
});
// ---- C2：播放凭证绑定 URL ----
async function ticketFor(value = `${upstreamUrl}/video.mp4`) {
    const response = await app.inject({method: 'POST', url: `/watch/sources/${source}/play`, payload: {play: value, flag: '线路一'}});
    assert.equal(response.statusCode, 200, response.body);
    return response.json().url.split('/').at(-1);
}
test('C2 匿名媒体凭证只能访问票据绑定地址，不能当开放代理', async () => {
    const ticket = await ticketFor();
    assert.equal((await app.inject(`/watch/media/${ticket}`)).statusCode, 200);
    const probes = [
        `/mediaProxy?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}&token=${ticket}`,
        `/mediaProxy?url=${encodeURIComponent(upstreamUrl + '/other')}&token=${ticket}`,
        `/req/${encodeURIComponent(upstreamUrl + '/video.mp4')}?token=${ticket}`,
        `/m3u8-proxy/proxy?url=${encodeURIComponent(upstreamUrl + '/video.mp4')}&token=${ticket}`,
        `/unified-proxy/proxy?url=${encodeURIComponent(upstreamUrl + '/video.mp4')}&token=${ticket}`,
    ];
    for (const url of probes) assert.equal((await app.inject(url)).statusCode, 403, url);
});
test('C2 分片票据可用但不可挪用到其他地址', async () => {
    const ticket = await ticketFor(`${upstreamUrl}/playlist.m3u8`);
    const playlist = await app.inject({url: `/watch/media/${ticket}`});
    assert.equal(playlist.statusCode, 200, playlist.body);
    assert.match(playlist.body, /^#EXTM3U/);
    const segment = playlist.body.split('\n').find(line => line.startsWith('http'));
    const parsed = new URL(segment);
    assert.ok(parsed.searchParams.get('token'));
    assert.equal((await app.inject(parsed.pathname + parsed.search)).statusCode, 200);
    parsed.searchParams.set('url', `${upstreamUrl}/other`);
    assert.equal((await app.inject(parsed.pathname + parsed.search)).statusCode, 403);
});
test('C2 调用方请求头不可注入 Host/Authorization/Cookie', async () => {
    received.length = 0;
    const headers = JSON.stringify({Authorization: 'Bearer injected', Host: 'evil.example', Cookie: 'a=b'});
    const response = await app.inject(`/mediaProxy?url=${encodeURIComponent(upstreamUrl + '/video.mp4')}&token=${subscriptionToken}&headers=${encodeURIComponent(headers)}`);
    assert.equal(response.statusCode, 200, response.body);
    const last = received.at(-1);
    assert.equal(last.headers.authorization, undefined);
    assert.equal(last.headers.cookie, undefined);
    assert.notEqual(last.headers.host, 'evil.example');
});
test('C2 订阅 Token 与播放票据不混用', async () => {
    const ticket = await ticketFor();
    assert.equal((await app.inject(`/api/${source}?token=${ticket}`)).statusCode, 403);
    assert.equal((await app.inject(`/mediaProxy?url=${encodeURIComponent(upstreamUrl + '/video.mp4')}&token=${subscriptionToken}`)).statusCode, 200);
});
test('C2 停用源后原有媒体票据失效', async () => {
    const ticket = await ticketFor();
    const entry = app.store.state.instances.find(item => item.id === source);
    try {
        entry.enabled = false;
        assert.equal((await app.inject(`/watch/media/${ticket}`)).statusCode, 403);
    } finally { entry.enabled = true; }
});
test('C2 篡改或过期票据都被拒绝', async () => {
    const ticket = await ticketFor();
    const tampered = `${ticket.slice(0, -2)}xx`;
    assert.equal((await app.inject(`/watch/media/${tampered}`)).statusCode, 403);
    assert.equal((await app.inject('/watch/media/not-a-token')).statusCode, 403);
});

// ---- M4：代理出口 SSRF 策略 ----
test('M4 云元数据地址永久拒绝，重定向到内网同样被拦', async () => {
    const meta = `/mediaProxy?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}&token=${subscriptionToken}`;
    assert.equal((await app.inject(meta)).statusCode, 403);
    const redirect = `/mediaProxy?url=${encodeURIComponent(upstreamUrl + '/redirect-meta')}&token=${subscriptionToken}`;
    assert.equal((await app.inject(redirect)).statusCode, 403);
    assert.equal((await app.inject(`/req/${encodeURIComponent('http://169.254.169.254/')}?token=${subscriptionToken}`)).statusCode, 403);
});
test('M4 内网目标受 allowPrivateTargets 控制，白名单可进一步收紧', async () => {
    const internal = `/mediaProxy?url=${encodeURIComponent(upstreamUrl + '/video.mp4')}&token=${subscriptionToken}`;
    assert.equal((await app.inject(internal)).statusCode, 200);
    await app.store.mutate(state => { state.settings.allowPrivateTargets = false; });
    try { assert.equal((await app.inject(internal)).statusCode, 403); }
    finally { await app.store.mutate(state => { state.settings.allowPrivateTargets = true; }); }
    await app.store.mutate(state => { state.settings.targetAllowlist = ['only.example.invalid']; });
    try { assert.equal((await app.inject(internal)).statusCode, 403); }
    finally { await app.store.mutate(state => { state.settings.targetAllowlist = []; }); }
});

// ---- H1：/json/ 不再匿名可读 ----
test('H1 源参数文件默认不可匿名读取，内部凭据与订阅 Token 放行', async () => {
    const file = path.join(app.store.runtime, 'json', '源参数.json');
    await fs.writeFile(file, JSON.stringify({cookie: 'SECRET-SESSION-COOKIE'}));
    const path0 = '/json/' + encodeURIComponent('源参数.json');
    assert.equal((await app.inject(path0)).statusCode, 403);
    assert.equal((await app.inject(`${path0}?token=${subscriptionToken}`)).statusCode, 200);
    assert.equal((await app.inject({url: path0, headers: {authorization}})).statusCode, 200);
    assert.equal((await app.inject({url: path0, headers: {'x-drpy-runtime': app.runner.internalKey}})).statusCode, 200);
    assert.ok([400, 403, 404].includes((await app.inject('/json/..%2fadmin.json')).statusCode));
});
test('H1 开关 jsonPublic=true 时恢复旧的公开行为', async () => {
    const path0 = '/json/' + encodeURIComponent('源参数.json');
    await app.store.mutate(state => { state.settings.jsonPublic = true; });
    try { assert.equal((await app.inject(path0)).statusCode, 200); }
    finally { await app.store.mutate(state => { state.settings.jsonPublic = false; }); }
});

// ---- P0-3：/admin/* 限流与鉴权失败预算 ----
test('P0-3 /admin/* 鉴权失败超过阈值后返回 429，正常凭据不受批量成功影响', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-adminfail-'));
    const previous = process.env.ADMIN_AUTH_FAIL_PER_MINUTE;
    process.env.ADMIN_AUTH_FAIL_PER_MINUTE = '5';
    let fresh;
    try {
        fresh = await createApp({directory: dir, seed: false});
        const setupCode = (await fs.readFile(path.join(dir, 'setup-code.txt'), 'utf8')).trim();
        await fresh.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'rl-password', confirmPassword: 'rl-password', setupCode}});
        const wrong = {headers: {authorization: `Basic ${Buffer.from(':nope').toString('base64')}`}};
        const ok = {headers: {authorization: `Basic ${Buffer.from(':rl-password').toString('base64')}`}};
        // 合法请求本身不计入失败预算。
        assert.equal((await fresh.inject({url: '/admin/health', ...ok})).statusCode, 200);
        for (let index = 1; index <= 5; index += 1) assert.equal((await fresh.inject({url: '/admin/state', ...wrong})).statusCode, 401, `第 ${index} 次失败应在预算内`);
        assert.equal((await fresh.inject({url: '/admin/state', ...wrong})).statusCode, 429);
        // 同一 IP 的失败预算耗尽后，即使随后给出正确密码也需等待窗口结束（防在线爆破的代价）。
        assert.equal((await fresh.inject({url: '/admin/state', ...ok})).statusCode, 429);
    } finally {
        if (previous === undefined) delete process.env.ADMIN_AUTH_FAIL_PER_MINUTE; else process.env.ADMIN_AUTH_FAIL_PER_MINUTE = previous;
        await fresh?.close(); await fs.rm(dir, {recursive: true, force: true});
    }
});

// ---- H2：首装引导码 ----
test('H2 无引导码/错码不能创建密码，正确码后引导码作废', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-setup-'));
    try {
        const store = {directory: dir, atomic: async (file, content) => { await fs.writeFile(`${file}.tmp`, content); await fs.rename(`${file}.tmp`, file); }};
        const auth = await createAuth(store);
        const codeFile = path.join(dir, 'setup-code.txt');
        const code = (await fs.readFile(codeFile, 'utf8')).trim();
        assert.ok(code.length >= 8);
        assert.equal((await fs.stat(codeFile)).mode & 0o777, 0o600);
        const attempt = payload => auth.setup({headers: {}, body: payload}).then(() => ({statusCode: 200}), error => ({statusCode: error.statusCode}));
        assert.equal((await attempt({password: 'abcdef', confirmPassword: 'abcdef'})).statusCode, 403);
        assert.equal((await attempt({password: 'abcdef', confirmPassword: 'abcdef', setupCode: 'wrong-code'})).statusCode, 403);
        assert.equal(auth.needsSetup(), true);
        assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'admin.json'), 'utf8')).password, undefined);
        assert.equal((await attempt({password: 'abcdef', confirmPassword: 'abcdef', setupCode: code})).statusCode, 200);
        assert.equal(auth.needsSetup(), false);
        await assert.rejects(fs.access(codeFile));
        assert.equal((await attempt({password: 'abcdef', confirmPassword: 'abcdef', setupCode: code})).statusCode, 409);
        const saved = JSON.parse(await fs.readFile(path.join(dir, 'admin.json'), 'utf8'));
        assert.equal(saved.version, 2); assert.equal(saved.password, undefined);
        assert.equal((await fs.stat(path.join(dir, 'admin.json'))).mode & 0o777, 0o600);
    } finally { await fs.rm(dir, {recursive: true, force: true}); }
});

