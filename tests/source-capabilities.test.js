import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sourceCapabilities} from '../src/source-capabilities.js';
import {Store} from '../src/store.js';
import {createApp} from '../src/server.js';

const source = (searchable, filterable) => `export default {meta:{title:'声明样本',lang:'dr3'},rule:{searchable:${searchable},filterable:${filterable}},search:async()=>({list:[{vod_id:'one',vod_name:'搜索结果'}]}),home:async()=>({class:[],filters:{}})};`;

test('搜索筛选声明读取数字、布尔值和引用，rule 声明优先于 meta', () => {
    for (const [search, filter, expected] of [
        ['1','1',{searchable:true,filterable:true}], ['2','0',{searchable:true,filterable:false}],
        ['false','true',{searchable:false,filterable:true}], ["'0'","'1'",{searchable:false,filterable:true}],
    ]) assert.deepEqual(sourceCapabilities(source(search, filter)), expected);
    assert.deepEqual(sourceCapabilities(`const off=false;const base={searchable:true,filterable:true};const rule={...base,'searchable':off};export default {meta:{searchable:1},rule};`), {searchable:false,filterable:true});
    assert.deepEqual(sourceCapabilities(`const source={meta:{searchable:false,filterable:true},rule:{}};export {source as default};`), {searchable:false,filterable:true});
    assert.deepEqual(sourceCapabilities(`module.exports={rule:{searchable:0,filterable:1}};`), {searchable:false,filterable:true});
});

test('注释、示例字符串、正则与无关对象不改变能力；解析不执行脚本', () => {
    const code = `// searchable:0, filterable:1
        const unrelated={searchable:0,filterable:1};const sample="rule:{searchable:0,filterable:1}";
        const pattern=/searchable:0/;globalThis.__capabilitySideEffect=true;throw new Error('must not execute');
        export default {meta:{lang:'dr3'},rule:{host:'https://example.invalid'}};`;
    assert.deepEqual(sourceCapabilities(code), {searchable:true,filterable:false});
    assert.equal(globalThis.__capabilitySideEffect, undefined);
    assert.deepEqual(sourceCapabilities(`const rule={searchable:false,filterable:true};export default {rule};`), {searchable:false,filterable:true});
});

test('保存脚本同步能力并保留源名、启用状态、参数、ENV和订阅', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(),'coketv-cap-save-'));
    t.after(() => fs.rm(directory,{recursive:true,force:true}));
    const store = await new Store(directory).init();
    const script = await store.saveScript('dr3','capabilities.js',source('0','0'));
    const instance = store.state.instances.find(item=>item.scriptId===script.id);
    Object.assign(instance,{name:'自定义名字',enabled:false,params:'private-params',tags:['保留标签']});
    const second={...instance,id:'shared-instance',params:'second-params',enabled:true};
    store.state.instances.push(second);
    store.state.subscriptions[0].instances=[instance.id];
    await store.atomic(store.sourceEnvPath(instance.id),JSON.stringify({COOKIE:'private-cookie'}));
    const before=structuredClone(instance),subs=structuredClone(store.state.subscriptions);
    await store.saveScript('dr3','capabilities.js',source('1','1'));
    assert.deepEqual(instance,{...before,searchable:true,filterable:true});
    assert.deepEqual(second,{...before,id:'shared-instance',params:'second-params',enabled:true,searchable:true,filterable:true});
    assert.deepEqual(store.state.subscriptions,subs);
    assert.deepEqual(await store.readSourceEnvironment(instance.id),{COOKIE:'private-cookie'});
    await store.saveScript('dr3','capabilities.js',source('false','false'));
    assert.equal(instance.searchable,false);assert.equal(instance.filterable,false);
});

test('升级启动同步既有源的旧开关，保留缺失脚本和原始文件', async t => {
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-cap-upgrade-'));
    t.after(()=>fs.rm(directory,{recursive:true,force:true}));
    const first=await new Store(directory).init();
    const script=await first.saveScript('dr3','capabilities.js',source('1','1'));
    const item=first.state.instances.find(instance=>instance.scriptId===script.id);
    Object.assign(item,{searchable:false,filterable:false,name:'既有名称',params:'original',enabled:false});
    const missing=await first.saveScript('dr3','missing.js',source('0','0'));
    await fs.rm(first.scriptPath(missing));
    await first.persist();
    const bytes=await fs.readFile(first.scriptPath(script));
    const next=await new Store(directory).init();
    assert.deepEqual(next.state.instances.find(instance=>instance.id===item.id),{...item,searchable:true,filterable:true});
    assert.equal(next.state.scripts.length,2);assert.deepEqual(await fs.readFile(next.scriptPath(script)),bytes);
    assert.deepEqual(next.state.subscriptions,first.state.subscriptions);
});

test('管理接口不能手工覆盖脚本能力，公开页面与订阅同步脚本声明', async t => {
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-cap-api-'));
    const app=await createApp({directory});
    t.after(async()=>{await app.close();await fs.rm(directory,{recursive:true,force:true});});
    const password='capability-admin';
    await app.inject({method:'POST',url:'/admin/access/setup',payload:{password,confirmPassword:password}});
    const headers={authorization:'Basic '+Buffer.from(':'+password).toString('base64')};
    const script=await app.store.saveScript('dr3','capabilities.js',source('1','1'));
    const instance=app.store.state.instances.find(item=>item.scriptId===script.id);
    app.store.state.subscriptions[0].instances=[instance.id];
    const token=app.store.state.subscriptions[0].token;
    const edit=await app.inject({method:'PUT',url:'/admin/instances/'+instance.id,headers,payload:{name:'名称',params:'',enabled:true,searchable:false,filterable:false}});
    assert.equal(edit.statusCode,200,edit.body);assert.equal(edit.json().searchable,true);assert.equal(edit.json().filterable,true);
    assert.equal((await app.inject('/watch/sources')).json()[0].searchable,true);
    const site=(await app.inject('/tvbox/'+token)).json().sites[0];assert.equal(site.searchable,1);assert.equal(site.filterable,1);
    assert.equal((await app.inject('/watch/sources/'+instance.id+'?wd=sample')).statusCode,200);
    const save=await app.inject({method:'POST',url:'/admin/scripts',headers,payload:{engine:'dr3',name:'capabilities.js',code:source('0','0')}});
    assert.equal(save.statusCode,200,save.body);
    const current=(await app.inject('/watch/sources')).json()[0];assert.equal(current.searchable,false);assert.equal(current.filterable,false);
    assert.equal((await app.inject('/watch/sources/'+instance.id+'?wd=sample')).statusCode,400);
});
