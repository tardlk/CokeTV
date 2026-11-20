import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHomeCache} from '../src/home-cache.js';
import {createApp} from '../src/server.js';
import {ruleFixture} from './helpers/drpy3-fixture.js';

test('首页缓存合并并发、独立复制结果、到期重抓，主动更新十秒内合并', async () => {
    let time = 0, calls = 0, release;
    const cache = createHomeCache({now: () => time, ttl: 300000});
    const load = async () => { calls++; return {list: [{vod_name: String(calls)}]}; };
    const first = cache.get('a', async () => { await new Promise(resolve => { release = resolve; }); return load(); });
    const second = cache.get('a', load);
    await Promise.resolve(); release();
    const [one, two] = await Promise.all([first, second]);
    assert.equal(calls, 1); assert.equal(two.status, 'shared');
    one.value.list[0].vod_name = 'changed';
    assert.equal((await cache.get('a', load)).value.list[0].vod_name, '1');
    time = 300001; assert.equal((await cache.get('a', load)).status, 'miss'); assert.equal(calls, 2);
    await cache.get('a', load, {refresh: true}); assert.equal(calls, 3);
    await cache.get('a', load, {refresh: true}); assert.equal(calls, 3);
    time += 10001; await cache.get('a', load, {refresh: true}); assert.equal(calls, 4);
});

test('失败不缓存、不覆盖旧成功结果；失效后的在途结果不能重填缓存', async () => {
    const cache = createHomeCache(); let calls = 0, release;
    const load = async () => ({list: [{vod_name: String(++calls)}]});
    await cache.get('a', load);
    await assert.rejects(cache.get('a', async () => { throw new Error('fixture failure'); }, {refresh: true}), /fixture failure/);
    assert.equal((await cache.get('a', load)).value.list[0].vod_name, '1');
    const pending = cache.get('b', async () => { await new Promise(resolve => { release = resolve; }); return load(); });
    await Promise.resolve(); cache.clear(); release();
    assert.equal((await pending).remainingMs, 0);
    assert.equal((await cache.get('b', load)).status, 'miss');
    let invalidCalls = 0;
    for (let index = 0; index < 2; index++) await cache.get('invalid', async () => { invalidCalls++; return {error: 'source failed'}; });
    assert.equal(invalidCalls, 2);
});

test('首页缓存按条数和字节上限淘汰，过大响应不进入缓存', async () => {
    const cache = createHomeCache({max: 2, maxSize: 200, maxEntrySize: 100});
    const load = async () => ({list: []});
    for (const key of ['a', 'b', 'c']) await cache.get(key, load);
    assert.equal((await cache.get('a', load)).status, 'miss');
    const large = async () => ({list: [{vod_name: 'x'.repeat(150)}]});
    assert.equal((await cache.get('large', large)).remainingMs, 0);
    assert.equal((await cache.get('large', large)).status, 'miss');
});

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-home-cache-'));
    const app = await createApp({directory});
    t.after(async () => { await app.close(); await fs.rm(directory, {recursive: true, force: true}); });
    const code = title => ruleFixture(`var rule={title:${JSON.stringify(title)},class_parse:async function(){
        await new Promise(resolve=>setTimeout(resolve,25));console.log('home-fetch');return {class:[{type_id:'movie',type_name:'电影'}]}
    },推荐:async function(){return [{vod_id:'one',vod_name:${JSON.stringify(title)}}]},lazy:async function(){console.log('play-fetch');return {parse:0,url:'https://example.invalid/movie.mp4'}}};`);
    const script = await app.store.saveScript('dr3', 'cache.js', code('首页一'));
    const instance = app.store.state.instances.find(item => item.scriptId === script.id);
    const subscription = app.store.state.subscriptions[0]; subscription.instances = [instance.id];
    const headers = {'user-agent': 'cache-fixture', host: 'tv.example:54058'};
    const home = (query = '', extra = {}) => app.inject({url: `/watch/sources/${instance.id}${query}`, headers: {...headers, ...extra}});
    const count = () => app.runner.logs.filter(entry => entry.event === 'spider.start' && entry.operation === 'home').length;
    return {app, script, instance, subscription, headers, home, count, code};
}

test('真实网页首页并发只执行一次，刷新复用缓存、主动更新重抓，播放不缓存', async t => {
    const {app, home, count, instance, headers} = await fixture(t);
    const results = await Promise.all([home(), home(), home()]);
    assert.ok(results.every(result => result.statusCode === 200)); assert.equal(count(), 1);
    assert.deepEqual(results[0].json().list.map(item => item.vod_name), ['首页一']);
    assert.ok(Number(results[0].headers['x-coketv-home-ttl']) > 0);
    await home(); assert.equal(count(), 1);
    await home('?homeRefresh=1'); assert.equal(count(), 2);
    await home('?homeRefresh=1'); assert.equal(count(), 2);
    assert.ok(app.runner.logs.some(entry => entry.event === 'spider.cache' && entry.cacheStatus === 'shared'));
    for (let index = 0; index < 2; index++) assert.equal((await app.inject({method: 'POST', url: `/watch/sources/${instance.id}/play`, headers, payload: {play: 'episode'}})).statusCode, 200);
    assert.equal(app.runner.logs.filter(entry => entry.event === 'spider.start' && entry.operation === 'play').length, 2);
});

test('不同访问入口、订阅、UA和筛选参数隔离；停用或错误凭据不能读取已有缓存', async t => {
    const {app, home, count, instance, subscription, headers} = await fixture(t);
    await home();
    await home('', {host: '[::1]:54058'}); await home('', {'user-agent': 'other-client'});
    assert.equal(count(), 3);
    const api = filter => app.inject({url: `/api/${instance.id}?token=${subscription.token}&filter=${filter}`, headers});
    await api('1'); await api('1'); await api('0'); assert.equal(count(), 5);
    app.store.state.subscriptions.push({...subscription, id: 'second-sub', token: 'another-private-token'});
    await app.inject({url: `/api/${instance.id}?token=another-private-token&filter=1`, headers}); assert.equal(count(), 6);
    assert.equal((await app.inject({url: `/api/${instance.id}?token=invalid&filter=1`, headers})).statusCode, 403);
    instance.enabled = false;
    assert.equal((await home()).statusCode, 403); assert.equal(count(), 6);
    assert.ok(!JSON.stringify(app.runner.logs).includes(subscription.token));
});

test('脚本、参数、ENV和运行进程重置后立即失效，公开版本标识跟随重置变化', async t => {
    const {app, home, count, script, instance, code} = await fixture(t);
    await home(); assert.equal(count(), 1);
    instance.params = 'new-params'; await home(); assert.equal(count(), 2);
    await app.store.atomic(app.store.sourceEnvPath(instance.id), JSON.stringify({TEST_VALUE: 'new-env'}));
    await home(); assert.equal(count(), 3);
    await fs.writeFile(path.join(app.store.runtime, 'config/env.json'), JSON.stringify({GLOBAL_VALUE: 'changed'}));
    await home(); assert.equal(count(), 4);
    await fs.writeFile(app.store.scriptPath(script), code('首页二'));
    assert.equal((await home()).json().list[0].vod_name, '首页二'); assert.equal(count(), 5);
    const before = (await app.inject('/watch/sources')).json()[0].homeRevision;
    app.runner.reset(); await home(); assert.equal(count(), 6);
    assert.notEqual((await app.inject('/watch/sources')).json()[0].homeRevision, before);
});
