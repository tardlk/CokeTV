import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createApp} from '../src/server.js';

let app, directory, upstream, upstreamUrl, base, authorization, subscriptionToken;
const seen = [];
const b64 = value => Buffer.from(value).toString('base64');
const sourceHeaders = {Cookie: 'SID=secret', Referer: 'https://site.invalid/', Authorization: 'Bearer upstream-token'};

const proxyRule = (content, headers = sourceHeaders) => `var rule={title:'代理头样本',host:'https://fixture.invalid',class_parse:async()=>({class:[]}),推荐:async()=>setResult([]),proxy_rule:async function(params){return [200,'video/mp4',${JSON.stringify(content)},${JSON.stringify(headers)},BYTES];}};`;

before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-proxy-headers-'));
    upstream = http.createServer((req, res) => {
        seen.push({url: req.url, method: req.method, headers: req.headers});
        if (req.url.startsWith('/strict')) {
            if (req.headers.referer !== 'https://strict.invalid/%E7%89%87' || req.headers['user-agent'] !== 'Fixture-Agent') {
                res.writeHead(403); res.end('required business headers missing'); return;
            }
            if (req.url === '/strict/master.m3u8') { res.writeHead(200, {'content-type':'application/vnd.apple.mpegurl'}); res.end('#EXTM3U\n/strict/child.m3u8\n'); return; }
            if (req.url === '/strict/child.m3u8') { res.writeHead(200, {'content-type':'application/vnd.apple.mpegurl'}); res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/strict/key.bin"\n#EXTINF:1,\n/strict/segment.ts\n'); return; }
            if (req.headers.range) { res.writeHead(206, {'content-range':'bytes 1-3/5'}); res.end('EDI'); return; }
        }
        res.writeHead(200, {'content-type': 'video/mp4'}); res.end('MEDIA');
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
    app = await createApp({directory, seed: false});
    const setupCode = (await fs.readFile(path.join(directory, 'setup-code.txt'), 'utf8')).trim();
    await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'proxy-password', confirmPassword: 'proxy-password', setupCode}});
    authorization = `Basic ${Buffer.from(':proxy-password').toString('base64')}`;
    subscriptionToken = app.store.state.subscriptions[0].token;
    await app.listen({host: '127.0.0.1', port: 0});
    base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { await app?.close(); await new Promise(resolve => upstream?.close(resolve)); await fs.rm(directory, {recursive: true, force: true}); });

async function scriptWith(bytes, content, headers = sourceHeaders) {
    const {id} = await app.store.saveScript('js', `代理头样本-${bytes}-${Math.random().toString(36).slice(2, 7)}.js`, proxyRule(content, headers).replace('BYTES', String(bytes)));
    return id;
}
// 取 302 的 Location（模拟浏览器收到重定向），再匿名跟随——票据在这个请求里生效。
async function followProxy(id) {
    const viaProxy = await fetch(`${base}/proxy/${id}/?x=1`, {redirect: 'manual', headers: {authorization}});
    assert.equal(viaProxy.status, 302, `proxy status=${viaProxy.status}`);
    const location = viaProxy.headers.get('location');
    assert.ok(location, '缺少 Location');
    const response = await fetch(new URL(location, base), {});
    assert.equal(response.status, 200, await response.text());
    return new URL(location, base);
}

test('toBytes=2 重定向保留源返回的 Cookie/Referer/Authorization', async () => {
    seen.length = 0;
    await followProxy(await scriptWith(2, `${upstreamUrl}/m2.mp4`));
    const received = seen.at(-1);
    assert.equal(received.url, '/m2.mp4');
    assert.equal(received.headers.cookie, 'SID=secret');
    assert.equal(received.headers.referer, 'https://site.invalid/');
    assert.equal(received.headers.authorization, 'Bearer upstream-token');
});
test('toBytes=3 直接拉流保留源返回的 Cookie/Referer/Authorization（对照）', async () => {
    seen.length = 0;
    const response = await fetch(`${base}/proxy/${await scriptWith(3, `${upstreamUrl}/m3.mp4`)}/?x=1`, {headers: {authorization}});
    assert.equal(await response.text(), 'MEDIA');
    const received = seen.at(-1);
    assert.equal(received.url, '/m3.mp4');
    assert.equal(received.headers.cookie, 'SID=secret');
    assert.equal(received.headers.referer, 'https://site.invalid/');
    assert.equal(received.headers.authorization, 'Bearer upstream-token');
});
test('旧基类 /mediaProxy?...&form=base64&header=... 形式被宿主解包并补签票据', async () => {
    const legacy = `${base}/mediaProxy?url=${encodeURIComponent(b64(`${upstreamUrl}/legacy.mp4`))}&form=base64&stream=1&header=${encodeURIComponent(b64(JSON.stringify({Cookie: 'LEGACY=SID', Referer: 'https://legacy.invalid/'})))}`;
    seen.length = 0;
    // 旧基类的写法是 headers 走辅助函数、元组第 4 位为空。
    await followProxy(await scriptWith(2, legacy, {}));
    const received = seen.at(-1);
    assert.equal(received.url, '/legacy.mp4');
    assert.equal(received.headers.cookie, 'LEGACY=SID');
    assert.equal(received.headers.referer, 'https://legacy.invalid/');
});
test('调用方传入的 Host/Cookie/Authorization 仍被丢弃（订阅 Token 路径）', async () => {
    seen.length = 0;
    const spoofed = JSON.stringify({Host: 'evil.example', Cookie: 'x=y', Authorization: 'Bearer evil', Referer: 'https://ok.invalid/'});
    const response = await fetch(`${base}/mediaProxy?url=${encodeURIComponent(`${upstreamUrl}/spoof.mp4`)}&token=${subscriptionToken}&headers=${encodeURIComponent(spoofed)}`);
    assert.equal(response.status, 200, await response.text());
    const received = seen.at(-1);
    assert.equal(received.headers.cookie, undefined);
    assert.equal(received.headers.authorization, undefined);
    assert.notEqual(received.headers.host, 'evil.example');
    assert.equal(received.headers.referer, 'https://ok.invalid/');
});

const business = {Referer: 'https://strict.invalid/%E7%89%87', 'User-Agent': 'Fixture-Agent', Cookie: 'SID=explicit', Authorization: 'Bearer explicit', 'X-Fixture': 'UTF8-encoded-%E7%89%87', 'X!Fixture': 'legal-token-name'};
const encodedQuery = (url, fields) => '/mediaProxy?' + new URLSearchParams({url, ...fields});
const callerCases = () => [
    {name: 'subscription', fields: {token: subscriptionToken}, inbound: {}, privileged: false},
    {name: 'admin', fields: {}, inbound: {authorization}, privileged: true},
    {name: 'runtime', fields: {}, inbound: {'x-drpy-runtime': app.runner.internalKey}, privileged: true},
];
test('媒体 GET/HEAD 统一支持 JSON headers 与旧 base64 header，显式业务头按凭据来源传递', async () => {
    for (const caller of callerCases()) for (const method of ['GET', 'HEAD']) for (const legacy of [false, true]) {
        const fields = legacy ? {header: b64(JSON.stringify(business)), form: 'base64'} : {headers: JSON.stringify(business)};
        const target = legacy ? b64(upstreamUrl + '/strict/video.mp4') : upstreamUrl + '/strict/video.mp4';
        const response = await fetch(base + encodedQuery(target, {...caller.fields, ...fields}), {method, headers: caller.inbound});
        assert.equal(response.status, 200, caller.name + ':' + method + ':' + legacy);
        await response.arrayBuffer();
        const actual = seen.at(-1).headers;
        assert.equal(actual.referer, business.Referer); assert.equal(actual['user-agent'], business['User-Agent']);
        assert.equal(actual.cookie, caller.privileged ? business.Cookie : undefined);
        assert.equal(actual.authorization, caller.privileged ? business.Authorization : undefined);
        assert.equal(actual['x-drpy-runtime'], undefined); assert.equal(actual['x!fixture'],'legal-token-name');
    }
});
test('headers 优先于 header，与 form 无关；base64 JSON/URL 和额外 URL 编码兼容', async () => {
    for (const caller of callerCases()) for (const headers of [JSON.stringify(business), b64(JSON.stringify(business)), encodeURIComponent(JSON.stringify(business))]) {
        const response = await fetch(base + encodedQuery(encodeURIComponent(upstreamUrl + '/strict/video.mp4'), {...caller.fields, headers, header: b64('{}'), form: 'base64'}), {headers: caller.inbound});
        assert.equal(response.status, 200); await response.arrayBuffer();
    }
});
test('非法媒体头 JSON/base64/数组/标量/换行/头名明确 400，不访问上游；未授权仍 403', async () => {
    for (const caller of callerCases()) for (const raw of ['{', '%%%=', '[]', 'null', '1', '"abc"', '{"Bad Name":"x"}', '{"Referer":"a\\r\\nb"}', '{"Referer":3}', b64(Buffer.from([255]).toString('latin1')), '{"Referer":"片"}']) {
        const before = seen.length;
        const url = encodedQuery(upstreamUrl + '/invalid', {...caller.fields, headers: raw});
        const response = await fetch(base + url, {headers: caller.inbound});
        assert.equal(response.status, 400, caller.name + ':' + raw); await response.arrayBuffer();
        assert.equal(seen.length, before);
    }
    assert.equal((await fetch(base + encodedQuery(upstreamUrl + '/invalid', {headers: '{'}))).status, 403);
});
test('没有显式业务头时，入站管理 Basic 和内部密钥不传外站；统一转发路由兼容', async () => {
    for (const inbound of [{authorization}, {'x-drpy-runtime': app.runner.internalKey}]) {
        const response = await fetch(base + encodedQuery(upstreamUrl + '/no-explicit', {}), {headers: inbound});
        assert.equal(response.status, 200); await response.arrayBuffer();
        assert.equal(seen.at(-1).headers.authorization, undefined); assert.equal(seen.at(-1).headers['x-drpy-runtime'], undefined);
    }
    for (const route of ['/file-proxy/proxy', '/m3u8-proxy/playlist', '/unified-proxy/proxy']) {
        const response = await fetch(base + route + '?' + new URLSearchParams({url: b64(upstreamUrl + '/strict/video.mp4'), header: b64(JSON.stringify(business))}), {headers: {authorization}});
        assert.equal(response.status, 200); await response.arrayBuffer();
        assert.equal(seen.at(-1).headers.cookie, business.Cookie);
    }
});
test('源直接播放旧 mediaProxy URL：实际匿名跟随 GET/HEAD/Range/HLS，票据头不受调用方覆盖', async () => {
    const legacy = base + encodedQuery(b64(upstreamUrl + '/strict/master.m3u8'), {header: b64(JSON.stringify(business)), form: 'base64'});
    const script = await app.store.saveScript('js', 'legacy-direct.js', `var rule={title:'legacy-direct',host:'https://fixture.invalid',play_parse:true,lazy:async()=>({parse:0,url:${JSON.stringify(legacy)}})};`);
    const resolve = await fetch(base + `/watch/sources/${script.id}/play`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({play:'fixture'})});
    assert.equal(resolve.status, 200);
    const result = await resolve.json(), media = result.url;
    assert.ok(!JSON.stringify(result).includes(business.Cookie));
    const head = await fetch(base + media, {method:'HEAD'}); assert.equal(head.status,200);
    const master = await fetch(base + media); assert.equal(master.status,200);
    const childUrl = (await master.text()).split('\n').find(line => line && !line.startsWith('#'));
    const child = await fetch(childUrl); assert.equal(child.status,200);
    const text = await child.text();
    const segment = text.split('\n').find(line => line && !line.startsWith('#'));
    const key = text.match(/URI="([^"]+)"/)[1];
    for (const url of [segment, key]) for (const method of ['GET','HEAD']) {
        const tampered = new URL(url); tampered.searchParams.set('headers','{'); tampered.searchParams.set('header',b64('{}'));
        const response = await fetch(tampered, {method, headers: method === 'GET' ? {range:'bytes=1-3'} : {}});
        assert.equal(response.status, method === 'GET' ? 206 : 200);
        if (method === 'GET') { assert.equal(response.headers.get('content-range'),'bytes 1-3/5'); assert.equal(await response.text(),'EDI'); }
        assert.equal(seen.at(-1).headers.cookie,business.Cookie); assert.equal(seen.at(-1).headers.authorization,business.Authorization);
        tampered.searchParams.set('url',upstreamUrl + '/other'); assert.equal((await fetch(tampered)).status,403);
    }
});
test('toBytes=2/3 解包 headers 优先于旧 header，源凭据保留', async () => {
    const carried = base + encodedQuery(b64(upstreamUrl + '/strict/video.mp4'), {headers: JSON.stringify(business), header: b64('{}'), form:'base64'});
    for (const bytes of [2,3]) {
        const response = await fetch(base + `/proxy/${await scriptWith(bytes,carried,{})}/`, {headers:{authorization}});
        assert.equal(response.status,200); await response.arrayBuffer();
        assert.equal(seen.at(-1).headers.cookie,business.Cookie);
    }
});

test('Python 基类媒体 URL 的 base64 加号保持兼容，真实辅助函数生成地址可拉流', async () => {
    const {execFile} = await import('node:child_process');
    const {promisify} = await import('node:util');
    const {fileURLToPath} = await import('node:url');
    const headers = {...business, 'X-Python': '~'.repeat(20)};
    let target = upstreamUrl + '/strict/video.mp4?q=';
    while (!b64(target).includes('+')) target += '~';
    assert.ok(b64(JSON.stringify(headers)).includes('+'));
    const {stdout} = await promisify(execFile)(process.env.TEST_PYTHON || 'python3', ['-c', `
import importlib.util,json,sys,types
spec=importlib.util.spec_from_file_location('fixture_base',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
fixture=types.SimpleNamespace(base64Encode=m.Spider.base64Encode)
print(m.Spider.proxy_media_url(fixture,sys.argv[2],json.loads(sys.argv[3]),sys.argv[4]))
`, fileURLToPath(new URL('../engine/spider/py/base/spider.py', import.meta.url)), target, JSON.stringify(headers), base+'/mediaProxy']);
    const rawLegacy = base + '/mediaProxy?url=' + b64(target) + '&header=' + b64(JSON.stringify(headers)) + '&form=base64';
    for (const url of [rawLegacy, stdout.trim()]) {
        const response = await fetch(url, {headers:{authorization}});
        assert.equal(response.status,200); await response.arrayBuffer();
        assert.equal(seen.at(-1).url,new URL(target).pathname + new URL(target).search);
        assert.equal(seen.at(-1).headers.cookie,business.Cookie);
        assert.equal(seen.at(-1).headers['x-python'],headers['X-Python']);
    }
});
