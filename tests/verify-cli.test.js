import {ruleFixture} from './helpers/drpy3-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createApp} from '../src/server.js';
import {ROOT} from '../src/paths.js';

const password = ' CLI:密碼-fixture ';
const exec = promisify(execFile);
async function fixture(t, {legacy = false} = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-verify-'));
    if (legacy) await fs.writeFile(path.join(directory, 'admin.json'), JSON.stringify({password}), {mode: 0o600});
    const app = await createApp({directory, seed: false});
    const requests = [];
    app.addHook('onRequest', async request => { if (request.url.startsWith('/api/')) requests.push(request.url); });
    t.after(async () => { await app.close(); await fs.rm(directory, {recursive: true, force: true}); });
    if (!legacy) {

        const response = await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password, confirmPassword: password}});
        assert.equal(response.statusCode, 200, response.body);
    }
    const code = await fs.readFile(path.join(ROOT, 'tests/fixtures/协议样本.js'), 'utf8');
    const script = await app.store.saveScript('dr3', 'CLI协议样本.js', ruleFixture(code));
    await app.listen({host: '127.0.0.1', port: 0});
    return {app, directory, source: script.id, requests, base: `http://127.0.0.1:${app.server.address().port}`};
}
function cli(f, {input = '', env = {}, flags = [], directory = f.directory, args} = {}) {
    const variables = {...process.env, DATA_DIR: directory, ...env}; delete variables.ADMIN_PASSWORD;
    if (env.ADMIN_PASSWORD !== undefined) variables.ADMIN_PASSWORD = env.ADMIN_PASSWORD;
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/verify.mjs'), ...(args || [f.source, f.base, ...flags])], {env: variables, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    // Always bound tests: a missing non-TTY credential must fail, not hang.
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('verify CLI did not exit')); }, 10000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => { clearTimeout(timer); resolve({code, stdout, stderr}); });
        child.stdin.on('error', () => {}); child.stdin.end(input);
    });
}
function passed(result) {
    assert.equal(result.code, 0, result.stderr);
    for (const step of ['首页：', '分类：', '详情：']) assert.ok(result.stdout.includes(step), result.stdout);
    assert.ok(!(result.stdout + result.stderr).includes(password));
    assert.ok(!(result.stdout + result.stderr).includes(Buffer.from(`:${password}`).toString('base64')));
}

test('R10 GUI 创建 v2 哈希后，实际 verify CLI 从 stdin 取凭据并完成首页/分类/详情', async t => {
    const f = await fixture(t), file = path.join(f.directory, 'admin.json');
    const before = await fs.readFile(file);
    assert.equal(JSON.parse(before).version, 2); assert.equal(JSON.parse(before).password, undefined);
    passed(await cli(f, {flags: ['--password-stdin'], input: `${password}\n`}));
    assert.deepEqual(await fs.readFile(file), before);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('R10 不依赖本地 admin.json；环境凭据和 stdin 可诊断远端服务，原参数格式保留', async t => {
    const f = await fixture(t), absent = path.join(f.directory, 'no-local-credentials');
    passed(await cli(f, {directory: absent, env: {ADMIN_PASSWORD: password}}));
    passed(await cli(f, {directory: absent, flags: ['--password-stdin'], input: `${password}\r\n`, env: {ADMIN_PASSWORD: 'wrong-ambient-password'}}));
});

test('R10 非交互无凭据/空输入明确失败，错误密码被拒绝，不读取本地明文或执行源', async t => {
    const f = await fixture(t), before = JSON.stringify(f.app.store.state);
    // Decoy must not be read as an automatic credential source.
    const decoy = path.join(f.directory, 'decoy'); await fs.mkdir(decoy);
    await fs.writeFile(path.join(decoy, 'admin.json'), JSON.stringify({password}));
    const missing = await cli(f, {directory: decoy});
    assert.equal(missing.code, 1); assert.match(missing.stderr, /ADMIN_PASSWORD|--password-stdin/);
    assert.equal(f.requests.length, 0); assert.equal(f.app.runner.child, null);
    const empty = await cli(f, {flags: ['--password-stdin'], input: '\n'});
    assert.equal(empty.code, 1); assert.match(empty.stderr, /密码.*空/); assert.equal(f.requests.length, 0);
    const wrong = await cli(f, {flags: ['--password-stdin'], input: 'wrong-private-password\n'});
    assert.equal(wrong.code, 1); assert.equal(f.requests.length, 1); assert.equal(f.app.runner.child, null);
    assert.ok(!(wrong.stdout + wrong.stderr).includes('wrong-private-password'));
    assert.equal(JSON.stringify(f.app.store.state), before);
});

test('R10 旧明文凭据登录迁移后，verify CLI 仍可用，客户端不恢复明文', async t => {
    const f = await fixture(t, {legacy: true}), file = path.join(f.directory, 'admin.json');
    passed(await cli(f, {flags: ['--password-stdin'], input: `${password}\n`}));
    const end = Date.now() + 3000;
    let saved;
    do { saved = JSON.parse(await fs.readFile(file)); if (saved.version === 2) break; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() < end);
    assert.equal(saved.version, 2); assert.equal(saved.password, undefined);
    const migrated = await fs.readFile(file);
    passed(await cli(f, {flags: ['--password-stdin'], input: `${password}\n`}));
    assert.deepEqual(await fs.readFile(file), migrated);
});

test('隐藏输入恢复终端状态，密码不回显，取消返回130', async () => {
    const {PassThrough} = await import('node:stream');
    const {promptPassword} = await import('../scripts/verify.mjs');
    for (const cancel of [false, true]) {
        const input = new PassThrough(); input.isTTY = true; input.isRaw = false;
        input.setRawMode = value => { input.isRaw = value; };
        let displayed = ''; const output = {write: text => { displayed += text; }};
        const pending = promptPassword({input, output});
        input.emit('keypress', password, {});
        input.emit('keypress', '', cancel ? {ctrl:true,name:'c'} : {name:'return'});
        if (cancel) await assert.rejects(pending, error => error.exitCode === 130);
        else assert.equal(await pending, password);
        assert.equal(input.isRaw, false); assert.equal(displayed.includes(password), false);
        input.destroy();
    }
});
