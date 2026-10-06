import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import forge from 'node-forge';
import {createApp} from '../src/server.js';

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-outbound-'));
    const seen = [];
    const upstream = http.createServer(async (request, response) => {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        seen.push({url: request.url, method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString()});
        const url = new URL(request.url, 'http://fixture.invalid');
        if (url.pathname === '/to-ip') { response.writeHead(302, {location: `http://127.0.0.1:${upstream.address().port}/forbidden`}); response.end(); return; }
        if (url.pathname === '/to-mapped') { response.writeHead(302, {location: `http://[::ffff:7f00:1]:${upstream.address().port}/forbidden`}); response.end(); return; }
        if (url.pathname === '/to-host') { response.writeHead(307, {location: `http://other.fixture.invalid:${upstream.address().port}/echo`}); response.end(); return; }
        if (url.pathname === '/to-subdomain') { response.writeHead(307, {location: `http://child.allowed.fixture.invalid:${upstream.address().port}/echo`}); response.end(); return; }
        if (url.pathname === '/loop') { response.writeHead(302, {location: '/loop'}); response.end(); return; }
        if (url.pathname.startsWith('/move/')) { response.writeHead(Number(url.pathname.split('/').at(-1)), {location: '/echo?from=redirect'}); response.end(); return; }
        if (url.pathname === '/playlist.m3u8') { response.setHeader('content-type', 'application/vnd.apple.mpegurl'); response.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:1,\nsegment.ts\n'); return; }
        if (url.pathname === '/echo') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(seen.at(-1))); return; }
        if (request.headers.range) { response.writeHead(206, {'content-range': 'bytes 2-5/10'}); response.end('2345'); return; }
        response.end('fixed-upstream');
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const app = await createApp({directory, seed: false});
    t.after(async () => { await app.close(); await new Promise(resolve => upstream.close(resolve)); await fs.rm(directory, {recursive: true, force: true}); });
    const token = app.store.state.subscriptions[0].token;
    const port = upstream.address().port;
    return {app, seen, port, token,
        media: (url, options = {}) => app.inject({url: `/mediaProxy?${new URLSearchParams({url, token})}`, ...options}),
        request: payload => app.inject({method: 'POST', url: `/http?token=${token}`, payload}),
    };
}

function localDns(t, lookupSeen = []) {
    const original = dns.lookup;
    t.mock.method(dnsPromises, 'lookup', async host => {
        lookupSeen.push(host);
        return [{address: '127.0.0.1', family: 4}];
    });
    t.mock.method(dns, 'lookup', (host, options, callback) => {
        if (!host.endsWith('.fixture.invalid')) return original(host, options, callback);
        process.nextTick(() => options.all ? callback(null, [{address: '127.0.0.1', family: 4}]) : callback(null, '127.0.0.1', 4));
    });
}

test('R3 映射回环媒体受内网开关控制，重定向到映射目标仍复核', async t => {
    const f = await fixture(t); localDns(t);
    const mapped = `http://[::ffff:127.0.0.1]:${f.port}/video`;
    assert.equal((await f.media(mapped)).statusCode, 200);
    f.app.store.state.settings.allowPrivateTargets = false;
    const before = f.seen.length;
    assert.equal((await f.media(mapped)).statusCode, 403);
    assert.equal(f.seen.length, before);
    f.app.store.state.settings.allowPrivateTargets = true;
    f.app.store.state.settings.targetAllowlist = ['allowed.fixture.invalid'];
    assert.equal((await f.media(`http://allowed.fixture.invalid:${f.port}/to-mapped`)).statusCode, 403);
    assert.ok(!f.seen.some(entry => entry.url === '/forbidden'));
});

for (const kind of ['media', 'http']) test(`R4 ${kind} 连接绑定受检 DNS 结果，第二次解析的回环答案不能被连接`, async t => {
    const f = await fixture(t);
    f.app.store.state.settings.allowPrivateTargets = false;
    let secondLookups = 0, checkedDials = 0;
    const checked = '203.0.113.20';
    t.mock.method(dnsPromises, 'lookup', async () => [{address: checked, family: 4}]);
    t.mock.method(dns, 'lookup', (_host, options, callback) => {
        secondLookups++;
        process.nextTick(() => options.all ? callback(null, [{address: '127.0.0.1', family: 4}]) : callback(null, '127.0.0.1', 4));
    });
    // Preserve the real HTTP client/socket path to the local fixture. Intercept
    // ONLY a dial to the checked public answer so tests never contact the Internet.
    const original = http.request;
    t.mock.method(http, 'request', (...args) => {
        const options = args[0] instanceof URL ? args[1] : args[0];
        const lookup = options.lookup || options.agent?.options?.lookup || dns.lookup;
        options.lookup = (host, lookupOptions, callback) => lookup(host, lookupOptions, (error, answer, family) => {
            if (error) { callback(error); return; }
            const addresses = lookupOptions.all ? answer : [{address: answer, family}];
            if (addresses.some(entry => entry.address === checked)) {
                checkedDials++;
                callback(Object.assign(new Error('fixture prevents public dial'), {code: 'EHOSTUNREACH', statusCode: 502}));
            } else callback(null, answer, family);
        });
        return original(...args);
    });
    const url = `http://rebind.fixture.invalid:${f.port}/forbidden`;
    const response = kind === 'media' ? await f.media(url) : await f.request({url});
    assert.equal(f.seen.length, 0, 'DNS 检查之后连接了未经检查的回环地址');
    assert.equal(secondLookups, 0, '连接阶段再次调用 DNS');
    assert.equal(checkedDials, 1);
    assert.equal(response.statusCode, kind === 'media' ? 502 : 500);
});

test('R4 固定受检地址仍保留 Host、Range、HEAD、重定向和 HLS 分片/key 请求', async t => {
    const f = await fixture(t), lookups = []; localDns(t, lookups);
    t.mock.method(dns, 'lookup', () => { throw new Error('unexpected second DNS lookup'); });
    const base = `http://allowed.fixture.invalid:${f.port}`;
    const response = await f.media(`${base}/move/302`, {headers: {range: 'bytes=2-5'}});
    assert.equal(response.statusCode, 200, response.body); // /echo returns JSON, with Range preserved.
    assert.equal(f.seen.at(-1).headers.host, `allowed.fixture.invalid:${f.port}`);
    assert.equal(f.seen.at(-1).headers.range, 'bytes=2-5');
    assert.equal(lookups.length, 2);
    const range = await f.media(`${base}/video`, {headers: {range: 'bytes=2-5'}});
    assert.equal(range.statusCode, 206); assert.equal(range.body, '2345');
    assert.equal((await f.media(`${base}/video`, {method: 'HEAD'})).statusCode, 200);
    const playlist = await f.media(`${base}/playlist.m3u8`);
    assert.equal(playlist.statusCode, 200, playlist.body);
    for (const url of [playlist.body.match(/URI="([^"]+)"/)[1], playlist.body.split('\n').find(line => line.startsWith('http'))]) {
        const parsed = new URL(url);
        assert.equal((await f.app.inject(parsed.pathname + parsed.search)).statusCode, 200);
        assert.equal(f.seen.at(-1).headers.host, `allowed.fixture.invalid:${f.port}`);
    }
});

test('R4 HTTPS 固定连接 IP 仍使用原域名的 Host/SNI，并验证 TLS 证书', async t => {
    const f = await fixture(t); localDns(t);
    const keys = forge.pki.rsa.generateKeyPair(2048), cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey; cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 60000); cert.validity.notAfter = new Date(Date.now() + 3600000);
    cert.setSubject([{name: 'commonName', value: 'tls.fixture.invalid'}]); cert.setIssuer(cert.subject.attributes);
    cert.setExtensions([{name: 'basicConstraints', cA: true}, {name: 'subjectAltName', altNames: [{type: 2, value: 'tls.fixture.invalid'}]}]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const ca = forge.pki.certificateToPem(cert), seen = [];
    const server = https.createServer({cert: ca, key: forge.pki.privateKeyToPem(keys.privateKey)}, (request, response) => {
        seen.push({host: request.headers.host, sni: request.socket.servername}); response.end('tls-ok');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    t.mock.method(dns, 'lookup', () => { throw new Error('unexpected second DNS lookup'); });
    const original = https.request;
    t.mock.method(https, 'request', (...args) => {
        const index = args[0] instanceof URL ? 1 : 0;
        args[index] = {...args[index], ca}; // Trust only the temporary fixture certificate; keep TLS verification on.
        return original(...args);
    });
    const url = `https://tls.fixture.invalid:${server.address().port}/`;
    assert.equal((await f.media(url)).body, 'tls-ok');
    const response = await f.request({url, responseType: 'text'});
    assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().data, 'tls-ok');
    assert.deepEqual(seen, Array(2).fill({host: `tls.fixture.invalid:${server.address().port}`, sni: 'tls.fixture.invalid'}));
    // Existing sources can address an IP and set Host for a TLS virtual host.
    const virtualHost = await f.request({url: `https://127.0.0.1:${server.address().port}/`, headers: {Host: `tls.fixture.invalid:${server.address().port}`}, responseType: 'text'});
    assert.equal(virtualHost.statusCode, 200, virtualHost.body);
    assert.deepEqual(seen.at(-1), {host: `tls.fixture.invalid:${server.address().port}`, sni: 'tls.fixture.invalid'});
    const invalid = await f.media(`https://wrong.fixture.invalid:${server.address().port}/`);
    assert.equal(invalid.statusCode, 500, '证书域名不匹配不能被接受');
});

test('R6 /http 首跳允许、跳转 IP 被拒绝；无凭据或媒体票据不能调用该服务', async t => {
    const f = await fixture(t); localDns(t);
    f.app.store.state.settings.targetAllowlist = ['allowed.fixture.invalid'];
    const url = `http://allowed.fixture.invalid:${f.port}/to-ip`;
    assert.equal((await f.request({url: `http://127.0.0.1:${f.port}/forbidden`})).statusCode, 403);
    assert.equal((await f.request({url})).statusCode, 403);
    assert.deepEqual(f.seen.map(entry => entry.url), ['/to-ip']);
    assert.equal((await f.app.inject({method: 'POST', url: '/http', payload: {url}})).statusCode, 403);
    const script = await f.app.store.saveScript('js', 'HTTP票据.js', "var rule={title:'HTTP票据',host:'https://fixture.invalid',play_parse:true,lazy:async(a,b)=>({parse:0,url:b})};");
    const play = await f.app.inject({method: 'POST', url: `/watch/sources/${script.id}/play`, payload: {play: url}});
    assert.equal(play.statusCode, 200, play.body);
    const token = play.json().url.split('/').at(-1);
    assert.equal((await f.app.inject({method: 'POST', url: `/http?token=${token}`, payload: {url}})).statusCode, 403);
});

test('R6 /http 每跳固定 DNS，保留 Axios 的方法/请求体/头/参数/响应类型和重定向上限语义', async t => {
    const f = await fixture(t); localDns(t);
    const base = `http://allowed.fixture.invalid:${f.port}`;
    t.mock.method(dns, 'lookup', () => { throw new Error('unexpected second DNS lookup'); });
    for (const [status, method, expected] of [[301, 'POST', 'GET'], [302, 'POST', 'GET'], [303, 'PUT', 'GET'], [301, 'PUT', 'PUT'], [307, 'POST', 'POST'], [308, 'POST', 'POST']]) {
        const response = await f.request({url: `${base}/move/${status}`, method, data: {fixture: 'body'}, params: {q: 'first-hop'}, headers: {'Content-Type': 'application/json', 'X-Fixture': 'custom', Authorization: 'Bearer upstream', Cookie: 'fixture=secret'}});
        assert.equal(response.statusCode, 200, response.body);
        const value = response.json().data;
        assert.equal(value.method, expected);
        assert.equal(value.body, expected === 'GET' ? '' : '{"fixture":"body"}');
        assert.equal(value.headers['x-fixture'], 'custom'); assert.equal(value.headers.authorization, 'Bearer upstream'); assert.equal(value.headers.cookie, 'fixture=secret');
        assert.equal(value.url, '/echo?from=redirect');
        assert.equal(f.seen.at(-2).url, `/move/${status}?q=first-hop`);
        if (expected === 'GET') assert.equal(value.headers['content-type'], undefined);
    }
    const text = await f.request({url: `${base}/echo`, responseType: 'text'});
    assert.equal(typeof text.json().data, 'string');
    const bytes = await f.request({url: `${base}/video`, responseType: 'arraybuffer'});
    assert.deepEqual(bytes.json().data, {type: 'Buffer', data: [...Buffer.from('fixed-upstream')]});
    const unfollowed = await f.request({url: `${base}/move/307`, maxRedirects: 0});
    assert.equal(unfollowed.statusCode, 307); assert.equal(unfollowed.json().headers.location, '/echo?from=redirect');
    const before = f.seen.length;
    assert.equal((await f.request({url: `${base}/loop`, maxRedirects: 1})).statusCode, 500);
    assert.equal(f.seen.length - before, 2);
    for (const maxRedirects of [-1, 22]) assert.equal((await f.request({url: `${base}/echo`, maxRedirects})).statusCode, 400);
});

test('R6 /http 跨域跳转丢弃 Cookie/Authorization/Host，保留方法、请求体及普通头', async t => {
    const f = await fixture(t); localDns(t);
    const response = await f.request({url: `http://allowed.fixture.invalid:${f.port}/to-host`, method: 'POST', data: 'raw-body', headers: {Host: `allowed.fixture.invalid:${f.port}`, Cookie: 'fixture=secret', Authorization: 'Bearer upstream', 'X-Fixture': 'custom'}});
    assert.equal(response.statusCode, 200, response.body);
    const value = response.json().data;
    assert.equal(value.headers.cookie, undefined); assert.equal(value.headers.authorization, undefined);
    assert.equal(value.headers.host, `other.fixture.invalid:${f.port}`);
    assert.equal(value.method, 'POST'); assert.equal(value.body, 'raw-body'); assert.equal(value.headers['x-fixture'], 'custom');
    const child = await f.request({url: `http://allowed.fixture.invalid:${f.port}/to-subdomain`, headers: {Cookie: 'fixture=secret', Authorization: 'Bearer upstream'}});
    assert.equal(child.statusCode, 200, child.body);
    assert.equal(child.json().data.headers.cookie, 'fixture=secret');
    assert.equal(child.json().data.headers.authorization, 'Bearer upstream');
});

test('R4/R6 /http 同域重定向也重新检查 DNS，新的映射元数据答案在连接前拒绝', async t => {
    const f = await fixture(t); localDns(t);
    let checked = 0;
    t.mock.method(dnsPromises, 'lookup', async () => [{address: ++checked === 1 ? '127.0.0.1' : '::ffff:a9fe:a9fe', family: checked === 1 ? 4 : 6}]);
    const response = await f.request({url: `http://allowed.fixture.invalid:${f.port}/move/302`});
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(checked, 2);
    assert.deepEqual(f.seen.map(entry => entry.url), ['/move/302']);
});

test('R4 /http 不通过环境代理重新解析目标，实际连接仍使用受检地址', async t => {
    const f = await fixture(t); localDns(t);
    const previous = process.env.http_proxy, previousNoProxy = process.env.no_proxy;
    process.env.http_proxy = `http://127.0.0.1:${f.port}`; process.env.no_proxy = '';
    t.after(() => {
        if (previous === undefined) delete process.env.http_proxy; else process.env.http_proxy = previous;
        if (previousNoProxy === undefined) delete process.env.no_proxy; else process.env.no_proxy = previousNoProxy;
    });
    const response = await f.request({url: `http://allowed.fixture.invalid:${f.port}/echo`});
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().data.url, '/echo');
});
