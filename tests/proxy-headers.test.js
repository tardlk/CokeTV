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
        seen.push({url: req.url, headers: req.headers});
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
