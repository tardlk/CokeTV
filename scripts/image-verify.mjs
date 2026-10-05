import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base = 'http://127.0.0.1:54058';
const authorization = 'Basic ' + Buffer.from(':container-smoke-only').toString('base64');
const call = async (url, body, admin = false) => {
    const response = await fetch(base + url, {method: body === undefined ? 'GET' : 'POST',
        headers: {...(admin ? {Authorization: authorization} : {}), ...(body ? {'Content-Type': 'application/json'} : {})},
        body: body === undefined ? undefined : JSON.stringify(body)});
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
};
if (process.argv.includes('--persistence')) {
    const expected = JSON.parse(await fs.readFile('/tmp/coketv-expected-state.json', 'utf8'));
    const state = await call('/admin/state', undefined, true);
    assert.deepEqual(state.scripts, expected.scripts);
    assert.deepEqual(state.instances, expected.instances);
    assert.deepEqual(state.subscriptions, expected.subscriptions);
    assert.equal(state.runtime.started, false);
    assert.equal((await call('/access/status')).requiresSetup, false);
    assert.equal((await call('/watch/sources')).length, expected.instances.filter(item => item.enabled).length);
    console.log('重启持久化通过：密码、脚本、源实例、订阅均保留，空闲引擎未启动');
    process.exit(0);
}

for (const engine of ['js', 'dr2', 'cat', 'py', 'php']) {
    const fixture = engine === 'dr2' ? 'js' : engine === 'cat' ? 'cat.js' : engine;
    const code = await fs.readFile('/tmp/fixtures/协议样本.' + fixture, 'utf8');
    const name = 'pull-check-' + engine + (['py', 'php'].includes(engine) ? '.' + engine : '.js');
    const script = await call('/admin/scripts', {engine, name, code}, true);
    const state = await call('/admin/state', undefined, true);
    const instance = state.instances.find(item => item.scriptId === script.id);
    assert.ok(instance);
    const api = '/watch/sources/' + instance.id;
    const home = await call(api);
    assert.equal(home.class[0].type_id, 'movie'); assert.equal(home.list[0].vod_name, '样本电影');
    assert.ok((await call(api + '?ac=list&t=movie&pg=1')).list.length);
    assert.equal((await call(api + '?wd=pull-check')).list[0].vod_name, 'pull-check');
    assert.ok((await call(api + '?ac=detail&ids=one')).list[0].vod_play_url);
    const media = await call(api + '/play', {play: 'https://fixture.invalid/movie.mp4', flag: '测试'});
    assert.match(media.url, /^\/watch\/media\//);
    const proxy = await fetch(base + '/proxy/' + instance.id + '/', {headers: {Authorization: authorization}});
    assert.equal(proxy.status, 200); assert.equal(await proxy.text(), 'hello');
    console.log(engine + '：首页/分类/搜索/详情/播放解析/源代理通过');
}
const state = await call('/admin/state', undefined, true);
assert.equal(state.scripts.length, 8);
assert.equal(state.instances.length, 8);
assert.equal((await fetch(base + '/admin/state')).status, 401);
assert.equal((await fetch(base + '/config')).status, 403);
for (const route of ['/', '/admin', '/watch', '/watch/history']) assert.equal((await fetch(base + route)).status, 200);
await fs.writeFile('/tmp/coketv-expected-state.json', JSON.stringify({scripts: state.scripts, instances: state.instances, subscriptions: state.subscriptions}));
console.log('公开页面/管理鉴权/订阅Token边界通过；测试数据只在临时容器中');
