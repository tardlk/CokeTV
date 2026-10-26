import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkShell} from '../scripts/check-shell.mjs';
import {createApp} from '../src/server.js';
test('唯一引擎发行树无预置源，增加旧引擎或脚本时检查失败',async t=>{
    await checkShell();const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-shell-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
    await fs.cp(new URL('../engine',import.meta.url),directory,{recursive:true});
    await fs.mkdir(path.join(directory,'spider/js_dr3'),{recursive:true});await fs.writeFile(path.join(directory,'spider/js_dr3/site.js'),'export default {meta:{},rule:{}};');
    await assert.rejects(checkShell(directory),/发行树/);
});
test('首次部署无源且不启动worker；仅创建drpy3源目录',async t=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-empty-')),app=await createApp({directory});
    t.after(async()=>{await app.close();await fs.rm(directory,{recursive:true,force:true});});
    assert.deepEqual(app.store.state.scripts,[]);assert.equal(app.store.scan,undefined);assert.deepEqual((await app.inject('/watch/sources')).json(),[]);
    assert.deepEqual(await fs.readdir(path.join(app.store.runtime,'spider')),['js_dr3']);assert.equal(app.runner.status().started,false);
    for(const field of ['pythonPath','phpPath','browserPath','plugins'])assert.equal(field in app.store.state.settings,false);
});
