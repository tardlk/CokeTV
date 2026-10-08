import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Pan115, parse115Share} from '../src/netdisk/pan115.js';
import {NetdiskAccountStore} from '../src/netdisk/accounts.js';

const cookie = 'UID=12345_A1; CID=fixture-cid; SEID=fixture-secret';
const response = data => ({status: 200, data: JSON.stringify({state: true, data}), headers: {}});
async function environment(fn) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-netdisk-'));
    try { await fn(directory); } finally { await fs.rm(directory, {recursive: true, force: true}); }
}
test('115 分享仅接受已知站点与规范分享路径，提取码单独校验', () => {
    assert.deepEqual(parse115Share('https://115.com/s/abcdef?password=aB12'), {shareCode: 'abcdef', receiveCode: 'aB12'});
    assert.deepEqual(parse115Share('https://115cdn.com/s/abcdef', 'cD34'), {shareCode: 'abcdef', receiveCode: 'cD34'});
    for (const url of ['https://115.com.evil.test/s/abc', 'https://evil.test/?url=https://115.com/s/abc', 'http://127.0.0.1/s/abc', 'file:///s/abc', 'https://x:y@115.com/s/abc', 'https://115.com/s/abc/other']) assert.throws(() => parse115Share(url));
    assert.throws(() => parse115Share('https://115.com/s/abc', 'x\r\ny'));
});
test('网盘凭据原子私密保存、重启读取，状态不返回凭据', async () => environment(async directory => {
    const store = await new NetdiskAccountStore(directory).init();
    await store.save115(cookie, 'alipaymini');
    const before = store.status();
    assert.equal(before.connected, true);
    assert.equal(JSON.stringify(before).includes('fixture-secret'), false);
    assert.equal((await fs.stat(store.file)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.dirname(store.file))).mode & 0o777, 0o700);
    const restarted = await new NetdiskAccountStore(directory).init();
    assert.equal(restarted.cookie(), cookie);
    assert.deepEqual(restarted.status(), before);
    await restarted.save115(cookie, 'web');
    assert.notEqual(restarted.status().revision, before.revision);
}));
test('损坏凭据拒绝初始化并保留原文件，不覆盖为未登录', async () => environment(async directory => {
    const store = await new NetdiskAccountStore(directory).init();
    await fs.writeFile(store.file, '{broken');
    await assert.rejects(new NetdiskAccountStore(directory).init());
    assert.equal(await fs.readFile(store.file, 'utf8'), '{broken');
}));
test('扫码状态只暴露随机会话引用，并发确认只兑换和保存一次', async () => environment(async directory => {
    const store = await new NetdiskAccountStore(directory).init(); let exchanges = 0;
    const requests = [];
    const pan = new Pan115({accounts: store, request: async options => {
        requests.push(options);
        if (options.url.includes('/token')) return response({uid: 'private-uid', time: 123, sign: 'private-sign', qrcode: 'private-qr'});
        if (options.url.includes('/get/status/')) return response({status: 2});
        if (options.url.includes('/login/qrcode')) { exchanges++; return response({cookie: {UID: '12345_A1', CID: 'fixture-cid', SEID: 'fixture-secret'}}); }
        throw new Error('unexpected request');
    }});
    const session = await pan.startLogin();
    assert.equal(JSON.stringify(session).includes('private'), false);
    const results = await Promise.all([pan.pollLogin(session.id), pan.pollLogin(session.id)]);
    assert.equal(exchanges, 1);
    assert.equal(results[0].status, 'confirmed');
    assert.equal(store.cookie(), cookie);
    assert.equal(requests.every(r => !r.headers?.Cookie), true);
    assert.equal(requests.at(-1).data.includes('app=alipaymini'), true);
    await assert.rejects(pan.pollLogin('missing'), /不存在|过期/);
}));
test('扫码过期、取消不覆盖已有账号；移除的旧电脑客户端不可选', async () => environment(async directory => {
    const store = await new NetdiskAccountStore(directory).init(); await store.save115(cookie, 'web');
    let now = 0;
    const pan = new Pan115({accounts: store, now: () => now, request: async options => options.url.includes('/token') ? response({uid: 'u', time: 1, sign: 's'}) : response({status: -2})});
    await assert.rejects(pan.startLogin('linux'));
    const session = await pan.startLogin();
    assert.equal((await pan.pollLogin(session.id)).status, 'canceled');
    assert.equal(store.cookie(), cookie);
    const expired = await pan.startLogin(); now = expired.expiresAt + 1;
    assert.equal((await pan.pollLogin(expired.id)).status, 'expired');
    assert.equal(store.cookie(), cookie);
}));
test('二维码长轮询超时保持等待并可重试，不丢失登录会话', async () => environment(async directory => {
    const accounts = await new NetdiskAccountStore(directory).init(); let now = 0, calls = 0;
    const pan = new Pan115({accounts, now: () => now, request: async options => {
        if (options.url.includes('/token')) return response({uid: 'u', time: 1, sign: 's'});
        if (++calls === 1) throw Object.assign(new Error('timeout with private URL'), {code: 'ECONNABORTED'});
        return response({status: 1});
    }});
    const session = await pan.startLogin();
    assert.equal((await pan.pollLogin(session.id)).status, 'waiting');
    now = 3000;
    assert.equal((await pan.pollLogin(session.id)).status, 'scanned');
}));
test('真实 115 长轮询约 30 秒后返回空 data 时继续等待，未知状态仍拒绝', async () => environment(async directory => {
    const accounts = await new NetdiskAccountStore(directory).init(); let now = 0, code = 'empty';
    const pan = new Pan115({accounts, now: () => now, request: async options => {
        if (options.url.includes('/token')) return response({uid: 'u', time: 1, sign: 's'});
        if (code === 'empty') return {status: 200, data: '{"state":1,"code":0,"message":"","data":{}}'};
        if (code === 'invalid') return response({status: 99});
        return response({status: 1});
    }});
    const session = await pan.startLogin();
    const waiting = await pan.pollLogin(session.id);
    assert.equal(waiting.status, 'waiting'); assert.equal(waiting.retrying, true);
    code = 'invalid'; now = 3000; await assert.rejects(pan.pollLogin(session.id), /状态异常/);
    code = 'scanned'; now = 6000; assert.equal((await pan.pollLogin(session.id)).status, 'scanned');
}));
test('分享分页、子目录、长文件 ID、字幕过滤与数字集数排序', async () => environment(async directory => {
    const accounts = await new NetdiskAccountStore(directory).init(); await accounts.save115(cookie, 'web');
    const offsets = [];
    const pan = new Pan115({accounts, pageSize: 2, request: async options => {
        assert.equal(options.headers.Cookie, cookie);
        const {cid, offset} = options.params; offsets.push([cid, offset]);
        if (cid === '' && offset === 0) return response({count: 3, list: [{fc: '1', fid: '9007199254740993', n: '第10集.mp4', s: '123'}, {fc: '0', cid: 'folder', n: '正片'}]});
        if (cid === '' && offset === 2) return response({count: 3, list: [{fc: '1', fid: 'subtitle', n: '字幕.srt'}]});
        return response({count: 2, list: [{fc: '1', fid: 'second', n: '第2集.mkv'}, {fc: '1', fid: 'first', n: '第1集.mp4'}]});
    }});
    const files = await pan.listShare('https://115.com/s/abc?password=abcd');
    assert.deepEqual(files.map(f => f.name), ['第1集.mp4', '第2集.mkv', '第10集.mp4']);
    assert.equal(files[2].fileId, '9007199254740993');
    assert.equal(files[0].path, '正片/第1集.mp4');
    assert.ok(offsets.some(([cid, offset]) => cid === '' && offset === 2));
}));
test('分享遍历有边界且分页空转明确失败', async () => environment(async directory => {
    const accounts = await new NetdiskAccountStore(directory).init(); await accounts.save115(cookie, 'web');
    const pan = new Pan115({accounts, maxFiles: 1, request: async () => response({count: 2, list: [{fc: '1', fid: '1', n: '1.mp4'}, {fc: '1', fid: '2', n: '2.mp4'}]})});
    await assert.rejects(pan.listShare('https://115.com/s/abc'), /上限/);
    const empty = new Pan115({accounts, request: async () => response({count: 2, list: []})});
    await assert.rejects(empty.listShare('https://115.com/s/abc'), /分页|没有视频/);
}));
test('取播放地址只请求固定平台接口，媒体头不包含账号 Cookie', async () => environment(async directory => {
    const accounts = await new NetdiskAccountStore(directory).init(); await accounts.save115(cookie, 'web');
    let sent;
    const pan = new Pan115({accounts, request: async options => { sent = options; return response({url: {url: 'https://cdn.example.test/video.mp4'}}); }});
    const play = await pan.resolveFile({shareCode: 'abc', receiveCode: 'AB12', fileId: '123'});
    assert.equal(new URL(sent.url).hostname, '115cdn.com');
    assert.equal(sent.params.file_id, '123');
    assert.equal(sent.headers.Cookie, cookie);
    assert.equal(sent.headers.Referer, 'https://115cdn.com/s/abc?password=AB12&');
    assert.equal(play.headers.Cookie, undefined);
    assert.equal(play.headers['User-Agent'], sent.headers['User-Agent']);
    assert.equal(JSON.stringify(play).includes('fixture-secret'), false);
}));
test('真实 50029 旧接口拒绝时改用加密 App 分享接口，其他失败不兜底', async () => environment(async directory => {
    const accounts = await new NetdiskAccountStore(directory).init(); await accounts.save115(cookie, 'alipaymini');
    const requests = []; let encryptedInput;
    const pan = new Pan115({accounts, cipher: {
        encode: input => { encryptedInput = JSON.parse(input); return {data: 'fixture+cipher/==', key: Buffer.alloc(16)}; },
        decode: data => { assert.equal(data, 'encoded-response'); return '{"url":{"url":"https://cdn.example.test/file.mkv"}}'; },
    }, request: async options => {
        requests.push(options);
        if (options.url.includes('/webapi/')) return {status: 200, data: '{"state":false,"errno":50029,"error":"当前版本过低，请升级到最新版本下载。"}'};
        assert.equal(options.url, 'https://proapi.115.com/app/share/downurl');
        assert.equal(options.method, 'POST');
        assert.equal(new URLSearchParams(options.data).get('data'), 'fixture+cipher/==');
        assert.equal(options.headers.Cookie, cookie);
        return response('encoded-response');
    }});
    const file = {shareCode: 'abc', receiveCode: 'AB12', fileId: '9007199254740993'};
    const play = await pan.resolveFile(file);
    assert.deepEqual(encryptedInput, {share_code: 'abc', receive_code: 'AB12', file_id: '9007199254740993'});
    assert.equal(play.url, 'https://cdn.example.test/file.mkv'); assert.equal(play.headers.Cookie, undefined);
    await pan.resolveFile(file); assert.equal(requests.length, 3, '已确认 App 可用后不重复请求旧接口');
    let count = 0;
    const denied = new Pan115({accounts, request: async () => { count++; return {status: 200, data: '{"state":false,"errno":99}'}; }});
    await assert.rejects(denied.resolveFile(file)); assert.equal(count, 1);
}));
test('未登录、平台失败和非法媒体地址不会误报播放成功或泄露上游响应', async () => environment(async directory => {
    const accounts = await new NetdiskAccountStore(directory).init();
    const pan = new Pan115({accounts, request: async () => ({status: 200, data: '{"state":false,"errno":99,"msg":"fixture-secret upstream-body"}'})});
    await assert.rejects(pan.listShare('https://115.com/s/abc'), /登录/);
    await accounts.save115(cookie, 'web');
    await assert.rejects(pan.listShare('https://115.com/s/abc'), error => !error.message.includes('fixture-secret'));
    const bad = new Pan115({accounts, request: async () => response({url: {url: 'file:///etc/passwd'}})});
    await assert.rejects(bad.resolveFile({shareCode: 'abc', receiveCode: '', fileId: '123'}));
}));
