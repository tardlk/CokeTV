import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {checkShell} from './check-shell.mjs';

const base = process.env.SMOKE_URL || 'http://127.0.0.1:54058';
const data = process.env.DATA_DIR || '/app/data';
const api = async (url, body, headers = {}) => {
    const response = await fetch(base + url, {method: body === undefined ? 'GET' : 'POST', headers: {...headers, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body === undefined ? undefined : JSON.stringify(body)});
    return {response, body: await response.json()};
};
await checkShell();
assert.equal(process.arch, 'x64');
assert.notEqual(process.getuid?.(), 0);
const health = await api('/health');
assert.equal(health.body.ok, true);
// /health 只暴露 {ok, version}；运行细节在需鉴权的 /admin/health。
assert.equal(health.body.runtime, undefined);
assert.deepEqual((await api('/watch/sources')).body, []);
assert.equal((await api('/access/status')).body.requiresSetup, true);
assert.equal((await api('/admin/state')).response.status, 428);
const initial = JSON.parse(await fs.readFile(data + '/state.json', 'utf8'));
assert.deepEqual(initial.scripts, []); assert.deepEqual(initial.instances, []);
assert.deepEqual(initial.subscriptions[0].instances, []);
assert.deepEqual(initial.settings.parses, []); assert.deepEqual(initial.settings.lives, []); assert.deepEqual(initial.settings.env, {});
assert.deepEqual(JSON.parse(await fs.readFile(data + '/admin.json', 'utf8')), {requiresSetup: true});
// H2：首装必须携带引导码，无码应被拒绝。
assert.equal((await api('/admin/access/setup', {password: 'container-smoke-only', confirmPassword: 'container-smoke-only'})).response.status, 403);
const setupCode = (await fs.readFile(data + '/setup-code.txt', 'utf8')).trim();
assert.ok(setupCode.length >= 8);
const password = 'container-smoke-only';
assert.equal((await api('/admin/access/setup', {password, confirmPassword: password, setupCode})).response.status, 200);
assert.equal((await api('/access/status')).body.requiresSetup, false);
const headers = {Authorization: 'Basic ' + Buffer.from(':' + password).toString('base64')};
for (const type of ['js', 'py', 'php']) {
    const created = await api('/admin/scripts/create', {type, name: 'smoke-' + type}, headers);
    assert.equal(created.response.status, 200, JSON.stringify(created.body));
    const state = (await api('/admin/state', undefined, headers)).body;
    const instance = state.instances.find(item => item.scriptId === created.body.id);
    const result = await api('/watch/sources/' + instance.id);
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.ok(Array.isArray(result.body.class));
}
assert.match(execFileSync('ffmpeg', ['-version'], {encoding: 'utf8'}), /ffmpeg version/);
console.log('linux/amd64 容器验收通过：空数据部署、访问边界、JS/Python/PHP 源创建和执行');
