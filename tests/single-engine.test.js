import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../src/server.js';
import {Store} from '../src/store.js';
import {ENGINE_DIRS} from '../src/paths.js';
import {importBundle} from '../src/sources.js';
import AdmZip from 'adm-zip';
const native="export default {meta:{lang:'dr3',title:'已迁移'},rule:{class_name:'电影',class_url:'movie'}};";
async function legacy(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-migration-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const store=await new Store(directory).init({seed:false});
 const engines={js:'js',dr2:'js_dr2',cat:'catvod',py:'py',php:'php'};
 const originals={};
 for(const [engine,dir]of Object.entries(engines)){
  const id='old-'+engine,file='source.'+(engine==='py'?'py':engine==='php'?'php':'js');
  store.state.scripts.push({id,engine,file,name:engine});store.state.instances.push({id,scriptId:id,name:engine,params:'private-param',enabled:true,searchable:true});store.state.subscriptions[0].instances.push(id);
  const target=store.scriptPath({engine,file});await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,'old-'+engine);
  const env=store.sourceEnvPath(id);await store.atomic(env,'{"cookie":"private-fixture"}',{mode:0o600});originals[target]=await fs.readFile(target);originals[env]=await fs.readFile(env);
 }
 store.state.version=1;store.state.settings.pythonPath='python-fixture';store.state.settings.phpPath='php-fixture';await store.persist();
 originals[store.stateFile]=await fs.readFile(store.stateFile);return {directory,originals};
}
test('唯一引擎、旧格式文件和ZIP不能重新开启旧执行路径',async t=>{
 assert.deepEqual(ENGINE_DIRS,{dr3:'js_dr3'});const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-only-')),app=await createApp({directory,seed:false});
 t.after(async()=>{await app.close();await fs.rm(directory,{recursive:true,force:true});});
 for(const old of ['js','dr2','cat','py','php'])await assert.rejects(app.store.saveScript(old,'old.js','var rule={};'));
 const zip=new AdmZip();zip.addFile('spider/js/old.js',Buffer.from('var rule={};'));await assert.rejects(importBundle(app.store,zip.toBuffer()),/目录|源包/);
 assert.equal((await app.inject('/tvbox/wrong/runtime/drpy/drpy2.min.js')).statusCode,404);
 for(const url of ['/admin/import/tvbox/preview','/admin/import/tvbox'])assert.equal((await app.inject({method:'POST',url,payload:{url:'https://example.com/config.json'}})).statusCode,404);
});
test('v1升级备份原文件、停用旧源且保留订阅和ENV；重启不重复迁移',async t=>{
 const {directory,originals}=await legacy(t),store=await new Store(directory).init({seed:false});assert.equal(store.state.version,2);assert.equal(store.state.instances.length,5);
 for(const i of store.state.instances){assert.equal(i.enabled,false);assert.equal(i.migrationRequired,true);assert.equal(i.params,'private-param');assert.equal((await store.readSourceEnvironment(i.id)).cookie,'private-fixture');assert.throws(()=>store.resolve(i.id),/迁移/);}
 for(const [file,content]of Object.entries(originals)){
  const saved=path.join(directory,store.state.migration.backup,path.relative(directory,file));assert.deepEqual(await fs.readFile(saved),content);assert.equal((await fs.stat(saved)).mode&0o777,0o600);
  if(file!==store.stateFile)assert.deepEqual(await fs.readFile(file),content);
 }
 const backup=store.state.migration.backup;await new Store(directory).init({seed:false});assert.deepEqual(await fs.readdir(path.join(directory,'backups')),[path.basename(backup)]);
 assert.equal(store.state.subscriptions[0].instances.length,5);
});
test('管理端能读旧脚本并保存为drpy3，保持实例ID/订阅/参数/ENV，公开入口过滤待迁移源',async t=>{
 const {directory}=await legacy(t),app=await createApp({directory,seed:false});t.after(()=>app.close());
 await app.inject({method:'POST',url:'/admin/access/setup',payload:{password:'migration-fixture',confirmPassword:'migration-fixture'}});const headers={authorization:'Basic '+Buffer.from(':migration-fixture').toString('base64')};
 assert.deepEqual((await app.inject('/watch/sources')).json(),[]);
 const sub=app.store.state.subscriptions[0];assert.deepEqual((await app.inject('/tvbox/'+sub.token)).json().sites,[]);assert.deepEqual((await app.inject('/cat/'+sub.token+'/manifest')).json().sites,[]);
 assert.equal((await app.inject({url:'/admin/scripts/old-js',headers})).json().code,'old-js');
 assert.equal((await app.inject({method:'POST',url:'/admin/instances/batch',headers,payload:{ids:['old-js'],enabled:true}})).statusCode,400);
 const response=await app.inject({method:'POST',url:'/admin/scripts/old-js/migrate',headers,payload:{name:'migrated.js',code:native}});assert.equal(response.statusCode,200,response.body);
 const instance=app.store.state.instances.find(i=>i.id==='old-js');assert.equal(instance.scriptId,response.json().id);assert.equal(instance.enabled,true);assert.equal(instance.params,'private-param');assert.equal((await app.store.readSourceEnvironment(instance.id)).cookie,'private-fixture');assert.ok(sub.instances.includes(instance.id));
 assert.equal((await app.inject('/watch/sources')).json().length,1);assert.equal((await app.inject('/watch/sources/old-js')).statusCode,200);
 assert.equal((await app.inject('/tvbox/'+sub.token)).json().sites[0].type,4);assert.equal((await app.inject('/cat/'+sub.token+'/manifest')).json().sites[0].id,'old-js');
 const second=await app.inject({method:'POST',url:'/admin/scripts/old-cat/migrate',headers,payload:{name:'migrated.js',code:native}});assert.equal(second.statusCode,200,second.body);assert.notEqual(second.json().id,response.json().id);assert.match(second.json().file,/migrated-[a-f0-9]+\.js/);
});
test('迁移写入失败回滚脚本及所有实例引用',async t=>{
 const {directory}=await legacy(t),store=await new Store(directory).init({seed:false}),before=structuredClone(store.state);store.persist=async()=>{throw Error('disk-full');};
 await assert.rejects(store.migrateScript('old-js','new.js',native),/disk-full/);assert.deepEqual(store.state,before);await assert.rejects(fs.access(path.join(store.runtime,'spider/js_dr3/new.js')));
});
test('源读取私有json经内部回环，重定向不泄露内部凭据',async t=>{
 const http=await import('node:http');let received;
 const external=http.createServer((req,res)=>{received=req.headers['x-drpy-runtime'];res.end('external');});await new Promise(r=>external.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>external.close(r)));
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-internal-')),app=await createApp({directory,seed:false});t.after(async()=>{await app.close();await fs.rm(directory,{recursive:true,force:true});});
 app.get('/redirect-fixture',async(_,reply)=>reply.redirect('http://127.0.0.1:'+external.address().port+'/destination'));
 await fs.writeFile(path.join(app.store.runtime,'json/private.json'),'{"fixture":"private"}');
 const script=await app.store.saveScript('dr3','internal.js',`export default {meta:{lang:'dr3'},rule:{},action:async(ctx,name)=>{const env=ctx.__rt.hostEnv.env;return (await ctx.req(name==='json'?env.jsonUrl+'private.json':env.requestHost+'/redirect-fixture')).content;}};`);
 await app.inject({method:'POST',url:'/admin/access/setup',payload:{password:'internal-fixture',confirmPassword:'internal-fixture'}});await app.listen({host:'127.0.0.1',port:0});const headers={authorization:'Basic '+Buffer.from(':internal-fixture').toString('base64')};
 assert.equal((await app.inject('/json/private.json')).statusCode,403);
 const result=await app.inject({url:'/api/'+script.id+'?ac=action&action=json',headers});assert.equal(result.statusCode,200,result.body);assert.equal(result.body,'{"fixture":"private"}');
 assert.equal((await app.inject({url:'/api/'+script.id+'?ac=action&action=redirect',headers})).body,'external');assert.equal(received,undefined);
});
