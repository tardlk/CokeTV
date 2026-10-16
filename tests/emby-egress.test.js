import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApp} from '../src/server.js';
import {installPublicUpstream} from './fixtures/public-upstream.js';

// 反证（任务书 §19）：Emby 媒体会话保留 `egress:'trusted'` 的前提是
// **普通订阅用户无法通过任何请求参数把最终 media URL 换成任意地址**。
// 调用链：client itemId → 服务端 findItem() → 目录中已存在的 item/version →
//         catalog.play() → 源的 detail 输出里按 name/identity 匹配出的 episode.play。
// 客户端只能「选」目录里已有的条目，不能「给」一个 URL。下面用注入尝试证明这一点。

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-emby-egress-'));
    let app = await createApp({directory, seed: false});
    t.after(async () => {
        // fetch 的 keep-alive 连接会让 app.close() 一直等待，先强制断开。
        app.server?.closeAllConnections?.();
        await app.close(); await fs.rm(directory, {recursive: true, force: true});
    });
    const password = 'admin-emby-egress';
    await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password, confirmPassword: password}});
    const headers = {authorization: 'Basic ' + Buffer.from(':' + password).toString('base64')};
    const admin = async (url, payload, method = payload === undefined ? 'GET' : 'POST') => {
        const response = await app.inject({url: '/admin/emby' + url, method, headers, ...(payload === undefined ? {} : {payload})});
        assert.equal(response.statusCode, 200, response.body); return response.json();
    };

    // 公网映射上游：源的 detail/play 只会返回这里的地址。
    const received = [];
    const upstream = http.createServer((req, res) => {
        received.push(req.url);
        res.setHeader('Content-Type', 'video/mp4'); res.end('source-media');
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    t.after(() => { upstream.closeAllConnections?.(); new Promise(resolve => upstream.close(resolve)); });
    const routing = installPublicUpstream(upstream.address().port);
    t.after(() => routing.restore());
    const mediaUrl = `${routing.url}/one.mp4`;

    // LAN fixture：任何注入尝试若真的影响了最终 URL，这里就会收到连接。
    const lanHits = [];
    const lan = http.createServer((req, res) => { lanHits.push(req.url); res.end('LAN-SECRET'); });
    await new Promise(resolve => lan.listen(0, '127.0.0.1', resolve));
    t.after(() => { lan.closeAllConnections?.(); new Promise(resolve => lan.close(resolve)); });
    const lanUrl = `http://127.0.0.1:${lan.address().port}/secret`;

    const script = await app.store.saveScript('js', 'emby-egress.js', 'var rule={};');
    const source = app.store.state.instances.find(item => item.scriptId === script.id);
    app.store.state.subscriptions.push({id: 'viewer-sub', name: '观看范围', token: 'subscription-secret', enabled: true, instances: [source.id]});
    await app.store.persist();
    const run = async (_source, q) => q.play ? {url: mediaUrl, parse: 0}
        : q.ac === 'detail' ? {list: [{vod_id: q.ids, vod_name: '剧集 ' + q.ids, vod_pic: '', vod_content: '',
            vod_play_from: '高清$$$超清',
            vod_play_url: `第1集$${mediaUrl}#第2集$${mediaUrl}$$$第1集$${mediaUrl}#第2集$${mediaUrl}`}]}
            : {class: [{type_id: 'tv', type_name: '剧集'}], list: [{vod_id: 'one', vod_name: '剧集 one'}]};
    app.runner.run = run;
    return {app, admin, source, mediaUrl, lanUrl, received, lanHits, get headers() { return headers; }};
}
async function provision(f) {
    const library = await f.admin('/libraries', {name: '电视剧', sourceId: f.source.id, kind: 'Series', category: 'tv', pages: 1, maxItems: 10});
    const job = await f.admin(`/libraries/${library.id}/sync`, {});
    for (let attempt = 0; attempt < 400; attempt += 1) {
        const status = await f.admin('/jobs/' + job.id);
        if (status.status === 'complete') break;
        assert.notEqual(status.status, 'failed', JSON.stringify(status));
        await new Promise(resolve => setTimeout(resolve, 10));
        if (attempt === 399) assert.fail('同步没有结束');
    }
    const login = await f.app.inject({method: 'POST', url: '/emby/Users/AuthenticateByName',
        headers: {'x-emby-authorization': 'MediaBrowser Client="Infuse", DeviceId="fixture", Device="iPhone", Version="1.0"'},
        payload: {Username: 'coke', Pw: 'subscription-secret'}});
    assert.equal(login.statusCode, 200, login.body);
    const user = {id: login.json().User.Id}, emby = {'x-emby-token': login.json().AccessToken};
    await f.app.listen({host: '127.0.0.1', port: 0});
    const base = `http://127.0.0.1:${f.app.server.address().port}`;
    f.app.store.state.settings.publicUrl = base;
    const episodes = await f.app.inject({url: '/Items?IncludeItemTypes=Episode&Recursive=true', headers: emby});
    assert.equal(episodes.statusCode, 200, episodes.body);
    const item = episodes.json().Items[0];
    assert.ok(item, '目录应已同步出分集');
    const info = await f.app.inject({method: 'POST', url: `/Items/${item.Id}/PlaybackInfo`, headers: emby, payload: {}});
    assert.equal(info.statusCode, 200, info.body);
    return {user, emby, item, base, mediaSources: info.json().MediaSources, direct: info.json().MediaSources[0].DirectStreamUrl};
}

test('Emby 反证：订阅用户无法用请求参数把最终 media URL 换成任意地址', async t => {
    const f = await fixture(t), p = await provision(f);
    assert.ok(p.mediaSources.length >= 1, '目录里应有播放版本');
    const valid = p.mediaSources[0].Id;
    // 逐条注入尝试：全部以订阅用户身份发起，覆盖 query 参数与伪造的 MediaSourceId。
    const attempts = [
        ['干净请求', `/emby/Videos/${p.item.Id}/stream.mp4`],
        ['合法版本', `/emby/Videos/${p.item.Id}/stream.mp4?MediaSourceId=${valid}`],
        ['url 参数注入', `/emby/Videos/${p.item.Id}/stream.mp4?url=${encodeURIComponent(f.lanUrl)}`],
        ['play 参数注入', `/emby/Videos/${p.item.Id}/stream.mp4?play=${encodeURIComponent(f.lanUrl)}`],
        ['target 参数注入', `/emby/Videos/${p.item.Id}/stream.mp4?target=${encodeURIComponent(f.lanUrl)}`],
        ['MediaSourceId 伪造为 LAN URL', `/emby/Videos/${p.item.Id}/stream.mp4?MediaSourceId=${encodeURIComponent(f.lanUrl)}`],
        ['合法版本 + url 注入', `/emby/Videos/${p.item.Id}/stream.mp4?MediaSourceId=${valid}&url=${encodeURIComponent(f.lanUrl)}`],
        ['合法版本 + play 注入', `/emby/Videos/${p.item.Id}/stream.mp4?MediaSourceId=${valid}&play=${encodeURIComponent(f.lanUrl)}`],
    ];
    for (const [name, url] of attempts) {
        const response = await f.app.inject({url, headers: p.emby});
        assert.ok([302, 404, 409].includes(response.statusCode), `${name} => ${response.statusCode} ${response.body}`);
        if (response.statusCode !== 302) continue;
        // 只能 302 到服务端自己铸造的媒体会话，且取回来的是源返回的内容。
        const location = new URL(response.headers.location, 'http://fixture.invalid');
        assert.match(location.pathname, /^\/emby\/Media\/[^/]+\/stream\./, `${name} 的去向不是服务端媒体会话：${location.pathname}`);
        const media = await f.app.inject({url: location.pathname + location.search, headers: p.emby});
        const body = media.body;
        assert.equal(media.statusCode, 200, `${name} 媒体会话不可用：${body}`);
        assert.equal(body, 'source-media', `${name} 取回的不是源返回的媒体`);
    }
    // 关键断言：LAN fixture 从未收到任何连接；公网上游只被源的逻辑访问过。
    assert.deepEqual(f.lanHits, [], '注入尝试不得让服务端连接内网目标');
    assert.ok(f.received.every(url => url.startsWith('/one.mp4')), `上游只应收到源返回的地址：${JSON.stringify(f.received)}`);
});

test('Emby 反证：伪造/不存在的 MediaSourceId 不会落到任意 URL', async t => {
    const f = await fixture(t), p = await provision(f);
    for (const bogus of ['not-a-version', '../../etc/passwd', encodeURIComponent(f.lanUrl)]) {
        const response = await f.app.inject({url: `/emby/Videos/${p.item.Id}/stream.mp4?MediaSourceId=${bogus}`, headers: p.emby});
        assert.ok([404, 409].includes(response.statusCode), `${bogus} => ${response.statusCode} ${response.body}`);
    }
    assert.deepEqual(f.lanHits, [], '伪造版本不得让服务端连接内网目标');
});
