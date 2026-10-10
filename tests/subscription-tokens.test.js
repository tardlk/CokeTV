import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.js';

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-subscription-token-'));
    let app;
    t.after(async () => { await app?.close(); await fs.rm(directory, {recursive: true, force: true}); });
    app = await createApp({directory, seed: false});
    assert.equal((await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'fixture-password', confirmPassword: 'fixture-password'}})).statusCode, 200);
    const headers = {authorization: `Basic ${Buffer.from(':fixture-password').toString('base64')}`};
    return {
        get app() { return app; },
        request: (url, payload, method = 'POST') => app.inject({url, method, headers, payload}),
        restart: async () => { await app.close(); app = await createApp({directory, seed: false}); },
    };
}
const fields = {name: '自定义订阅', description: '固定测试', enabled: true, instances: []};
const tvbox = (sub, token) => `/subscription/${sub.id}?token=${encodeURIComponent(token)}`;
const cat = (sub, token) => `/cat/${sub.id}/${encodeURIComponent(token)}/index.js.md5`;
const shortTvbox = (_, token) => `/tvbox/${encodeURIComponent(token)}`;
const oldShortTvbox = (_, token) => `/s/${encodeURIComponent(token)}`;
const shortCat = (_, token) => `/cat/${encodeURIComponent(token)}/index.js.md5`;

test('自定义订阅令牌用于TVBox和猫影视，修改立即撤销旧链接并在重启后保持', async t => {
    const f = await fixture(t);
    const created = await f.request('/admin/subscriptions', {...fields, token: 'Living_room-2026'});
    assert.equal(created.statusCode, 200);
    const sub = created.json();
    assert.equal(sub.token, 'Living_room-2026');
    for (const link of [tvbox, cat, shortTvbox, oldShortTvbox, shortCat]) assert.equal((await f.app.inject(link(sub, sub.token))).statusCode, 200);
    const updated = await f.request(`/admin/subscriptions/${sub.id}`, {...fields, token: 'New_room-2026'}, 'PUT');
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().token, 'New_room-2026');
    for (const link of [tvbox, cat, shortTvbox, oldShortTvbox, shortCat]) {
        assert.equal((await f.app.inject(link(sub, sub.token))).statusCode, 403);
        assert.equal((await f.app.inject(link(sub, 'New_room-2026'))).statusCode, 200);
    }
    await f.restart();
    for (const link of [tvbox, cat, shortTvbox, oldShortTvbox, shortCat]) assert.equal((await f.app.inject(link(sub, 'New_room-2026'))).statusCode, 200);
});

test('短订阅按唯一令牌选择源范围，停用、删除和旧备份重复令牌均拒绝', async t => {
    const f = await fixture(t);
    const script = await f.app.store.saveScript('js', 'short.js', 'var rule={title:"短订阅样本"};');
    const id = f.app.store.state.instances.find(item => item.scriptId === script.id).id;
    const first = (await f.request('/admin/subscriptions', {...fields, token: 'first-short'})).json();
    const second = (await f.request('/admin/subscriptions', {...fields, token: 'second-short', instances: [id]})).json();
    const response = await f.app.inject(shortTvbox(second, second.token));
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['cache-control'], /private.*no-store/);
    assert.deepEqual(response.json().sites.map(item => item.key), [`lite_${id}`]);
    assert.deepEqual((await f.app.inject(shortTvbox(first, first.token))).json().sites, []);
    assert.equal((await f.app.inject('/tvbox/unknown')).statusCode, 403);
    await f.request(`/admin/subscriptions/${second.id}`, {...second, enabled: false}, 'PUT');
    for (const link of [shortTvbox, shortCat]) assert.equal((await f.app.inject(link(second, second.token))).statusCode, 403);
    await f.request(`/admin/subscriptions/${second.id}`, second, 'PUT');
    // 模拟旧备份已有重复令牌：短链接不能任意选中其中一个订阅。
    f.app.store.state.subscriptions.find(item => item.id === first.id).token = second.token;
    for (const link of [shortTvbox, shortCat]) assert.equal((await f.app.inject(link(second, second.token))).statusCode, 403);
    assert.equal((await f.app.inject(tvbox(second, second.token))).statusCode, 200);
    assert.equal((await f.app.inject(cat(second, second.token))).statusCode, 200);
    await f.request(`/admin/subscriptions/${first.id}`, undefined, 'DELETE');
    assert.equal((await f.app.inject(shortTvbox(second, second.token))).statusCode, 200);
    await f.request(`/admin/subscriptions/${second.id}`, undefined, 'DELETE');
    for (const link of [shortTvbox, shortCat]) assert.equal((await f.app.inject(link(second, second.token))).statusCode, 403);
});

test('新建留空或省略令牌自动生成，编辑省略保持，重置继续生成随机令牌', async t => {
    const f = await fixture(t);
    for (const body of [fields, {...fields, token: ''}]) {
        const created = await f.request('/admin/subscriptions', body);
        assert.equal(created.statusCode, 200);
        const sub = created.json();
        assert.match(sub.token, /^[A-Za-z0-9_-]{32}$/);
        const updated = await f.request(`/admin/subscriptions/${sub.id}`, {...fields, description: '改描述'}, 'PUT');
        assert.equal(updated.statusCode, 200);
        assert.equal(updated.json().token, sub.token);
        const reset = await f.request(`/admin/subscriptions/${sub.id}/token`, {});
        assert.equal(reset.statusCode, 200);
        assert.match(reset.json().token, /^[A-Za-z0-9_-]{32}$/);
        assert.notEqual(reset.json().token, sub.token);
        assert.equal((await f.app.inject(tvbox(sub, sub.token))).statusCode, 403);
        assert.equal((await f.app.inject(cat(sub, reset.json().token))).statusCode, 200);
    }
});

test('令牌校验接受1到200位URL安全字符，非法输入不能部分修改订阅', async t => {
    const f = await fixture(t);
    const sub = (await f.request('/admin/subscriptions', {...fields, token: 'a'})).json();
    const long = await f.request(`/admin/subscriptions/${sub.id}`, {...fields, token: 'A'.repeat(200)}, 'PUT');
    assert.equal(long.statusCode, 200);
    const before = structuredClone(f.app.store.state.subscriptions);
    for (const token of ['', ' ', ' padded', 'two words', 'a/b', 'a?b', 'a#b', 'a&b', 'a%b', 'a\nb', 'a\n', '中文', 'a'.repeat(201), null, 123, {}, []]) {
        const response = await f.request(`/admin/subscriptions/${sub.id}`, {...fields, name: '不应保存', token}, 'PUT');
        assert.equal(response.statusCode, 400, `invalid token type=${typeof token}`);
        assert.deepEqual(f.app.store.state.subscriptions, before);
        if (token !== '') {
            assert.equal((await f.request('/admin/subscriptions', {...fields, token})).statusCode, 400);
            assert.deepEqual(f.app.store.state.subscriptions, before);
        }
    }
    // 旧备份可能包含不符合新输入规则的令牌，编辑其他字段时仍保留它。
    f.app.store.state.subscriptions.find(s => s.id === sub.id).token = 'legacy imported token';
    await f.app.store.persist();
    const legacy = await f.request(`/admin/subscriptions/${sub.id}`, {...fields, token: 'legacy imported token', description: '只改说明'}, 'PUT');
    assert.equal(legacy.statusCode, 200);
    assert.equal(legacy.json().token, 'legacy imported token');
});

test('跨订阅令牌冲突返回409，并发创建仅成功一次，停用订阅仍保留其令牌', async t => {
    const f = await fixture(t);
    const results = await Promise.all([f.request('/admin/subscriptions', {...fields, token: 'Shared-token'}), f.request('/admin/subscriptions', {...fields, token: 'Shared-token'})]);
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
    const sub = results.find(r => r.statusCode === 200).json();
    assert.equal((await f.request(`/admin/subscriptions/${sub.id}`, {...sub, enabled: false}, 'PUT')).statusCode, 200);
    const other = (await f.request('/admin/subscriptions', {...fields, token: 'Other-token'})).json();
    assert.equal((await f.request(`/admin/subscriptions/${other.id}`, {...fields, token: sub.token}, 'PUT')).statusCode, 409);
    assert.equal(f.app.store.state.subscriptions.find(s => s.id === other.id).token, 'Other-token');
    assert.equal((await f.request(`/admin/subscriptions/${other.id}`, {...fields, token: 'Other-token'}, 'PUT')).statusCode, 200);
});

test('自定义令牌不能用于管理鉴权，未鉴权不能保存，公开源列表不泄露令牌', async t => {
    const f = await fixture(t);
    const sub = (await f.request('/admin/subscriptions', {...fields, token: 'Private-custom-token'})).json();
    const before = structuredClone(f.app.store.state.subscriptions);
    assert.equal((await f.app.inject({url: `/admin/subscriptions/${sub.id}`, method: 'PUT', payload: {...fields, token: 'Changed-token'}})).statusCode, 401);
    assert.deepEqual(f.app.store.state.subscriptions, before);
    assert.equal((await f.app.inject(`/admin/state?token=${sub.token}`)).statusCode, 401);
    assert.ok(!(await f.app.inject('/watch/sources')).body.includes(sub.token));
});
