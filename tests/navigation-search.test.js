import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.js';

const navigationSource = `export default {
    meta: {title: '导航热播', lang: 'dr3', navigation: true},
    rule: {host: 'https://fixture.invalid', searchable: 0},
    async home() { return {class: []}; },
    async homeVod() { return {list: [{vod_id: 'hot-1', vod_name: '热播片'}]}; },
};`;

const searchSource = (title, prefix, fail = false) => `export default {
    meta: {title: ${JSON.stringify(title)}, lang: 'dr3'},
    rule: {host: 'https://fixture.invalid', searchable: 1},
    async search(ctx, wd) {
        ${fail ? "throw new Error('站点暂时不可用');" : `return {page: 1, pagecount: 1, list: [{vod_id: '${prefix}-1', vod_name: wd + ' · ${title}'}]};`}
    },
};`;

test('导航源标记可见，聚合搜索只查可搜索的非导航源并按源分组', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-nav-search-'));
    const app = await createApp({directory});
    t.after(async () => { await app.close(); await fs.rm(directory, {recursive: true, force: true}); });
    const nav = await app.store.saveScript('dr3', '导航热播.js', navigationSource);
    const first = await app.store.saveScript('dr3', '搜索甲.js', searchSource('搜索甲', 'a'));
    const second = await app.store.saveScript('dr3', '搜索乙.js', searchSource('搜索乙', 'b'));
    const broken = await app.store.saveScript('dr3', '搜索故障.js', searchSource('搜索故障', 'x', true));
    const navInstance = app.store.state.instances.find(item => item.scriptId === nav.id);
    const firstInstance = app.store.state.instances.find(item => item.scriptId === first.id);
    const secondInstance = app.store.state.instances.find(item => item.scriptId === second.id);
    const brokenInstance = app.store.state.instances.find(item => item.scriptId === broken.id);
    assert.equal(navInstance.navigation, true);
    assert.equal(navInstance.searchable, false);

    const sources = await app.inject('/watch/sources');
    assert.equal(sources.statusCode, 200);
    const list = sources.json();
    assert.equal(list.find(item => item.id === navInstance.id).navigation, true);
    assert.equal(list.find(item => item.id === firstInstance.id).navigation, false);

    // FongMi uses the site-level indexs flag to search by the clicked title.
    const subscription = app.store.state.subscriptions[0];
    await app.store.mutate(state => { state.subscriptions[0].instances = [navInstance.id, firstInstance.id]; });
    for (const endpoint of ['/tvbox/', '/s/']) {
        const response = await app.inject(endpoint + subscription.token);
        assert.equal(response.statusCode, 200, response.body);
        const sites = response.json().sites;
        assert.equal(sites.length, 2);
        const navSite = sites.find(site => site.key === 'lite_' + navInstance.id);
        assert.equal(navSite.indexs, 1); assert.equal(navSite.searchable, 0);
        const playable = sites.filter(site => site.searchable === 1);
        assert.equal(playable.length, 1); assert.equal(playable[0].indexs, undefined);
        const homeUrl = new URL(navSite.api);
        const homeResult = await app.inject(homeUrl.pathname + homeUrl.search);
        assert.equal(homeResult.statusCode, 200, homeResult.body);
        const keyword = homeResult.json().list[0].vod_name;
        const searchUrl = new URL(playable[0].api); searchUrl.searchParams.set('wd', keyword);
        const nativeSearch = await app.inject(searchUrl.pathname + searchUrl.search);
        assert.equal(nativeSearch.statusCode, 200, nativeSearch.body);
        assert.equal(nativeSearch.json().list[0].vod_name, '热播片 · 搜索甲');
        searchUrl.pathname = '/api/' + secondInstance.id;
        assert.equal((await app.inject(searchUrl.pathname + searchUrl.search)).statusCode, 403);
    }

    // Disable the failure source for the happy path, then include it explicitly.
    await app.store.mutate(state => { state.instances.find(item => item.id === brokenInstance.id).enabled = false; });
    const result = await app.inject(`/watch/search?wd=${encodeURIComponent('庆余年')}`);
    assert.equal(result.statusCode, 200, result.body);
    const payload = result.json();
    assert.equal(payload.query, '庆余年');
    assert.deepEqual(payload.groups.map(group => group.source.name), ['搜索甲', '搜索乙']);
    assert.deepEqual(payload.groups.map(group => group.results[0].vod_id), ['a-1', 'b-1']);
    assert.ok(payload.groups.every(group => !group.source.id || group.source.id !== navInstance.id));
    assert.equal(payload.groups.some(group => group.source.id === navInstance.id), false);

    const filtered = await app.inject(`/watch/search?wd=x&sources=${encodeURIComponent(firstInstance.id)}`);
    assert.equal(filtered.statusCode, 200);
    assert.deepEqual(filtered.json().groups.map(group => group.source.name), ['搜索甲']);

    await app.store.mutate(state => { state.instances.find(item => item.id === brokenInstance.id).enabled = true; });
    const partial = await app.inject(`/watch/search?wd=y&sources=${encodeURIComponent(firstInstance.id + ',' + brokenInstance.id)}`);
    assert.equal(partial.statusCode, 200);
    const brokenGroup = partial.json().groups.find(group => group.source.id === brokenInstance.id);
    assert.equal(brokenGroup.results.length, 0);
    assert.match(brokenGroup.error, /站点暂时不可用/);
    assert.equal(partial.json().groups.find(group => group.source.id === firstInstance.id).results[0].vod_id, 'a-1');
});
