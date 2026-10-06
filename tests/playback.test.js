import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createApp} from '../src/server.js';
import {createPlaybackSessions} from '../src/playback.js';

let app, directory, upstream, upstreamUrl, source, other, authorization;
const received = [];
before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-watch-'));
    upstream = http.createServer((req, res) => {
        received.push({url: req.url, headers: req.headers});
        if (req.url.startsWith('/parse?')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({url: `${upstreamUrl}/video.mp4`, header: {Referer: 'https://fixture.invalid/'}})); return; }
        if (req.headers.referer !== 'https://fixture.invalid/') { res.writeHead(403); res.end('missing referer'); return; }
        if (req.url === '/playlist.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:1,\nsegment.ts\n'); return; }
        if (req.url === '/key.bin') { res.end(Buffer.alloc(16, 1)); return; }
        if (req.headers.range) { res.writeHead(206, {'Content-Range': 'bytes 2-5/10', 'Content-Type': 'video/mp4'}); res.end('2345'); return; }
        res.setHeader('Content-Type', 'video/mp4'); res.end('0123456789');
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
    app = await createApp({directory, seed: false});
    const setupCode = (await fs.readFile(path.join(directory, 'setup-code.txt'), 'utf8')).trim();
    await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'watch-password', confirmPassword: 'watch-password', setupCode}});
    authorization = `Basic ${Buffer.from(':watch-password').toString('base64')}`;
    const code = `var rule = {title:'网页样本',host:'https://fixture.invalid',class_parse:async()=>({class:[{type_id:'movie',type_name:'电影'}]}),推荐:async()=>setResult([{title:'样本',url:'one'}]),二级:async function(){return {vod_name:'样本',vod_play_from:'线路一$$$线路二',vod_play_url:'第一集$${upstreamUrl}/video.mp4#第二集$${upstreamUrl}/playlist.m3u8$$$备用$${upstreamUrl}/video.mp4'}},play_parse:true,lazy:async function(flag,id){return {parse:id==='vip'?1:0,url:id==='vip'?'https://fixture.invalid/vip':id,header:{Referer:'https://fixture.invalid/'}}},proxy_rule:async()=>[200,'text/plain','own-proxy']};`;
    source = (await app.store.saveScript('js', '网页样本.js', code)).id;
    other = (await app.store.saveScript('js', '其他样本.js', code)).id;
    await app.listen({host: '127.0.0.1', port: 0});
});
after(async () => { await app?.close(); await new Promise(resolve => upstream?.close(resolve)); await fs.rm(directory, {recursive: true, force: true}); });
async function play(value, extra = {}) {
    const response = await app.inject({url: `/watch/sources/${source}/play`, method: 'POST', payload: {play: value, flag: '线路一', ...extra}});
    assert.equal(response.statusCode, 200, response.body); return response.json();
}
test('匿名观影、刷新路由和只读源执行，不改管理状态；管理接口仍鉴权', async () => {
    const before = JSON.stringify(app.store.state);
    assert.equal((await app.inject(`/admin/watch/${source}`)).statusCode, 401);
    for (const route of ['/', '/admin', '/watch', '/watch/play', '/watch/history']) assert.equal((await app.inject(route)).statusCode, 200);
    const response = await app.inject({url: `/watch/sources/${source}?ac=detail&ids=one`});
    assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().list[0].vod_name, '样本');
    assert.equal(JSON.stringify(app.store.state), before);
});
test('公开选源列表不暴露参数、ENV、脚本或订阅凭据，停用源不能浏览或播放', async () => {
    const entry = app.store.state.instances.find(item => item.id === other);
    const previous = {...entry};
    try {
        entry.params = 'private-source-params'; entry.enabled = false;
        const response = await app.inject('/watch/sources');
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), [{id: source, name: '网页样本', enabled: true, searchable: true, filterable: false, script: {engine: 'js'}}]);
        assert.equal((await app.inject(`/watch/sources/${other}`)).statusCode, 403);
        assert.equal((await app.inject({method: 'POST', url: `/watch/sources/${other}/play`, payload: {play: `${upstreamUrl}/video.mp4`}})).statusCode, 403);
        for (const url of ['/admin/state', `/admin/scripts/${source}`, `/admin/instances/${source}/environment`, '/admin/export', '/admin/logs']) assert.equal((await app.inject(url)).statusCode, 401);
        assert.equal((await app.inject({method: 'PUT', url: '/admin/settings', payload: {}})).statusCode, 401);
        assert.equal((await app.inject(`/api/${source}`)).statusCode, 403);
        assert.equal((await app.inject('/config')).statusCode, 403);
    } finally { Object.assign(entry, previous); }
});
test('全新部署未创建管理密码也能匿名浏览源，首次设置仅在管理入口', async () => {
    const freshDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-public-first-'));
    let fresh;
    try {
        fresh = await createApp({directory: freshDirectory, seed: false});
        const script = await fresh.store.saveScript('js', '首次观影.js', "var rule={title:'首次观影',host:'https://fixture.invalid',class_parse:async()=>({class:[]}),推荐:async()=>setResult([{title:'免费浏览',url:'one'}])};");
        assert.equal((await fresh.inject('/watch/sources')).statusCode, 200);
        const home = await fresh.inject(`/watch/sources/${script.id}`);
        assert.equal(home.statusCode, 200, home.body); assert.equal(home.json().list[0].vod_name, '免费浏览');
        assert.equal((await fresh.inject('/admin/state')).statusCode, 428);
        // C1：未设密码时，百分号编码前缀也必须走到同一个守卫（428），而不是泄漏内容。
        assert.equal((await fresh.inject('/%61dmin/state')).statusCode, 428);
        assert.equal((await fresh.inject('/access/status')).json().requiresSetup, true);
        assert.equal(JSON.parse(await fs.readFile(path.join(freshDirectory, 'admin.json'))).password, undefined);
    } finally { await fresh?.close(); await fs.rm(freshDirectory, {recursive: true, force: true}); }
});
test('网页媒体短期凭证保留请求头和 Range，不携带访问密码', async () => {
    const result = await play(`${upstreamUrl}/video.mp4`);
    assert.ok(!JSON.stringify(result).includes('watch-password'));
    const media = await app.inject({url: result.url, headers: {range: 'bytes=2-5'}});
    assert.equal(media.statusCode, 206); assert.equal(media.body, '2345');
    assert.equal(media.headers['content-range'], 'bytes 2-5/10');
    assert.equal(received.at(-1).headers.authorization, undefined);
    assert.equal((await app.inject({url: result.url, method: 'HEAD'})).headers['content-type'], 'video/mp4');
    assert.equal((await app.inject('/watch/media/invalid')).statusCode, 403);
});
test('HLS 的分片和密钥继承媒体凭证与源请求头', async () => {
    const result = await play(`${upstreamUrl}/playlist.m3u8`);
    assert.equal(result.type, 'm3u8');
    const media = await app.inject(result.url);
    assert.equal(media.statusCode, 200, media.body);
    const urls = [media.body.match(/URI="([^"]+)"/)[1], media.body.split('\n').find(line => line.startsWith('http'))];
    for (const url of urls) {
        assert.ok(new URL(url).searchParams.get('token'));
        const response = await app.inject(new URL(url).pathname + new URL(url).search);
        assert.equal(response.statusCode, 200, response.body);
    }
});
test('媒体凭证只访问所属源代理，不能用于管理、API 或其他源', async () => {
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const result = await play(`${base}/proxy/${encodeURIComponent('网页样本')}/`);
    const ticket = result.url.split('/').at(-1);
    assert.equal((await app.inject(result.url)).body, 'own-proxy');
    assert.equal((await app.inject(`/proxy/${other}/?token=${ticket}`)).statusCode, 403);
    assert.equal((await app.inject(`/api/${source}?token=${ticket}`)).statusCode, 403);
    assert.equal((await app.inject(`/admin/state?token=${ticket}`)).statusCode, 401);
    assert.equal((await app.inject(`/config?token=${ticket}`)).statusCode, 403);
});
test('解析必需状态、JSON 解析与非法播放地址处理', async () => {
    assert.equal((await play('vip')).needsParse, true);
    app.store.state.settings.parses = [{name: '测试解析', type: 1, url: `${upstreamUrl}/parse?url=`}];
    const result = await play('vip');
    assert.equal((await app.inject(result.url)).statusCode, 200);
    app.store.state.settings.parses = [{name: '网页解析', type: 0, url: 'https://parse.invalid/?url='}];
    assert.equal((await play('vip', {parser: 0})).iframe, 'https://parse.invalid/?url=https%3A%2F%2Ffixture.invalid%2Fvip');
    const invalid = await app.inject({url: `/admin/watch/${source}/play`, method: 'POST', headers: {authorization}, payload: {play: 'javascript:alert(1)'}});
    assert.equal(invalid.statusCode, 400);
});
test('媒体凭证过期后失效，且同源代理权限不会扩展到 API', () => {
    let now = 0;
    const sessions = createPlaybackSessions({now: () => now, ttl: 100});
    const ticket = sessions.create('source', 'https://fixture.invalid/video.mp4', {});
    assert.ok(sessions.get(ticket)); now = 101; assert.equal(sessions.get(ticket), undefined);
});
