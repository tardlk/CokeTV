import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inside, validFilename} from '../src/paths.js';
import {Store} from '../src/store.js';
import {buildSubscription, authorizedSubscription} from '../src/subscriptions.js';
import {rewritePlaylist} from '../src/media.js';

test('目录边界：拒绝同前缀兄弟目录、绝对路径和越界路径', () => {
    assert.throws(() => inside('/app/data', '../database/file'));
    assert.throws(() => inside('/app/data', '/tmp/file'));
    assert.equal(inside('/app/data', 'json/源.json'), '/app/data/json/源.json');
    assert.throws(() => validFilename('js', '../源.js'));
    assert.throws(() => validFilename('js', '_lib.js'));
    assert.equal(validFilename('py', '源.py'), '源.py');
});
test('订阅按实例顺序输出，排除停用源，Token 限定站点范围', () => {
    const state = {scripts: [{id: 'script', engine: 'js'}], instances: [
        {id: 'a', scriptId: 'script', name: 'A', enabled: true, params: 'one', searchable: true},
        {id: 'b', scriptId: 'script', name: 'B', enabled: true, params: 'two'},
        {id: 'c', scriptId: 'script', name: 'C', enabled: false},
    ], settings: {}, subscriptions: [{id: 's', token: 'abc', enabled: true, instances: ['b', 'c', 'a']}]};
    const result = buildSubscription(state, state.subscriptions[0], 'https://example.com');
    assert.deepEqual(result.sites.map(s => s.name), ['B', 'A']);
    assert.deepEqual(result.sites.map(s => s.ext), ['two', 'one']);
    assert.equal(new URL(result.sites[0].api).searchParams.get('token'), 'abc');
    assert.ok(authorizedSubscription(state, 'abc', 'a'));
    assert.equal(authorizedSubscription(state, 'abc', 'other'), undefined);
    assert.equal(authorizedSubscription(state, 'bad'), undefined);
});
test('HLS 改写覆盖相对分片、主列表和 AES key URI', () => {
    const result = rewritePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nseg.ts\n../high/index.m3u8', 'https://cdn.test/low/list.m3u8', 'http://localhost:54058', 'abc', {Referer: 'https://site.test'});
    const uris = [...result.matchAll(/(?:URI="|\n)(http[^"\n]+)/g)].map(match => new URL(match[1]));
    assert.equal(uris.length, 3);
    assert.equal(uris[0].searchParams.get('url'), 'https://cdn.test/low/key.bin');
    assert.equal(uris[1].searchParams.get('url'), 'https://cdn.test/low/seg.ts');
    assert.equal(uris[2].searchParams.get('url'), 'https://cdn.test/high/index.m3u8');
    assert.ok(uris.every(uri => uri.searchParams.get('token') === 'abc'));
    const alias = rewritePlaylist('#EXTM3U\nhttp://localhost:54058/proxy/legacy/?segment=1', 'http://localhost:54058/proxy/id/', 'http://localhost:54058', 'abc', {}, {name: 'legacy', id: 'instance'});
    assert.ok(alias.includes('/proxy/instance/?segment=1&token=abc'));
});
test('管理数据串行提交、失败回滚、重启不覆盖用户状态', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'drpy-store-'));
    try {
        const store = await new Store(dir).init({seed: false});
        await Promise.all(Array.from({length: 12}, (_, i) => store.mutate(state => { state.instances.push({id: String(i)}); })));
        assert.equal(store.state.instances.length, 12);
        await assert.rejects(store.mutate(state => { state.instances = []; throw new Error('rollback'); }));
        assert.equal(store.state.instances.length, 12);
        const loaded = await new Store(dir).init();
        assert.equal(loaded.state.instances.length, 12);
    } finally { await fs.rm(dir, {recursive: true, force: true}); }
});
