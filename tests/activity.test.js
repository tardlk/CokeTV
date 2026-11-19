import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {PassThrough} from 'node:stream';
import Fastify from 'fastify';
import {createActivityLog} from '../src/activity.js';
import {createApp} from '../src/server.js';
import {ruleFixture} from './helpers/drpy3-fixture.js';

test('TVBox访问、取链、爬虫和媒体日志关联请求，保留状态且不记录凭据与参数', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-activity-'));
    const app = await createApp({directory});
    t.after(async () => { await app.close(); await fs.rm(directory, {recursive: true, force: true}); });
    await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'activity-admin-password', confirmPassword: 'activity-admin-password'}});
    const script = await app.store.saveScript('dr3', 'activity.js', ruleFixture(`var rule={title:'日志样本',
        class_parse:async function(){console.log('fixture output');return {class:[]}},
        二级:async function(){return {vod_id:'one',vod_name:'测试影片',vod_play_from:'最高画质',vod_play_url:'第1集$private-play-ref'}},
        搜索:async function(){throw new Error('fixture failure')},
        lazy:async function(){return {parse:0,url:getProxyUrl()+'/entry.m3u8'}},
        proxy_rule:async function(){return [206,'video/mp2t','fixture bytes']}
    };`));
    const instance = app.store.state.instances.find(item => item.scriptId === script.id);
    await app.store.mutate(state => { state.subscriptions[0].instances = [instance.id]; state.subscriptions[0].name = '客厅订阅'; });
    const token = app.store.state.subscriptions[0].token;
    const headers = {'user-agent': `FongMi/fixture ${token}`};
    const call = async query => {
        const response = await app.inject({method: 'POST', url: `/api/${instance.id}?token=${token}`, headers, payload: query});
        assert.equal(response.statusCode, 200, response.body); return response;
    };
    assert.equal((await app.inject({url: `/tvbox/${token}`, headers})).statusCode, 200);
    await call({});
    await call({ac: 'detail', ids: 'one'});
    await call({play: 'private-play-ref', flag: '最高画质'});
    for (let index = 0; index < 4; index++) assert.equal((await app.inject({url: `/proxy/${instance.id}/part.ts?token=${token}`, headers})).statusCode, 206);
    const failed = await app.inject({url: `/api/${instance.id}?token=${token}&wd=private-search-word`, headers});
    assert.equal(failed.statusCode, 500);
    app.activity.flush();
    const logs = app.runner.logs;
    const resolved = logs.find(entry => entry.event === 'playback.resolve');
    assert.equal(resolved.title, '测试影片'); assert.equal(resolved.episode, '第1集');
    assert.equal(resolved.delivery, 'NAS 转发'); assert.equal(resolved.subscription, '客厅订阅');
    assert.match(resolved.client, /FongMi/); assert.equal(resolved.protocol, 'TVBox');
    assert.ok(resolved.clientIp);
    const execution = logs.find(entry => entry.event === 'spider.finish' && entry.operation === 'play');
    assert.equal(execution.requestId, resolved.requestId);
    assert.equal(execution.outcome, 'ok'); assert.ok(Number.isInteger(execution.worker)); assert.ok(execution.durationMs >= 0);
    assert.ok(logs.some(entry => entry.event === 'spider.start' && entry.requestId === resolved.requestId));
    assert.ok(logs.some(entry => entry.event === 'spider.output' && entry.message === 'fixture output' && entry.clientIp));
    assert.ok(logs.some(entry => entry.event === 'spider.phase' && entry.operation === 'homeVod'));
    assert.ok(logs.some(entry => entry.event === 'spider.finish' && entry.operation === 'detail' && entry.recordCount === 1));
    assert.ok(logs.some(entry => entry.event === 'spider.error' && entry.operation === 'search' && /fixture failure/.test(entry.message)));
    assert.ok(logs.some(entry => entry.event === 'client.request' && entry.status === 500 && entry.outcome === 'error'));
    assert.ok(logs.some(entry => entry.event === 'client.request' && entry.operation === '订阅获取' && entry.subscription === '客厅订阅'));
    const media = logs.filter(entry => entry.event === 'media.request');
    assert.equal(media.length, 1); assert.equal(media[0].status, 206);
    assert.equal(logs.find(entry => entry.event === 'media.request.summary').requestCount, 3);
    assert.equal(logs.find(entry => entry.event === 'spider.finish.summary').requestCount, 3);
    const text = JSON.stringify(logs);
    for (const secret of [token, 'private-play-ref', 'private-search-word']) assert.ok(!text.includes(secret), secret);
    assert.ok(!text.includes('/part.ts?'));
    const count = logs.length;
    await app.inject('/health'); await app.inject('/watch/app.js');
    assert.equal(app.runner.logs.length, count, '健康检查与静态资源不产生活动日志');
    assert.equal((await app.inject('/admin/logs')).statusCode, 401);
});

test('分片突发汇总有上限，错误即时可见，取消不计为服务失败', t => {
    let time = 100;
    const logs = [], activity = createActivityLog(entry => logs.push(entry), {now: () => time, intervalMs: 1000, maxGroups: 2});
    t.after(() => activity.close());
    const ok = {event: 'media.request', category: 'playback', source: 'a', status: 206, durationMs: 5, outcome: 'ok'};
    activity.sample(ok, '媒体请求');
    activity.sample(ok, '媒体请求');
    activity.sample({...ok, status: 502, outcome: 'error'}, '媒体请求');
    activity.sample({...ok, status: 499, outcome: 'cancelled'}, '媒体请求');
    assert.equal(logs.length, 2); assert.equal(logs[1].status, 502);
    time += 1001; activity.sample(ok, '媒体请求');
    assert.equal(logs[2].requestCount, 3); assert.deepEqual(logs[2].statuses, {'206': 1, '499': 1, '502': 1});
    assert.match(logs[2].message, /失败 1 次/);
    activity.sample({...ok, source: 'b'}, '媒体请求');
    activity.sample({...ok, source: 'b'}, '媒体请求');
    activity.sample({...ok, source: 'c'}, '媒体请求');
    activity.flush();
    assert.equal(logs.filter(entry => entry.event.endsWith('.summary')).reduce((sum, entry) => sum + entry.requestCount, 0), 4);
});

test('真实媒体连接中断记录客户端取消，正常响应只记录一次', async t => {
    const logs = [], activity = createActivityLog(entry => logs.push(entry));
    const app = Fastify(); activity.hooks(app, () => false);
    let stream;
    app.get('/proxy/:module/*', (_request, reply) => { stream = new PassThrough(); reply.type('video/mp2t').send(stream); stream.write('first chunk'); });
    app.get('/watch/sources', () => []);
    await app.listen({port: 0, host: '127.0.0.1'});
    t.after(async () => { stream?.destroy(); await app.close(); activity.close(); });
    await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${app.server.address().port}/proxy/a/part.ts`, res => res.once('data', () => { res.destroy(); resolve(); }));
        req.on('error', reject);
    });
    for (let index = 0; index < 50 && !logs.length; index++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(logs.length, 1); assert.equal(logs[0].status, 499); assert.equal(logs[0].outcome, 'cancelled');
    await app.inject('/watch/sources');
    assert.equal(logs.filter(entry => entry.event === 'client.request').length, 1);
});

test('Emby小写兼容入口保留客户端设备标识，头和路径中的凭据均不入日志', async t => {
    const logs = [], activity = createActivityLog(entry => logs.push(entry));
    const app = Fastify(); activity.hooks(app, () => false);
    app.post('/emby/users/authenticatebyname', request => { activity.bind(request, null, null, {name: '卧室', token: request.body.Pw}); return {ok: true}; });
    app.get('/cat/:credential/manifest', () => ({}));
    app.get('/emby/items/:itemId/images/:imageType', () => 'image');
    t.after(async () => { await app.close(); activity.close(); });
    const token = 'private-session-token';
    await app.inject({method: 'POST', url: '/emby/users/authenticatebyname', headers: {'x-emby-authorization': `MediaBrowser Client="Infuse", Device="iPhone", Token="${token}"`, 'user-agent': token}, payload: {Pw: 'private-password'}});
    await app.inject({url: `/cat/${token}/manifest`, headers: {'user-agent': 'x'.repeat(240) + token}});
    await app.inject('/emby/items/one/images/primary');
    assert.equal(logs.length, 2); assert.equal(logs[0].client, 'Infuse'); assert.equal(logs[0].device, 'iPhone');
    assert.equal(logs[0].operation, '登录'); assert.equal(logs[1].protocol, '猫影视');
    assert.ok(!JSON.stringify(logs).includes('private-session')); assert.ok(!JSON.stringify(logs).includes('private-password'));
});

test('响应头已发出后的媒体流错误仍被记录，不误报客户端取消', async t => {
    const logs = [], activity = createActivityLog(entry => logs.push(entry));
    const app = Fastify(); activity.hooks(app, () => false);
    let stream;
    app.get('/proxy/:module/*', (_request, reply) => { stream = new PassThrough(); reply.type('video/mp2t').send(stream); stream.write('first chunk'); });
    await app.listen({port: 0, host: '127.0.0.1'});
    t.after(async () => { stream?.destroy(); await app.close(); activity.close(); });
    await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${app.server.address().port}/proxy/a/part.ts`, res => {
            res.once('data', () => stream.destroy(new Error('fixture upstream reset')));
            res.on('error', resolve); res.on('end', resolve);
        });
        req.on('error', reject);
    });
    for (let index = 0; index < 50 && !logs.length; index++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(logs.length, 1); assert.equal(logs[0].outcome, 'error'); assert.equal(logs[0].status, 200);
    assert.match(logs[0].message, /媒体流中断/);
});
