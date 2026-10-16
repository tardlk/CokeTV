import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApp} from '../src/server.js';
import {createPlaybackSessions, childEgress, egressOf, createChildMint} from '../src/playback.js';
import {installPublicUpstream} from './fixtures/public-upstream.js';

// 第二轮热修：subscription 调用链不得被升级成 trusted。
// 覆盖 S1–S6（任务书 §12）与 capability 层三态继承（§13）。
//
// fixture 布局：
//   「公网」upstream（经 public-upstream 映射）：正常媒体 + 清单里夹带私网子资源的样本
//   「内网」upstream（真实 127.0.0.1）：NAS/LAN 上的服务，订阅链不得访问

const LAN_SEGMENT = 'http://192.168.1.10/seg.ts';
const LAN_KEY = 'http://192.168.1.11/key.bin';
const LAN_MAP = 'http://192.168.1.12/init.mp4';
const PASSWORD = 'subscription-egress-password';
const TOKEN = 'subscription-egress-token';

let app, directory, upstream, lanUpstream, routing, publicBase, lanBase, source, subscription, root, authorization, runtimeKey;
const lanHits = [], publicHits = [];

before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-sub-egress-'));
    // ---- 「公网」fixture ----
    upstream = http.createServer((req, res) => {
        publicHits.push(req.url);
        const send = (type, body) => { res.setHeader('Content-Type', type); res.end(body); };
        if (req.url.startsWith('/root-mixed')) return send('application/vnd.apple.mpegurl',
            `#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="${LAN_KEY}"\n#EXT-X-MAP:URI="${LAN_MAP}"\n#EXTINF:1,\n${LAN_SEGMENT}\n`);
        if (req.headers.range) { res.writeHead(206, {'Content-Type': 'video/mp4', 'Content-Range': 'bytes 2-5/10'}); return res.end('2345'); }
        return send('video/mp4', 'public-media-bytes');
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    routing = installPublicUpstream(upstream.address().port);
    publicBase = routing.url;

    // ---- 「内网」fixture ----
    lanUpstream = http.createServer((req, res) => { lanHits.push(req.url); res.end('LAN-SECRET'); });
    await new Promise(resolve => lanUpstream.listen(0, '127.0.0.1', resolve));
    lanBase = `http://127.0.0.1:${lanUpstream.address().port}`;

    app = await createApp({directory, seed: false});
    await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: PASSWORD, confirmPassword: PASSWORD}});
    authorization = `Basic ${Buffer.from(`:${PASSWORD}`).toString('base64')}`;
    runtimeKey = app.runner.internalKey;
    // §12 要求使用与仓库现有 fixture 同型的「回显源」，并带一个回显 target 的 proxy_rule。
    const echo = `var rule={title:'订阅回显源',host:'https://fixture.invalid',
class_parse:async()=>({class:[{type_id:'m',type_name:'电影'}]}),
推荐:async()=>setResult([{title:'样本',url:'one'}]),
二级:async()=>({vod_name:'样本',vod_play_from:'线路一',vod_play_url:'第1集$one'}),
play_parse:true,
lazy:async (a, b) => ({parse: 0, url: b}),
proxy_rule:async function(params){return [200,'video/mp4',params.target||'',{},3]}};`;
    source = (await app.store.saveScript('js', '订阅回显源.js', echo)).id;
    subscription = {id: 'sub-egress', name: '订阅出口', token: TOKEN, enabled: true, instances: [source]};
    app.store.state.subscriptions.push(subscription);
    await app.store.persist();
    await app.listen({host: '127.0.0.1', port: 0});
    root = `http://127.0.0.1:${app.server.address().port}/cat/${subscription.id}/${TOKEN}`;
});
after(async () => {
    await app?.close(); routing?.restore();
    upstream?.closeAllConnections?.(); lanUpstream?.closeAllConnections?.();
    await new Promise(resolve => upstream?.close(resolve));
    await new Promise(resolve => lanUpstream?.close(resolve));
    await fs.rm(directory, {recursive: true, force: true});
});

const catPlay = async value => {
    const response = await app.inject({method: 'POST', url: `${root}/api/${source}/play`, payload: {id: value, flag: '线路一'}});
    assert.equal(response.statusCode, 200, response.body);
    return response.json().url;
};
const mediaPath = url => { const parsed = new URL(url); return parsed.pathname + parsed.search; };
const proxy = (target, headers = {}) => app.inject({url: `/proxy/${source}/?target=${encodeURIComponent(target)}&token=${TOKEN}`, headers});

// ---- S1 / S2：Cat 订阅播放 ----
test('S1 Cat 订阅回显私网 URL：play 可用但媒体请求 403（allowPrivateTargets=true 也 403）', async () => {
    const before = lanHits.length;
    const media = await catPlay(`${lanBase}/secret`);
    const response = await app.inject(mediaPath(media));
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().error, '内网地址已在设置中禁止访问');
    assert.equal(lanHits.length, before, '订阅链不得让服务端连接内网目标');
});
test('S2 Cat 订阅公网目标正常：媒体 200（证明不是把 Cat 播放整个关掉）', async () => {
    const media = await catPlay(`${publicBase}/video.mp4`);
    const response = await app.inject(mediaPath(media));
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.body, 'public-media-bytes');
});

// ---- S3：Cat HLS 权限继承 ----
test('S3 Cat HLS：master 200，但私网 segment/KEY/MAP 各自 403 且派生能力为 subscription', async () => {
    const master = await app.inject(mediaPath(await catPlay(`${publicBase}/root-mixed.m3u8`)));
    assert.equal(master.statusCode, 200, master.body);
    assert.match(master.body, /^#EXTM3U/);
    const uris = [...master.body.matchAll(/(?:URI="|\n)(http[^"\n]+)/g)].map(match => match[1]);
    assert.equal(uris.length, 3, master.body);
    const before = lanHits.length;
    for (const uri of uris) {
        const parsed = new URL(uri);
        // 猫影视路径下子资源经 wrapUrl 铸造各自的媒体会话（票据在路径里，不在 query）。
        assert.match(parsed.pathname, /^\/cat\/[^/]+\/[^/]+\/media\/[^/]+\/[^/]+\/stream\./, `${uri} 不是服务端铸造的媒体会话`);
        const response = await app.inject(parsed.pathname + parsed.search);
        assert.equal(response.statusCode, 403, `${uri} => ${response.statusCode}`);
        assert.equal(response.json().error, '内网地址已在设置中禁止访问');
    }
    assert.equal(lanHits.length, before, '私网子资源不得被连接');
});

// ---- S4 / S5：源代理 + 订阅 ----
test('S4 source proxy + 订阅 + 私网 target：403 且 LAN fixture 未收到连接', async () => {
    const before = lanHits.length;
    const response = await proxy(`${lanBase}/secret`);
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().error, '内网地址已在设置中禁止访问');
    assert.equal(lanHits.length, before, '订阅链不得让服务端连接内网目标');
});
test('S5 source proxy + 订阅 + 公网 target：200（功能仍可用）', async () => {
    const response = await proxy(`${publicBase}/video.mp4`);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.body, 'public-media-bytes');
});

// ---- S6：源代理 + trusted ----
test('S6 source proxy + 管理员/内部运行时 + LAN target：保持 200（合法 LAN 能力未一刀切）', async () => {
    await app.store.mutate(state => { state.settings.allowPrivateTargets = true; });
    try {
        const admin = await app.inject({url: `/proxy/${source}/?target=${encodeURIComponent(`${lanBase}/secret`)}`, headers: {authorization}});
        assert.equal(admin.statusCode, 200, admin.body);
        assert.equal(admin.body, 'LAN-SECRET');
        const runtime = await app.inject({url: `/proxy/${source}/?target=${encodeURIComponent(`${lanBase}/secret`)}`, headers: {'x-drpy-runtime': runtimeKey}});
        assert.equal(runtime.statusCode, 200, runtime.body);
        assert.equal(runtime.body, 'LAN-SECRET');
    } finally {
        await app.store.mutate(state => { state.settings.allowPrivateTargets = true; });
    }
});

// ---- S7：订阅经 /mediaProxy 的 HLS 派生（非猫影视路径）----
test('S7 订阅 /mediaProxy：HLS master 200，私网子资源各自 403', async () => {
    const before = lanHits.length;
    const master = await app.inject(`/mediaProxy?url=${encodeURIComponent(`${publicBase}/root-mixed.m3u8`)}&token=${TOKEN}`);
    assert.equal(master.statusCode, 200, master.body);
    assert.match(master.body, /^#EXTM3U/);
    const uris = [...master.body.matchAll(/(?:URI="|\n)(http[^"\n]+)/g)].map(match => match[1]);
    assert.equal(uris.length, 3, master.body);
    for (const uri of uris) {
        const parsed = new URL(uri);
        assert.ok(parsed.searchParams.get('token'), `${uri} 应带独立票据`);
        const response = await app.inject(parsed.pathname + parsed.search);
        assert.equal(response.statusCode, 403, `${uri} => ${response.statusCode}`);
        assert.equal(response.json().error, '内网地址已在设置中禁止访问');
    }
    assert.equal(lanHits.length, before, '私网子资源不得被连接');
});

// ---- §13：capability 层三态继承 ----
test('C4 单元：三态 egress 派生只继承不提升，非法取值一律 public', () => {
    // egressOf 白名单
    assert.equal(egressOf('trusted'), 'trusted');
    assert.equal(egressOf('subscription'), 'subscription');
    assert.equal(egressOf('public'), 'public');
    for (const value of [undefined, null, '', 'anything-else', 'TRUSTED', 'trusted ', 0, {}, []]) {
        assert.equal(egressOf(value), 'public', `${JSON.stringify(value)} 必须落到 public`);
    }
    // childEgress
    assert.equal(childEgress({egress: 'public'}), 'public');
    assert.equal(childEgress({egress: 'subscription'}), 'subscription');
    assert.equal(childEgress({egress: 'trusted'}), 'trusted');
    for (const value of [undefined, null, {}, {egress: 'other'}]) {
        assert.equal(childEgress(value), 'public', `${JSON.stringify(value)} 必须落到 public`);
    }

    const sessions = createPlaybackSessions();
    const paths = {子清单: 'https://cdn.fixture.invalid/mid.m3u8', 分片: 'https://cdn.fixture.invalid/seg.ts',
        KEY: 'https://cdn.fixture.invalid/key.bin', MAP: 'https://cdn.fixture.invalid/init.mp4', 源代理: 'https://cdn.fixture.invalid/target'};
    // 三种父权限 → 三种子权限，逐一覆盖五类派生路径
    for (const [label, parent] of [['public', {kind: 'media', source: 's1', egress: 'public'}],
        ['subscription', {kind: 'media', source: 's1', egress: 'subscription'}],
        ['trusted', {kind: 'media', source: 's1', egress: 'trusted'}]]) {
        for (const [name, url] of Object.entries(paths)) {
            const token = createChildMint(sessions, {Referer: 'fixture'}, parent)(url);
            const child = sessions.get(token);
            assert.equal(child.egress, label, `${label} 父票据派生的${name}不得改变出口权限`);
            assert.equal(child.kind, 'proxy');
            assert.equal(child.source, 's1', `${name} 应继承 source 范围`);
        }
    }
    // 存储层兜底：未标注/非法标注都落到 public，且取用方改写副本也升不了级。
    for (const metadata of [undefined, {egress: 'trusted-by-admin'}, {egress: null}]) {
        const token = sessions.create('s1', 'https://cdn.fixture.invalid/a', {}, metadata);
        assert.equal(sessions.get(token).egress, 'public');
        const copy = sessions.get(token); copy.egress = 'trusted';
        assert.equal(sessions.get(token).egress, 'public');
    }
});
