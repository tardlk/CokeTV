import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import AdmZip from 'adm-zip';
import {createApp} from '../src/server.js';
import {Store} from '../src/store.js';
import {Runner} from '../src/runner.js';
import {importBundle} from '../src/sources.js';
import {createFtpFixture} from './fixtures/ftp-server.js';

async function temporary(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-regression-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    return directory;
}
const cookie = 'UID=fixture; CID=fixture; SEID=fixed-test-only';
const localURL = value => { const url = new URL(value); return url.pathname + url.search; };
const uris = body => [...body.matchAll(/(?:URI="|\n)(http[^"\n]+)/g)].map(match => match[1]);
test('多层网盘 HLS 的清单、KEY/MAP、分片跨代理入口继承源与账号范围', async t => {
    const directory = await temporary(t);
    const upstream = http.createServer((req, res) => {
        res.setHeader('Content-Type', req.url.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/octet-stream');
        res.end(req.url === '/root.m3u8' ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nmiddle.m3u8\n' : req.url === '/middle.m3u8' ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nchild.m3u8\n' : req.url === '/child.m3u8' ? '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\npart.ts\n' : 'fixed-media');
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => upstream.close(resolve)));
    const media = `http://127.0.0.1:${upstream.address().port}/root.m3u8`;
    const app = await createApp({directory, seed: false, netdiskRequest: async options => ({status: 200, data: {state: true, data: options.url.includes('/snap') ? {count: 1, list: [{fc: '1', fid: '1', n: 'sample.mp4'}]} : {url: {url: media}}}})});
    t.after(() => app.close());
    await app.netdisk.accounts.save115(cookie, 'web');
    const script = await app.store.saveScript('js', 'scope.js', 'var rule={};');
    const source = app.store.state.instances.find(item => item.scriptId === script.id);
    const [reference] = await app.netdisk.files(source.id, 'https://115.com/s/fixture');
    const played = await app.inject({method: 'POST', url: `/watch/sources/${source.id}/play`, payload: {play: reference.reference}});
    assert.equal(played.statusCode, 200, played.body);
    const root = await app.inject(played.json().url);
    const middleURL = uris(root.body)[0];
    const middle = await app.inject(localURL(middleURL));
    const childURL = new URL(uris(middle.body)[0]);
    // Exercise /req as well as /mediaProxy, then the ordinary proxy aliases.
    const child = await app.inject(`/req/${encodeURIComponent(childURL.searchParams.get('url'))}?token=${childURL.searchParams.get('token')}`);
    assert.equal(child.statusCode, 200, child.body);
    const children = uris(child.body);
    assert.equal(children.length, 3);
    for (const url of children) assert.equal((await app.inject(localURL(url))).statusCode, 200);
    source.enabled = false;
    for (const url of children) assert.equal((await app.inject(localURL(url))).statusCode, 403, '停用源后最深层引用也拒绝');
    source.enabled = true;
    await app.netdisk.accounts.save115(cookie + '; KID=updated', 'web');
    for (const url of children) {
        const alias = new URL(url); alias.pathname = '/m3u8-proxy/ts';
        assert.equal((await app.inject(localURL(alias.href))).statusCode, 403, '更新账号后不能从别名路由复用旧引用');
    }
});

for (const existing of [false, true]) test(`脚本${existing ? '更新' : '新建'}在 state 写入失败后恢复文件与历史`, async t => {
    const directory = await temporary(t), store = await new Store(directory).init({seed: false});
    if (existing) {
        await store.saveScript('js', 'saved.js', 'var rule={title:"older"};');
        await store.saveScript('js', 'saved.js', 'var rule={title:"old"};');
    }
    const state = JSON.stringify(store.state), diskState = await fs.readFile(store.stateFile);
    const file = path.join(store.runtime, 'spider/js/saved.js');
    const persist = store.persist.bind(store);
    store.persist = async () => { throw Object.assign(new Error('simulated full disk'), {code: 'ENOSPC'}); };
    await assert.rejects(store.saveScript('js', 'saved.js', 'var rule={title:"new"};'), /full disk/);
    assert.equal(JSON.stringify(store.state), state);
    assert.deepEqual(await fs.readFile(store.stateFile), diskState);
    if (existing) assert.equal(await fs.readFile(file, 'utf8'), 'var rule={title:"old"};');
    else await assert.rejects(fs.access(file), {code: 'ENOENT'});
    const revisions = await fs.readdir(path.join(directory, 'revisions'), {recursive: true}).catch(() => []);
    assert.equal(revisions.filter(name => name.endsWith('.txt')).length, existing ? 1 : 0, '失败操作不增加或删除原历史版本');
    if (existing) assert.equal(await fs.readFile(path.join(directory, 'revisions', revisions.find(name => name.endsWith('.txt'))), 'utf8'), 'var rule={title:"older"};');
    store.persist = persist;
    await store.saveScript('js', 'saved.js', 'var rule={title:"retry"};');
    assert.equal(await fs.readFile(file, 'utf8'), 'var rule={title:"retry"};', '写入恢复后可再次保存');
});

for (const failure of ['file', 'state']) test(`混合 ZIP 在${failure}写入失败时整包撤回，原配置和文件保留`, async t => {
    const directory = await temporary(t), store = await new Store(directory).init({seed: false});
    await store.saveScript('js', 'existing.js', 'var rule={title:"existing"};');
    const state = JSON.stringify(store.state), diskState = await fs.readFile(store.stateFile);
    const zip = new AdmZip();
    const entries = {'first.js': 'var rule={title:"first"};', 'json/resource.json': '{"value":1}', 'spider/catLib/_helper.js': 'export default 1;', 'jx/parser.js': 'var jx={};', 'second.js': 'var rule={title:"second"};'};
    for (const [name, code] of Object.entries(entries)) zip.addFile(name, Buffer.from(code));
    const atomic = store.atomic.bind(store);
    store.atomic = async (file, ...args) => {
        if ((failure === 'file' && file.endsWith('/second.js')) || (failure === 'state' && file === store.stateFile)) throw new Error('simulated failed write');
        return atomic(file, ...args);
    };
    await assert.rejects(importBundle(store, 'js', zip.toBuffer()), /failed write/);
    assert.equal(JSON.stringify(store.state), state);
    assert.deepEqual(await fs.readFile(store.stateFile), diskState);
    assert.equal(await fs.readFile(path.join(store.runtime, 'spider/js/existing.js'), 'utf8'), 'var rule={title:"existing"};');
    for (const name of Object.keys(entries)) await assert.rejects(fs.access(path.join(store.runtime, name.includes('/') ? name : 'spider/js/' + name)), {code: 'ENOENT'});
});
test('ZIP 同名不同内容在写入前拒绝，不覆盖已有源或参数资源', async t => {
    const directory = await temporary(t), store = await new Store(directory).init({seed: false});
    await store.saveScript('js', 'existing.js', 'var rule={title:"original"};');
    const state = JSON.stringify(store.state), zip = new AdmZip();
    zip.addFile('new.js', Buffer.from('var rule={};'));
    zip.addFile('existing.js', Buffer.from('var rule={title:"replacement"};'));
    await assert.rejects(importBundle(store, 'js', zip.toBuffer()), /冲突|已存在/);
    assert.equal(JSON.stringify(store.state), state);
    assert.equal(await fs.readFile(path.join(store.runtime, 'spider/js/existing.js'), 'utf8'), 'var rule={title:"original"};');
    await assert.rejects(fs.access(path.join(store.runtime, 'spider/js/new.js')), {code: 'ENOENT'});
});
test('首次并发 HTTP 网关请求都完成，FTP 与 WebDAV 健康检查均可用', {timeout: 6000}, async t => {
    const directory = await temporary(t), app = await createApp({directory, seed: false});
    t.after(() => app.close());
    await app.listen({port: 0, host: '127.0.0.1'});
    const base = `http://127.0.0.1:${app.server.address().port}`, token = app.store.state.subscriptions[0].token;
    const replies = await Promise.all(['/ftp/health', '/webdav/health'].map(url => fetch(`${base}${url}?token=${token}`, {signal: AbortSignal.timeout(2500)})));
    for (const reply of replies) assert.equal(reply.status, 200, await reply.text());
});
test('网关启动失败后全部等待者拒绝并能重试；关闭后的网关不再启动', {timeout: 2000}, async t => {
    const directory = await temporary(t), runner = new Runner(await new Store(directory).init({seed: false}));
    t.after(() => runner.close());
    runner.start = async () => { throw new Error('fixture startup failure'); };
    const failed = await Promise.allSettled([runner.gateway(), runner.gateway()]);
    assert.ok(failed.every(item => item.status === 'rejected' && /startup failure/.test(item.reason.message)));
    let sends = 0;
    runner.start = async () => { runner.child = {send: (_message, callback) => { sends++; callback?.(new Error('fixture IPC failure')); }}; };
    const ipc = await Promise.allSettled([runner.gateway(), runner.gateway()]);
    assert.ok(ipc.every(item => item.status === 'rejected' && /IPC failure/.test(item.reason.message)));
    assert.equal(sends, 1);
    runner.child = null; runner.close();
    await assert.rejects(runner.gateway(), /关闭/);
});
test('网关启动无响应时统一超时并释放所有等待者', async t => {
    const directory = await temporary(t), runner = new Runner(await new Store(directory).init({seed: false}));
    t.after(() => runner.close());
    runner.start = async () => { runner.child = {send() {}}; };
    t.mock.timers.enable({apis: ['setTimeout']});
    const results = Promise.allSettled([runner.gateway(), runner.gateway()]);
    await Promise.resolve(); t.mock.timers.tick(10000);
    assert.ok((await results).every(item => item.status === 'rejected' && /网关启动超时/.test(item.reason.message)));
    assert.equal(runner.gatewayPending, null); assert.equal(runner.child, null);
});
test('FTP 固定协议样本支持文件 GET、Range 与 HEAD，HEAD 不下载文件', {timeout: 8000}, async t => {
    const directory = await temporary(t), ftp = await createFtpFixture();
    t.after(() => ftp.close());
    const app = await createApp({directory, seed: false}); t.after(() => app.close());
    await fs.writeFile(path.join(app.store.runtime, 'json/ftp.json'), JSON.stringify({host: '127.0.0.1', port: ftp.port, username: 'fixture', password: 'fixture', timeout: 2000}));
    const url = `/ftp/file?path=/sample.mp4&token=${app.store.state.subscriptions[0].token}`;
    const full = await app.inject(url);
    assert.equal(full.statusCode, 200, full.body); assert.deepEqual(full.rawPayload, ftp.bytes);
    const range = await app.inject({url, headers: {range: 'bytes=2-5'}});
    assert.equal(range.statusCode, 206, range.body); assert.equal(range.body, '2345'); assert.equal(range.headers['content-range'], 'bytes 2-5/10');
    const before = ftp.commands.filter(line => line.startsWith('RETR')).length;
    const head = await app.inject({url, method: 'HEAD', headers: {range: 'bytes=2-5'}});
    assert.equal(head.statusCode, 206, head.body); assert.equal(head.headers['content-length'], '4'); assert.equal(head.body, '');
    assert.equal(ftp.commands.filter(line => line.startsWith('RETR')).length, before, 'HEAD 只查文件信息');
    assert.equal((await app.inject({url, method: 'HEAD', headers: {range: 'bytes=20-25'}})).statusCode, 416);
});
