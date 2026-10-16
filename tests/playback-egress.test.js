import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createApp} from '../src/server.js';
import {createPlaybackSessions, childEgress, createChildMint} from '../src/playback.js';
import {installPublicUpstream} from './fixtures/public-upstream.js';

// 本轮修复的核心是能力票据的**出口权限（egress）**：
//   public  —— 匿名 /watch 播放流程铸造的票据及其全部派生能力
//   trusted —— 管理员 / 内部源运行时 / 服务端绑定的可信媒体会话
// 覆盖 E1–E19；E20（五引擎媒体行为不回归）由既有 playback/emby/cat 套件承担。
//
// fixture 布局：
//   「公网」upstream  —— 经 installPublicUpstream 映射到本地（模拟站外 CDN）
//   「内网」upstream  —— 真实的 127.0.0.1（模拟 NAS / LAN 上的服务）
// 私网字面地址（192.168.x.x 等）不需要真实可达：它们必须在发起连接前就被拒绝。

const LAN_SEGMENT = 'http://192.168.1.10/seg.ts';
const LAN_KEY = 'http://192.168.1.11/key.bin';
const LAN_MAP = 'http://192.168.1.12/init.mp4';
const PASSWORD = 'egress-password';
const AUTHORIZATION = `Basic ${Buffer.from(`:${PASSWORD}`).toString('base64')}`;

let app, directory, publicUpstream, lanUpstream, routing, publicBase, lanBase, source, adminSource;
const received = [];

const localURL = value => { const url = new URL(value); return url.pathname + url.search; };
const httpURIs = body => [...body.matchAll(/(?:URI="|\n)(http[^"\n]+)/g)].map(match => match[1]);
const mediaTicketOf = body => { const url = JSON.parse(body).url; assert.match(url, /^\/watch\/media\//, body); return url; };

before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-egress-'));
    // ---- 「公网」fixture：正常媒体 + 清单里夹带私网目标的样本 ----
    publicUpstream = http.createServer((req, res) => {
        received.push({url: req.url, headers: req.headers});
        const send = (type, body) => { res.setHeader('Content-Type', type); res.end(body); };
        if (req.url.startsWith('/root-mixed')) return send('application/vnd.apple.mpegurl',
            `#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="${LAN_KEY}"\n#EXT-X-MAP:URI="${LAN_MAP}"\n#EXTINF:1,\n${LAN_SEGMENT}\n`);
        if (req.url.startsWith('/root-child')) return send('application/vnd.apple.mpegurl',
            `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n${publicBase}/mid.m3u8\n`);
        if (req.url.startsWith('/mid')) return send('application/vnd.apple.mpegurl', `#EXTM3U\n#EXTINF:1,\n${LAN_SEGMENT}\n`);
        if (req.url.startsWith('/redirect-private')) { res.writeHead(302, {Location: LAN_SEGMENT}); return res.end(); }
        if (req.headers.range) { res.writeHead(206, {'Content-Type': 'video/mp4', 'Content-Range': 'bytes 2-5/10'}); return res.end('2345'); }
        return send('video/mp4', 'public-media-bytes');
    });
    await new Promise(resolve => publicUpstream.listen(0, '127.0.0.1', resolve));
    routing = installPublicUpstream(publicUpstream.address().port);
    publicBase = routing.url;

    // ---- 「内网」fixture：真实回环，只有可信出口才应访问到 ----
    lanUpstream = http.createServer((req, res) => {
        if (req.url.startsWith('/root.m3u8')) { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); return res.end('#EXTM3U\n#EXTINF:1,\nseg.ts\n'); }
        res.setHeader('Content-Type', 'video/mp4'); res.end('LAN-SECRET');
    });
    await new Promise(resolve => lanUpstream.listen(0, '127.0.0.1', resolve));
    lanBase = `http://127.0.0.1:${lanUpstream.address().port}`;

    app = await createApp({directory, seed: false});
    await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: PASSWORD, confirmPassword: PASSWORD}});
    // §8 要求：必须使用与仓库现有 fixture 同型的「回显源」，证明针对的是真实兼容模式。
    const echo = `var rule={title:'回显源',host:'https://fixture.invalid',class_parse:async()=>({class:[]}),推荐:async()=>setResult([]),二级:async()=>({vod_name:'样本',vod_play_from:'线路一',vod_play_url:'第1集$one'}),play_parse:true,lazy:async (a, b) => ({parse: 0, url: b}),proxy_rule:async function(params){return [200,'video/mp4',params.target||'LAN-SECRET',{},3]}};`;
    source = (await app.store.saveScript('js', '回显源.js', echo)).id;
    adminSource = source;
    await app.listen({host: '127.0.0.1', port: 0});
});
after(async () => {
    await app?.close(); routing?.restore();
    await new Promise(resolve => publicUpstream?.close(resolve));
    await new Promise(resolve => lanUpstream?.close(resolve));
    await fs.rm(directory, {recursive: true, force: true});
});

// 匿名播放：只给 play 值，不带任何凭据。
const anonPlay = async (value, extra = {}) => {
    const response = await app.inject({method: 'POST', url: `/watch/sources/${source}/play`, payload: {play: value, flag: '线路一', ...extra}});
    assert.equal(response.statusCode, 200, response.body);
    return response.json().url;
};
const adminPlay = async (value, extra = {}) => {
    const response = await app.inject({method: 'POST', url: `/admin/watch/${adminSource}/play`, headers: {authorization: AUTHORIZATION}, payload: {play: value, flag: '线路一', ...extra}});
    assert.equal(response.statusCode, 200, response.body);
    return response.json().url;
};

// ---- E1 / E18 / E19：公开目标与传输语义不回归 ----
test('E1/E19 匿名播放公网地址可用，GET/HEAD/Range 语义保持', async () => {
    const ticket = await anonPlay(`${publicBase}/video.mp4`);
    const media = await app.inject({url: ticket, headers: {range: 'bytes=2-5'}});
    assert.equal(media.statusCode, 206, media.body);
    assert.equal(media.body, '2345');
    assert.equal(media.headers['content-range'], 'bytes 2-5/10');
    assert.equal((await app.inject({url: ticket, method: 'HEAD'})).headers['content-type'], 'video/mp4');
    assert.equal((await app.inject({url: ticket})).body, 'public-media-bytes');
});
test('E18 public capability 访问真实公网 URL 不回归（含 query）', async () => {
    const ticket = await anonPlay(`${publicBase}/video.mp4?signature=${'s'.repeat(200)}`);
    const media = await app.inject({url: ticket});
    assert.equal(media.statusCode, 200, media.body);
    assert.equal(received.at(-1).url, `/video.mp4?signature=${'s'.repeat(200)}`);
});

// ---- E2–E5：匿名输入不能把 public capability 指向私网/回环/链路本地 ----
const privateCases = [
    ['E2 回环', () => `${lanBase}/video.mp4`, '内网地址已在设置中禁止访问'],
    ['E3 RFC1918 192.168/16', () => 'http://192.168.1.10/secret', '内网地址已在设置中禁止访问'],
    ['E4 RFC1918 10/8', () => 'http://10.1.2.3/secret', '内网地址已在设置中禁止访问'],
    ['E5 链路本地 169.254/16', () => 'http://169.254.0.23/secret', '云元数据地址被禁止访问'],
    ['E5 云 metadata', () => 'http://169.254.169.254/latest/meta-data/', '云元数据地址被禁止访问'],
];
for (const [name, target, message] of privateCases) {
    test(`${name}：匿名 play → 最终媒体请求被拒绝`, async () => {
        const ticket = await anonPlay(target());
        const media = await app.inject({url: ticket});
        assert.equal(media.statusCode, 403, media.body);
        assert.equal(media.json().error, message);
    });
}

// ---- E6–E7：任何设置/白名单都不能把公开出口放宽 ----
test('E6 allowPrivateTargets=true 时 E2–E4 依旧 403', async () => {
    await app.store.mutate(state => { state.settings.allowPrivateTargets = true; });
    for (const target of [`${lanBase}/video.mp4`, 'http://192.168.1.10/secret', 'http://10.1.2.3/secret']) {
        const media = await app.inject({url: await anonPlay(target)});
        assert.equal(media.statusCode, 403, `${target} => ${media.statusCode}`);
    }
});
test('E7 targetAllowlist 明确包含私网目标时，匿名公开票据仍 403', async () => {
    await app.store.mutate(state => { state.settings.targetAllowlist = ['127.0.0.1', '192.168.0.0/16', '10.0.0.0/8']; });
    try {
        for (const target of [`${lanBase}/video.mp4`, 'http://192.168.1.10/secret', 'http://10.1.2.3/secret']) {
            const media = await app.inject({url: await anonPlay(target)});
            assert.equal(media.statusCode, 403, `${target} => ${media.statusCode}`);
            assert.equal(media.json().error, '内网地址已在设置中禁止访问');
        }
    } finally {
        await app.store.mutate(state => { state.settings.targetAllowlist = []; });
    }
});

// ---- E8–E9 / E15：可信出口的 LAN 能力不被一刀切禁用 ----
test('E8 管理员可信票据在 allowPrivateTargets=true 时仍可访问 LAN', async () => {
    await app.store.mutate(state => { state.settings.allowPrivateTargets = true; });
    const media = await app.inject({url: await adminPlay(`${lanBase}/video.mp4`)});
    assert.equal(media.statusCode, 200, media.body);
    assert.equal(media.body, 'LAN-SECRET');
});
test('E9 管理员可信票据在 allowPrivateTargets=false 时被拒绝', async () => {
    await app.store.mutate(state => { state.settings.allowPrivateTargets = false; });
    try {
        const media = await app.inject({url: await adminPlay(`${lanBase}/video.mp4`)});
        assert.equal(media.statusCode, 403, media.body);
        assert.equal(media.json().error, '内网地址已在设置中禁止访问');
    } finally {
        await app.store.mutate(state => { state.settings.allowPrivateTargets = true; });
    }
});
test('E15 trusted HLS master → LAN 子资源在允许私网时保持原行为', async () => {
    await app.store.mutate(state => { state.settings.allowPrivateTargets = true; });
    const master = await app.inject({url: await adminPlay(`${lanBase}/root.m3u8`)});
    assert.equal(master.statusCode, 200, master.body);
    assert.match(master.body, /^#EXTM3U/);
    const child = httpURIs(master.body)[0];
    assert.ok(child, master.body);
    const segment = await app.inject(localURL(child));
    assert.equal(segment.statusCode, 200, segment.body);
    assert.equal(segment.body, 'LAN-SECRET');
});

// ---- E10：public 首跳 → 302 到私网 ----
test('E10 public capability 首跳公网、重定向到私网 → 403', async () => {
    const media = await app.inject({url: await anonPlay(`${publicBase}/redirect-private`)});
    assert.equal(media.statusCode, 403, media.body);
    assert.equal(media.json().error, '内网地址已在设置中禁止访问');
});

// ---- E11–E14：HLS 派生能力不得升级 ----
test('E11/E12/E13 public HLS master 中的私网 segment/KEY/MAP 分别 403', async () => {
    const before = received.length;
    const master = await app.inject({url: await anonPlay(`${publicBase}/root-mixed.m3u8`)});
    assert.equal(master.statusCode, 200, master.body);
    const uris = httpURIs(master.body);
    assert.equal(uris.length, 3, master.body);
    // 三个子资源各自都带独立票据，且都必须继承 public。
    for (const uri of uris) {
        const parsed = new URL(uri);
        assert.ok(parsed.searchParams.get('token'), uri);
        const response = await app.inject(localURL(uri));
        assert.equal(response.statusCode, 403, `${uri} => ${response.statusCode}`);
        assert.equal(response.json().error, '内网地址已在设置中禁止访问');
    }
    // 私网目标不会被真的连接：公网 fixture 只应收到 master 自身那一次请求。
    assert.deepEqual(received.slice(before).map(entry => entry.url), ['/root-mixed.m3u8']);
});
test('E14 public master → public 子清单 → 私网分片，最终分片 403', async () => {
    const master = await app.inject({url: await anonPlay(`${publicBase}/root-child.m3u8`)});
    assert.equal(master.statusCode, 200, master.body);
    const childURL = httpURIs(master.body)[0];
    const child = await app.inject(localURL(childURL));
    assert.equal(child.statusCode, 200, child.body);
    const segment = httpURIs(child.body)[0];
    assert.ok(segment, child.body);
    const response = await app.inject(localURL(segment));
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().error, '内网地址已在设置中禁止访问');
});

// ---- E16：公开票据驱动源代理，返回值仍按 public 处理 ----
test('E16 public media ticket 调同源源代理，源返回私网 URL 仍 403', async () => {
    const ticket = await anonPlay(`${publicBase}/video.mp4`);
    const mediaTicket = ticket.split('/').at(-1);
    const proxy = await app.inject(`/proxy/${source}/?target=${encodeURIComponent(LAN_SEGMENT)}&token=${mediaTicket}`);
    assert.equal(proxy.statusCode, 403, proxy.body);
    assert.equal(proxy.json().error, '内网地址已在设置中禁止访问');
    // 对照：同一入口返回公网目标仍正常（证明拒绝来自出口策略，而非路由不可用）。
    const allowed = await app.inject(`/proxy/${source}/?target=${encodeURIComponent(`${publicBase}/video.mp4`)}&token=${mediaTicket}`);
    assert.equal(allowed.statusCode, 200, allowed.body);
});

// ---- E17：票据仍保持精确 URL 绑定 ----
test('E17 派生票据仍精确绑定 URL，换地址即 403', async () => {
    const master = await app.inject({url: await anonPlay(`${publicBase}/root-child.m3u8`)});
    const child = new URL(httpURIs(master.body)[0]);
    const token = child.searchParams.get('token');
    const bound = child.searchParams.get('url');
    assert.equal((await app.inject(localURL(child.href))).statusCode, 200, bound);
    const swapped = new URL(`${child.origin}${child.pathname}`);
    swapped.searchParams.set('url', `${publicBase}/video.mp4`);
    swapped.searchParams.set('token', token);
    assert.equal((await app.inject(localURL(swapped.href))).statusCode, 403, '票据不能被挪用到其他地址');
});

// ---- §9：capability 层单元测试，锁死「派生不提升权限」 ----
test('C3 单元：派生票据的 egress 只能继承、不能提升（含未来新增路径的兜底）', () => {
    assert.equal(childEgress({egress: 'public'}), 'public');
    assert.equal(childEgress({egress: 'trusted'}), 'trusted');
    // 缺省 / 未知取值一律落到最严的一侧，避免新增 mint 点忘记标注时偷偷升级。
    assert.equal(childEgress({}), 'public');
    assert.equal(childEgress({egress: 'anything-else'}), 'public');
    assert.equal(childEgress(null), 'public');

    const sessions = createPlaybackSessions();
    const paths = {
        子清单: 'https://cdn.fixture.invalid/mid.m3u8',
        分片: 'https://cdn.fixture.invalid/seg.ts',
        KEY: 'https://cdn.fixture.invalid/key.bin',
        MAP: 'https://cdn.fixture.invalid/init.mp4',
        源代理: 'https://cdn.fixture.invalid/proxy-target',
    };
    const mint = (parent, label, url) => {
        const token = createChildMint(sessions, {Referer: 'fixture'}, parent)(url);
        const child = sessions.get(token);
        assert.equal(child.egress, childEgress(parent), `${label} 不得提升出口权限`);
        assert.equal(child.kind, 'proxy');
        if (parent.source) assert.equal(child.source, parent.source, `${label} 应继承 source 范围`);
        return child;
    };
    for (const [label, url] of Object.entries(paths)) {
        const child = mint({kind: 'media', source: 's1', egress: 'public'}, label, url);
        assert.equal(child.egress, 'public', `${label} 不得升级为 trusted`);
    }
    for (const [label, url] of Object.entries(paths)) {
        mint({kind: 'media', source: 's1', egress: 'trusted'}, label, url);
    }

    // 存储层同样兜底：未标注或非法取值的票据落到 public，且取用方无法改写它。
    const unlabelled = sessions.create('s1', 'https://cdn.fixture.invalid/a', {});
    assert.equal(sessions.get(unlabelled).egress, 'public');
    const forged = sessions.create('s1', 'https://cdn.fixture.invalid/b', {}, {egress: 'trusted-by-admin'});
    assert.equal(sessions.get(forged).egress, 'public');
    const copy = sessions.get(forged); copy.egress = 'trusted';
    assert.equal(sessions.get(forged).egress, 'public');
});
