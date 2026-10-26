import {ruleFixture} from './helpers/drpy3-fixture.js';
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
const params = JSON.stringify({cookie: 'private-param-&"cookie-fixture', nested: {token: 'private-nested-param-fixture'}});
const env = {alias: 'private-env-cookie-fixture', nested: {token: 'private-nested-env-fixture'}};
const globalEnv = {shared: 'private-global-env-fixture'};

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-private-'));
    const app = await createApp({directory, seed: false});
    t.after(async () => { await app.close(); await fs.rm(directory, {recursive: true, force: true}); });

    const setup = await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'private-password', confirmPassword: 'private-password'}});
    assert.equal(setup.statusCode, 200, setup.body);
    const authorization = `Basic ${Buffer.from(':private-password').toString('base64')}`;
    return {app, directory, authorization};
}
const forms = value => [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)];
function assertPrivate(text, secrets) {
    for (const secret of secrets) for (const value of forms(secret)) assert.ok(!text.includes(value), `私密数据未隐藏：${value}`);
    assert.ok(!text.includes('Command failed:'));
}
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
    const targets = ['runtime/config/env.json', 'state.json'].map(relative => path.join(directory, relative));
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

    assert.equal((await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'permission-password', confirmPassword: 'permission-password'}})).statusCode, 200);
    const authorization = `Basic ${Buffer.from(':permission-password').toString('base64')}`;
    const settings = {...app.store.state.settings, env: globalEnv};
    assert.equal((await app.inject({method: 'PUT', url: '/admin/settings', headers: {authorization}, payload: settings})).statusCode, 200);
    assert.equal(await mode(globalFile), 0o600);
    const script = await app.store.saveScript('dr3', '权限样本.js', ruleFixture('var rule={title:"权限样本"};'));
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
    const script = await f.app.store.saveScript('dr3', '引擎权限样本.js', ruleFixture(`var rule={title:'引擎权限样本',host:'https://fixture.invalid',action:async function(name,value){if(name==='delete')ENV.delete('cookie');else ENV.set('cookie',value);return {ok:true};}};`));
    const sourceFile = f.app.store.sourceEnvPath(script.id), globalFile = path.join(f.app.store.runtime, 'config/env.json');
    const call = name => f.app.inject({url: `/api/${script.id}?ac=action&action=${name}&value=engine-source-fixture`, headers: {authorization: f.authorization}});
    assert.equal((await call('set')).statusCode, 200);
    assert.equal(await mode(sourceFile), 0o600);
    assert.equal((await f.app.store.readSourceEnvironment(script.id)).cookie, 'engine-source-fixture');
    // No source scope: execute the retained global ENV API in this temporary
    // runtime, never import/write the release engine's config directory.
    const envModule = pathToFileURL(path.resolve('src/host/utils/env.js')).href;
    await exec(process.execPath, ['--input-type=module', '-e', `const {ENV}=await import(${JSON.stringify(envModule)}); ENV.set('cookie','engine-global-fixture'); ENV.set('removed','fixture'); ENV.delete('removed');`], {timeout: 10000, env: {...process.env, ROOT: f.app.store.runtime}});
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
