import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import {listenApp} from '../src/listen.js';
import {createApp} from '../src/server.js';
import {ruleFixture} from './helpers/drpy3-fixture.js';

test('默认监听同时接受 IPv4/IPv6，真实 IPv6 订阅、取链、HLS 与日志保持地址族', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-dual-stack-'));
    const app = await createApp({directory});
    t.after(async () => { await app.close(); await fs.rm(directory, {recursive: true, force: true}); });
    const script = await app.store.saveScript('dr3', 'dual-stack.js', ruleFixture(`var rule={title:'双栈样本',
        lazy:async function(){return {parse:0,url:getProxyUrl().replace('/?','/main.m3u8?'),type:'m3u8'}},
        proxy_rule:async function(){return this.proxyPath.endsWith('segment.ts') ? [200,'video/mp2t','fixture segment']
            : [200,'application/vnd.apple.mpegurl','#EXTM3U\\n#EXTINF:1,\\nsegment.ts\\n']}
    };`));
    const instance = app.store.state.instances.find(item => item.scriptId === script.id);
    const sub = app.store.state.subscriptions[0]; sub.instances = [instance.id];
    await listenApp(app, {port: 0});
    assert.equal(app.server.address().family, 'IPv6');
    const port = app.server.address().port, v4 = `http://127.0.0.1:${port}`, v6 = `http://[::1]:${port}`;
    for (const origin of [v4, v6]) {
        const health = await fetch(origin + '/health'); assert.equal(health.status, 200);
        const response = await fetch(origin + '/tvbox/' + sub.token); assert.equal(response.status, 200);
        const config = await response.json(); assert.equal(new URL(config.sites[0].api).origin, origin);
        const api = new URL(config.sites[0].api); api.searchParams.set('play', 'episode-one');
        const play = await fetch(api); assert.equal(play.status, 200);
        const media = await play.json(); assert.equal(new URL(media.url).origin, origin);
        const playlist = await fetch(media.url); assert.equal(playlist.status, 200);
        const content = await playlist.text();
        const segment = content.split('\n').find(line => line && !line.startsWith('#'));
        assert.equal(new URL(segment).origin, origin);
        const bytes = await fetch(segment); assert.equal(bytes.status, 200); assert.equal(await bytes.text(), 'fixture segment');
    }
    const webPlay = await fetch(`${v6}/watch/sources/${instance.id}/play`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({play: 'episode-one'})});
    assert.equal(webPlay.status, 200);
    const webMedia = await webPlay.json();
    const webPlaylist = await fetch(new URL(webMedia.url, v6)); assert.equal(webPlaylist.status, 200);
    const webSegment = (await webPlaylist.text()).split('\n').find(line => line && !line.startsWith('#'));
    assert.equal(new URL(webSegment).origin, v6);
    assert.equal(await (await fetch(webSegment)).text(), 'fixture segment');
    const activity = app.runner.logs.filter(entry => entry.category === 'client');
    assert.ok(activity.some(entry => entry.clientIp === '127.0.0.1'));
    assert.ok(activity.some(entry => entry.clientIp === '::1'));
    assert.ok(!activity.some(entry => entry.clientIp.startsWith('::ffff:')), 'IPv4 映射地址不能误显示成原生 IPv6');
});

test('不支持 IPv6 时同一服务可回退到 IPv4，并明确记录原因', async t => {
    const app = Fastify(), logs = [];
    app.decorate('runner', {log: entry => logs.push(entry)});
    app.get('/health', () => ({ok: true}));
    t.after(() => app.close());
    const listen = app.server.listen;
    app.server.listen = function (options) {
        if (options.host === '::') { process.nextTick(() => this.emit('error', Object.assign(new Error('fixture: IPv6 disabled'), {code: 'EAFNOSUPPORT'}))); return this; }
        return listen.call(this, options);
    };
    await listenApp(app, {port: 0});
    assert.equal(app.server.address().family, 'IPv4');
    assert.equal((await fetch(`http://127.0.0.1:${app.server.address().port}/health`)).status, 200);
    assert.equal(logs.length, 1); assert.match(logs[0].message, /EAFNOSUPPORT/);
});

test('端口占用不静默回退；显式 IPv4 监听继续有效', async t => {
    const first = Fastify(), second = Fastify(), v4 = Fastify();
    t.after(async () => { await Promise.all([first.close(), second.close(), v4.close()]); });
    await listenApp(first, {port: 0});
    await assert.rejects(listenApp(second, {port: first.server.address().port}), {code: 'EADDRINUSE'});
    await listenApp(v4, {port: 0, host: '0.0.0.0'});
    assert.equal(v4.server.address().family, 'IPv4');
});
