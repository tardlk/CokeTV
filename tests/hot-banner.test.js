import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseHotBanner, createHotBanner} from '../src/hot-banner.js';
import {createApp} from '../src/server.js';

const card = (title = '热播样本', image = 'https://tv.puui.qpic.cn/tv/sample/0') => ({params: {title, pic_ori_2880x900: image, topic_label: '电视剧 / 演员甲|演员乙', main_genre: '剧情', stitle_pc: '副标题', rec_normal_reason: '推荐简介', secret: 'must-not-leak'}});
const feed = cards => ({data: {CardList: [{type: 'pc_carousel', children_list: {list: {cards}}}]}});

test('轮播只读取公开字段、最多五张，过滤危险图片/无效数据并去重', () => {
    const data = feed([null, card(), card(), card('坏图', 'http://127.0.0.1/a'), card('伪域名', 'https://tv.puui.qpic.cn.evil.test/a'),
        card('凭据', 'https://user:pass@tv.puui.qpic.cn/a'), ...Array.from({length: 8}, (_, i) => card('片名' + i))]);
    const parsed = parseHotBanner(data);
    assert.equal(parsed.length, 5); assert.equal(parsed[0].actors, '演员甲|演员乙');
    assert.deepEqual(Object.keys(parsed[0]).sort(), ['actors', 'backgroundImage', 'description', 'genre', 'subtitle', 'title']);
    assert.equal(parsed.filter(item => item.title === '热播样本').length, 1);
    assert.deepEqual(parseHotBanner({data: {CardList: [{type: 'other', children_list: {list: {cards: [card()]}}}]}}), []);
});

test('轮播五分钟缓存、并发复用、独立返回值，过期才按需请求', async () => {
    let now = 1000, calls = 0, resolve;
    const cache = createHotBanner({now: () => now, request: async () => { calls++; return new Promise(done => { resolve = done; }); }});
    const first = cache.get(), second = cache.get(); assert.equal(calls, 1);
    resolve(feed([card()]));
    const [a, b] = await Promise.all([first, second]); a.banner[0].title = 'mutated';
    assert.equal(b.banner[0].title, '热播样本'); assert.equal((await cache.get()).banner[0].title, '热播样本');
    assert.equal(calls, 1); now += 300001;
    const next = cache.get(); assert.equal(calls, 2); resolve(feed([card('新版')])); assert.equal((await next).banner[0].title, '新版');
});

test('轮播失败保留旧成功结果并一分钟退避，超过一天舍弃旧结果', async () => {
    let now = 1000, calls = 0;
    const cache = createHotBanner({now: () => now, request: async () => { if (++calls === 1) return feed([card()]); throw new Error('unavailable'); }});
    await cache.get(); now += 300001;
    assert.equal((await cache.get()).banner.length, 1); await cache.get(); assert.equal(calls, 2);
    now += 86400000; assert.deepEqual((await cache.get()).banner, []);
    const empty = createHotBanner({request: async () => ({})}); assert.deepEqual((await empty.get()).banner, []);
});

test('公开轮播不需要源/密码，不注册脚本，不接受调用者 URL 或泄露管理数据', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-banner-'));
    let calls = 0;
    const app = await createApp({directory, bannerRequest: async (...args) => { calls++; assert.equal(args.length, 0); return feed([card()]); }});
    t.after(async () => { await app.close(); await fs.rm(directory, {recursive: true, force: true}); });
    const response = await app.inject('/watch/banner?url=http://127.0.0.1/private');
    assert.equal(response.statusCode, 200); assert.equal(response.json().banner.length, 1); assert.match(response.headers['cache-control'], /^public, max-age=\d+$/);
    assert.equal(response.body.includes('must-not-leak'), false); assert.deepEqual(app.store.state.scripts, []);
    await app.inject('/watch/banner'); assert.equal(calls, 1);
    await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'banner-test', confirmPassword: 'banner-test'}});
    assert.equal((await app.inject('/admin/state')).statusCode, 401);
});
