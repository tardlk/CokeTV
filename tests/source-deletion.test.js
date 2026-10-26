import {ruleFixture} from './helpers/drpy3-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../src/store.js';

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-delete-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const store = await new Store(directory).init({seed: false});
    const code = ruleFixture("var rule={title:'删除样本'};");
    const script = await store.saveScript('dr3', '删除样本.js', code);
    const env = store.sourceEnvPath(script.id);
    await store.atomic(env, '{"fixture":"private"}', {mode: 0o600});
    const cache=path.join(store.runtime,'data/drpy3',createHash('sha256').update(script.id).digest('hex')+'.json');
    await store.atomic(cache,'{"private":"cache"}',{mode:0o600});
    await store.saveScript('dr3', script.file, code + '\n');
    store.state.subscriptions[0].instances = [script.id];
    await store.persist();
    return {store, script, env, cache, code: code + '\n', history: path.join(directory, 'revisions', script.id)};
}

test('同名脚本重新上传恢复缺失实例，保留脚本ID、ENV且不恢复旧订阅授权', async t => {
    const {store, script, code, env} = await fixture(t);
    await store.mutate(state => { state.instances = []; state.subscriptions[0].instances = []; });
    await store.saveScript('dr3', script.file, code);
    assert.equal(store.state.scripts.length, 1);
    assert.equal(store.state.instances.length, 1);
    assert.equal(store.state.instances[0].id, script.id);
    assert.equal(store.state.instances[0].enabled, true);
    assert.deepEqual(store.state.subscriptions[0].instances, []);
    assert.equal(await fs.readFile(env, 'utf8'), '{"fixture":"private"}');
    store.state.instances[0].enabled = false;
    store.state.instances[0].params = 'keep-params';
    await store.saveScript('dr3', script.file, code);
    assert.equal(store.state.instances.length, 1);
    assert.equal(store.state.instances[0].enabled, false);
    assert.equal(store.state.instances[0].params, 'keep-params');
});

test('重复导入内容相同的ZIP恢复孤立脚本实例，不额外创建历史或订阅引用', async t => {
    const {store, script, code, history} = await fixture(t);
    const versions = await fs.readdir(history);
    await store.mutate(state => { state.instances = []; state.subscriptions[0].instances = []; });
    const result = await store.importBundle([{relative: 'spider/js_dr3/' + script.file, engine: 'dr3', code}]);
    assert.equal(result.added, 1);
    assert.equal(store.state.instances[0].scriptId, script.id);
    assert.deepEqual(await fs.readdir(history), versions);
    assert.deepEqual(store.state.subscriptions[0].instances, []);
});

test('默认真删除脚本、历史、ENV及订阅引用，重复ID不会重复操作', async t => {
    const {store,script,env,history,cache}=await fixture(t);
    assert.deepEqual(await store.deleteScripts([script.id,script.id,'missing']),{deleted:1,deletedScripts:1});
    assert.equal(store.state.instances.length,0);assert.equal(store.state.scripts.length,0);
    assert.deepEqual(store.state.subscriptions[0].instances,[]);
    for(const file of [store.scriptPath(script),history,env,cache])await assert.rejects(fs.access(file),{code:'ENOENT'});
});

test('未使用脚本也能真正删除，辅助文件与其他脚本保留',async t=>{
    const {store,script,env,history,cache,code}=await fixture(t);
    const helper=path.join(store.runtime,'spider/js_dr3/_shared.js');await fs.writeFile(helper,'shared helper');
    await store.mutate(state=>{state.instances=[];state.subscriptions[0].instances=[];});
    assert.deepEqual(await store.deleteScripts([script.id]),{deleted:0,deletedScripts:1});
    for(const file of [store.scriptPath(script),history,env,cache])await assert.rejects(fs.access(file),{code:'ENOENT'});
    assert.equal(await fs.readFile(helper,'utf8'),'shared helper');
    await store.saveScript('dr3',script.file,code);assert.equal(store.state.instances.length,1);
});

test('删除共享脚本时一并删除全部关联源、ENV和订阅引用',async t=>{
    const {store,script,env,history,cache}=await fixture(t);
    await store.mutate(state=>{state.instances.push({...state.instances[0],id:'sibling',params:'separate'});state.subscriptions[0].instances.push('sibling');});
    const otherEnv=store.sourceEnvPath('sibling');await fs.writeFile(otherEnv,'{}');
    assert.deepEqual(await store.deleteScripts([script.id]),{deleted:2,deletedScripts:1});
    assert.deepEqual(store.state.instances,[]);assert.deepEqual(store.state.subscriptions[0].instances,[]);
    for(const file of [store.scriptPath(script),history,env,otherEnv,cache])await assert.rejects(fs.access(file),{code:'ENOENT'});
});

test('删除持久化失败时还原脚本、历史、ENV及所有状态', async t => {
    const {store, script, env, history, cache, code} = await fixture(t);
    const before = structuredClone(store.state), disk = await fs.readFile(store.stateFile, 'utf8');
    const persist = store.persist;
    store.persist = async () => { throw new Error('fixture write failure'); };
    await assert.rejects(store.deleteScripts([script.id]), /fixture write failure/);
    store.persist = persist;
    assert.deepEqual(store.state, before);
    assert.equal(await fs.readFile(store.stateFile, 'utf8'), disk);
    assert.equal(await fs.readFile(store.scriptPath(script), 'utf8'), code);
    await fs.access(env); await fs.access(history); await fs.access(cache);
    assert.ok(!(await fs.readdir(path.dirname(history))).some(name => name.endsWith('.rollback')));
});

test('删除使用串行提交时的最新引用，且不清理未选中的孤立脚本', async t => {
    const {store, script} = await fixture(t);
    const orphan = await store.saveScript('dr3', '另一脚本.js', ruleFixture('var rule={};'));
    await store.mutate(state => { state.instances = state.instances.filter(item => item.scriptId !== orphan.id); });
    await Promise.all([
        store.mutate(state => state.instances.push({...state.instances[0], id: 'new-reference'})),
        store.deleteScripts([script.id]),
    ]);
    await assert.rejects(fs.access(store.scriptPath(script)),{code:'ENOENT'}); await fs.access(store.scriptPath(orphan));
    assert.equal(store.state.scripts.length, 1);assert.equal(store.state.instances.length,0);
    assert.deepEqual(await store.deleteScripts(['missing']), {deleted: 0, deletedScripts: 0});
});

test('拒绝通过目录符号链接删除数据目录之外的文件，并回滚状态', async t => {
    const {store, script, env} = await fixture(t);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-delete-outside-'));
    t.after(() => fs.rm(outside, {recursive: true, force: true}));
    await fs.rm(path.dirname(env), {recursive: true});
    await fs.symlink(outside, path.dirname(env));
    const external = path.join(outside, script.id + '.json');
    await fs.writeFile(external, 'keep outside');
    const before = structuredClone(store.state);
    await assert.rejects(store.deleteScripts([script.id]), /数据目录之外/);
    assert.deepEqual(store.state, before);
    assert.equal(await fs.readFile(external, 'utf8'), 'keep outside');
    await fs.access(store.scriptPath(script));
});
