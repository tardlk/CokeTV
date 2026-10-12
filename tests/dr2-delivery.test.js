import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../src/server.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('DR2按原版下发type3客户端脚本；运行库相对依赖与订阅鉴权保持完整',async t=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-dr2-delivery-'));
    const app=await createApp({directory,seed:false});
    t.after(async()=>{await app.close();await fs.rm(directory,{recursive:true,force:true});});
    const code="var rule={title:'DR2固定样本',host:'https://fixture.example.test'};";
    const script=await app.store.saveScript('dr2','fixture.js',code);
    const instance=app.store.state.instances.find(i=>i.scriptId===script.id);
    instance.params='opaque & 中文';
    app.store.state.settings.env={private_fixture_cookie:'never-return-private'};
    const sub=app.store.state.subscriptions[0];sub.token='dr2-fixture';sub.instances=[instance.id];
    const config=(await app.inject('/tvbox/'+sub.token)).json();
    assert.equal(config.sites[0].type,3);
    const runtime=new URL(config.sites[0].api),source=new URL(config.sites[0].ext);
    assert.equal(source.searchParams.get('params'),instance.params);
    const main=await app.inject(runtime.pathname),rule=await app.inject(source.pathname+source.search);
    assert.equal(main.statusCode,200);assert.equal(rule.statusCode,200);assert.equal(rule.body,code);
    assert.equal(rule.body.includes('never-return-private'),false);
    assert.equal((await app.inject(new URL('../dist/drpy-core-lite.min.js',runtime).pathname)).statusCode,200);
    assert.equal((await app.inject(runtime.pathname.replace(sub.token,'wrong'))).statusCode,403);
    assert.equal((await app.inject(source.pathname.replace(sub.token,'wrong'))).statusCode,403);
    assert.equal((await app.inject(runtime.pathname.replace('drpy/drpy2.min.js','dist/unknown.js'))).statusCode,404);
    sub.instances=[];assert.equal((await app.inject(source.pathname)).statusCode,403);
    sub.instances=[instance.id];instance.enabled=false;assert.equal((await app.inject(source.pathname)).statusCode,403);
    instance.enabled=true;sub.enabled=false;assert.equal((await app.inject(runtime.pathname)).statusCode,403);
    sub.enabled=true;sub.token='rotated-fixture';
    assert.equal((await app.inject(runtime.pathname)).statusCode,403);
    assert.equal((await app.inject(source.pathname)).statusCode,403);
    assert.equal((await app.inject(runtime.pathname.replace('dr2-fixture',sub.token))).statusCode,200);
});

test('原版DR2客户端运行库实际加载脚本并返回固定分类，不走drpyS服务端替代',async()=>{
    const runtime=new URL('../engine/client/drpy/drpy2.min.js',import.meta.url).href;
    const code=`console.log=()=>{};Object.assign(globalThis,{pdfh:()=>'',pdfa:()=>[],pd:()=>'',local:{get:()=>'',set:()=>{}}});
    const {default:drpy}=await import(${JSON.stringify(runtime)});
    drpy.init("var rule={title:'fixture',host:'https://fixture.example.test',class_name:'电影',class_url:'movie',推荐:'*',一级:'',二级:'*',搜索:''};");
    process.stdout.write(JSON.stringify({title:drpy.getRule('title'),home:JSON.parse(drpy.home(1))}));`;
    const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{timeout:10000});
    assert.deepEqual(JSON.parse(stdout),{title:'fixture',home:{class:[{type_id:'movie',type_name:'电影'}]}});
});
