import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {createApp} from '../src/server.js';
import {Store} from '../src/store.js';

const exec = promisify(execFile);
// Test the private interpreter path actually passed to the bridge, rather than
// treating the public command name 'php' (also a source suffix) as a secret.
const {stdout: phpBinary} = await exec(process.env.TEST_PHP || 'php', ['-r', 'echo PHP_BINARY;'], {timeout: 5000});
const PHP = phpBinary.trim();
assert.ok(path.isAbsolute(PHP), 'PHP_BINARY 必须返回真实解释器的绝对路径');
const params = JSON.stringify({cookie: 'private-param-&"cookie-fixture', nested: {token: 'private-nested-param-fixture'}});
const env = {alias: 'private-env-cookie-fixture', nested: {token: 'private-nested-env-fixture'}};
const globalEnv = {shared: 'private-global-env-fixture'};

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-private-'));
    const app = await createApp({directory, seed: false});
    t.after(async () => { await app.close(); await fs.rm(directory, {recursive: true, force: true}); });
    const setupCode = (await fs.readFile(path.join(directory, 'setup-code.txt'), 'utf8')).trim();
    const setup = await app.inject({method: 'POST', url: '/admin/access/setup', payload: {setupCode, password: 'private-password', confirmPassword: 'private-password'}});
    assert.equal(setup.statusCode, 200, setup.body);
    app.store.state.settings.phpPath = PHP;
    const authorization = `Basic ${Buffer.from(':private-password').toString('base64')}`;
    return {app, directory, authorization};
}
const forms = value => [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)];
function assertPrivate(text, secrets) {
    for (const secret of secrets) for (const value of forms(secret)) assert.ok(!text.includes(value), `私密数据未隐藏：${value}`);
    assert.ok(!text.includes('Command failed:'));
}
async function phpSource(f, verbose = false) {
    const code = verbose ? `<?php
class Spider {
    private $params = '';
    public function init($params) { $this->params = $params; return []; }
    public function homeContent($filter) {
        $context = json_decode($GLOBALS['argv'][3], true);
        $params = json_decode($this->params, true);
        $env = json_decode(file_get_contents($context['sourceEnvPath']), true);
        trigger_error('fixture warning ' . $this->params . ' ' . $context['sourceEnvPath'], E_USER_WARNING);
        throw new RuntimeException('fixture business error ' . $this->params . ' ' . $params['nested']['token'] . ' ' . urlencode($params['cookie']) . ' ' . $env['alias'] . ' ' . $env['nested']['token'] . ' ' . $context['sourceEnvPath']);
    }
}` : `<?php class Spider { public function init($params) { return []; } public function homeContent($filter) { throw new RuntimeException('fixture business error'); } }`;
    const script = await f.app.store.saveScript('php', '私密异常样本.php', code);
    await f.app.store.mutate(state => { state.instances.find(item => item.id === script.id).params = params; state.settings.env = globalEnv; });
    await f.app.store.syncEnvironment();
    const file = f.app.store.sourceEnvPath(script.id);
    await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, JSON.stringify(env), {mode: 0o600});
    return {script, file};
}

test('R5 普通 PHP 首页异常的匿名响应是固定安全错误，不返回命令/参数/ENV/路径', async t => {
    const f = await fixture(t), {script, file} = await phpSource(f);
    const response = await f.app.inject(`/watch/sources/${script.id}`);
    assert.equal(response.statusCode, 500);
    assertPrivate(response.body, [params, JSON.parse(params).cookie, env.alias, file, f.app.store.scriptPath(script), f.directory, PHP]);
    assert.deepEqual(response.json(), {error: 'PHP 源执行失败'});
    assert.equal((await f.app.inject('/admin/logs')).statusCode, 401);
    const healthy = await f.app.store.saveScript('php', '私密错误后正常源.php', '<?php class Spider { public function init($params) { return []; } public function homeContent($filter) { return ["class"=>[]]; } public function homeVideoContent() { return ["list"=>[]]; } }');
    assert.equal((await f.app.inject(`/watch/sources/${healthy.id}`)).statusCode, 200);
});

test('R5 PHP 桥接错误/Warning 的诊断保留异常和方法，参数/嵌套 ENV/路径均脱敏', async t => {
    const f = await fixture(t), {script, file} = await phpSource(f, true);
    const response = await f.app.inject(`/watch/sources/${script.id}`);
    assert.equal(response.statusCode, 500);
    const logs = await f.app.inject({url: '/admin/logs', headers: {authorization: f.authorization}});
    assert.equal(logs.statusCode, 200, logs.body);
    const messages = logs.json().map(entry => entry.message).join('\n');
    assertPrivate(messages, [params, JSON.parse(params).cookie, JSON.parse(params).nested.token, env.alias, env.nested.token, globalEnv.shared, file, await fs.realpath(file), f.app.store.scriptPath(script), f.directory, await fs.realpath(f.directory), PHP]);
    assert.match(messages, /fixture business error/);
    assert.match(messages, /homeContent|PHP home/);
    assert.match(messages, /已隐藏/);
    const verify = await f.app.inject({method: 'POST', url: `/admin/verify/${script.id}`, headers: {authorization: f.authorization}, payload: {step: 'home'}});
    assert.equal(verify.statusCode, 500);
    assert.equal(f.app.store.state.instances.find(item => item.id === script.id).lastCheck.error, 'PHP 源执行失败');
    assertPrivate(verify.body, [params, env.alias, file]);
});

test('R5 PHP 初始化异常、缺失解释器、非 JSON 进程失败不会回传原始 execFile 错误', async t => {
    const f = await fixture(t);
    const init = await f.app.store.saveScript('php', '初始化异常.php', '<?php class Spider { public function init($params) { throw new RuntimeException("fixture-init-error ".$params); } }');
    f.app.store.state.instances.find(item => item.id === init.id).params = params;
    const initial = await f.app.inject(`/watch/sources/${init.id}`);
    assert.equal(initial.statusCode, 500);
    assert.deepEqual(initial.json(), {error: 'PHP 源执行失败'});
    // Private params may coincide with words in the safe constant; redaction
    // must not change the stable public error message.
    f.app.store.state.instances.find(item => item.id === init.id).params = '失败';
    const coincident = await f.app.inject(`/watch/sources/${init.id}`);
    assert.deepEqual(coincident.json(), {error: 'PHP 源执行失败'});
    const {script} = await phpSource(f);
    for (const interpreter of [path.join(f.directory, 'missing-private-php'), process.execPath]) {
        f.app.store.state.settings.phpPath = interpreter;
        f.app.runner.reset();
        const response = await f.app.inject(`/watch/sources/${script.id}`);
        assert.equal(response.statusCode, 500);
        assert.deepEqual(response.json(), {error: 'PHP 源执行失败'});
        const messages = f.app.runner.logs.map(entry => entry.message).join('\n');
        assertPrivate(messages, [params, JSON.parse(params).cookie, f.directory, interpreter]);
    }
});

const mode = async file => (await fs.stat(file)).mode & 0o777;
function observePrivateTemps(t, targets) {
    const found = [];
    const rename = fs.rename;
    t.mock.method(fs, 'rename', async (temporary, target) => {
        if (targets.includes(target)) found.push({target, mode: await mode(temporary)});
        return rename(temporary, target);
    });
    return found;
}

test('R8 全局 ENV/状态/插件的首次创建、反复原子保存与重启在宽松 umask 下仍是 0600', async t => {
    const previous = process.umask(0o022); t.after(() => process.umask(previous));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-permissions-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const targets = ['runtime/config/env.json', 'state.json', 'runtime/.plugins.js'].map(relative => path.join(directory, relative));
    const temps = observePrivateTemps(t, targets);
    const store = await new Store(directory).init({seed: false});
    assert.equal(await mode(targets[0]), 0o600);
    for (const mask of [0o000, 0o022]) {
        process.umask(mask);
        await store.mutate(state => { state.settings.env = {cookie: 'permission-cookie-fixture'}; });
        await fs.chmod(targets[0], 0o644); // Legacy data, tightened on the next write.
        await store.syncEnvironment();
        for (const target of targets) assert.equal(await mode(target), 0o600, target);
        const restarted = await new Store(directory).init({seed: false});
        assert.equal(restarted.state.settings.env.cookie, 'permission-cookie-fixture');
        for (const target of targets) assert.equal(await mode(target), 0o600, target);
    }
    assert.ok(temps.length >= 6);
    for (const temporary of temps) assert.equal(temporary.mode, 0o600, '临时文件不能先用宽松权限写入再 chmod');
});

test('R8 管理设置、每源 ENV、配置导入和凭据保存从临时文件开始就是 0600', async t => {
    const previous = process.umask(0o022); t.after(() => process.umask(previous));
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-private-admin-'));
    let app;
    t.after(async () => { await app?.close(); await fs.rm(directory, {recursive: true, force: true}); });
    const globalFile = path.join(directory, 'runtime/config/env.json'), adminFile = path.join(directory, 'admin.json');
    const temps = observePrivateTemps(t, [globalFile, adminFile]);
    app = await createApp({directory, seed: false});
    const setupCode = (await fs.readFile(path.join(directory, 'setup-code.txt'), 'utf8')).trim();
    assert.equal((await app.inject({method: 'POST', url: '/admin/access/setup', payload: {setupCode, password: 'permission-password', confirmPassword: 'permission-password'}})).statusCode, 200);
    const authorization = `Basic ${Buffer.from(':permission-password').toString('base64')}`;
    const settings = {...app.store.state.settings, env: globalEnv};
    assert.equal((await app.inject({method: 'PUT', url: '/admin/settings', headers: {authorization}, payload: settings})).statusCode, 200);
    assert.equal(await mode(globalFile), 0o600);
    const script = await app.store.saveScript('js', '权限样本.js', 'var rule={title:"权限样本"};');
    const sourceFile = app.store.sourceEnvPath(script.id);
    const sourceTemps = observePrivateTemps(t, [sourceFile]);
    assert.equal((await app.inject({method: 'PUT', url: `/admin/instances/${script.id}/environment`, headers: {authorization}, payload: {values: env}})).statusCode, 200);
    const exported = (await app.inject({url: '/admin/export', headers: {authorization}})).json();
    await fs.chmod(sourceFile, 0o644);
    assert.equal((await app.inject({method: 'POST', url: '/admin/import', headers: {authorization}, payload: exported})).statusCode, 200);
    assert.deepEqual(await app.store.readSourceEnvironment(script.id), env);
    assert.equal(await mode(sourceFile), 0o600);
    for (const temporary of [...temps, ...sourceTemps]) assert.equal(temporary.mode, 0o600, '原子替换前私密临时文件权限必须正确');
});

test('R8 引擎全局/每源 ENV.set 与 ENV.delete 后，宿主同步和重启保持值与 0600', async t => {
    const f = await fixture(t);
    const script = await f.app.store.saveScript('js', '引擎权限样本.js', `var rule={title:'引擎权限样本',host:'https://fixture.invalid',action:async function(name,value){if(name==='delete')ENV.delete('cookie');else ENV.set('cookie',value);return {ok:true};}};`);
    const sourceFile = f.app.store.sourceEnvPath(script.id), globalFile = path.join(f.app.store.runtime, 'config/env.json');
    const call = name => f.app.inject({url: `/api/${script.id}?ac=action&action=${name}&value=engine-source-fixture`, headers: {authorization: f.authorization}});
    assert.equal((await call('set')).statusCode, 200);
    assert.equal(await mode(sourceFile), 0o600);
    assert.equal((await f.app.store.readSourceEnvironment(script.id)).cookie, 'engine-source-fixture');
    // No source scope: execute the retained global ENV API in this temporary
    // runtime, never import/write the release engine's config directory.
    const envModule = pathToFileURL(path.join(f.app.store.runtime, 'utils/env.js')).href;
    await exec(process.execPath, ['--input-type=module', '-e', `const {ENV}=await import(${JSON.stringify(envModule)}); ENV.set('cookie','engine-global-fixture'); ENV.set('removed','fixture'); ENV.delete('removed');`], {timeout: 10000});
    assert.equal(await mode(globalFile), 0o600);
    await f.app.store.refreshEnvironment(); await f.app.store.syncEnvironment();
    assert.equal(await mode(globalFile), 0o600);
    assert.deepEqual(f.app.store.state.settings.env, {cookie: 'engine-global-fixture'});
    const restarted = await new Store(f.directory).init({seed: false});
    assert.equal(await mode(globalFile), 0o600); assert.equal(await mode(sourceFile), 0o600);
    assert.equal(restarted.state.settings.env.cookie, 'engine-global-fixture');
    assert.equal((await call('delete')).statusCode, 200);
    assert.deepEqual(await f.app.store.readSourceEnvironment(script.id), {});
    assert.equal(await mode(sourceFile), 0o600);
});
