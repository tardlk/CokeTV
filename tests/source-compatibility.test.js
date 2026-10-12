import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {createApp} from '../src/server.js';
import {detectSourceEngine} from '../src/sources.js';

const contract=`let config;
async function init(value){config=value;}
async function home(filter){return {class:[{type_id:'movie',type_name:'电影'}],list:[{vod_id:'home',vod_name:'来自home'}],filter};}
async function homeVod(){return {list:[]};}
async function category(tid,pg,filter,extend){return {list:[],args:{tid,pg,filter,extend},config};}
async function detailContent(ids){return {list:[],ids};}
async function search(wd,quick,pg){return {list:[],args:{wd,quick,pg}};}
async function play(flag='source-default',id,flags='source-flags'){return {parse:0,url:id,args:{flag,flags}};}
async function proxy(params){return [200,'text/plain',String(params.echo||'proxy')];}
async function action(name,value){return {name,value};}
`;
const methods='init,home,homeVod,category,detailContent,search,play,proxy,action';
const sources={default:contract+`export default {${methods}};`,namespace:contract+`export {${methods}};`,alias:contract+`const source={${methods}};export {source as default};`};
async function environment(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-source-compat-')),app=await createApp({directory,seed:false});t.after(async()=>{await app.close();await fs.rm(directory,{recursive:true,force:true});});await app.inject({method:'POST',url:'/admin/access/setup',payload:{password:'fixture-compat',confirmPassword:'fixture-compat'}});const authorization='Basic '+Buffer.from(':fixture-compat').toString('base64');return {app,authorization};}
async function upload(app,authorization,name,bytes){const boundary='compat-upload';return app.inject({method:'POST',url:'/admin/upload',headers:{authorization,'content-type':'multipart/form-data; boundary='+boundary},payload:Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),Buffer.from(bytes),Buffer.from(`\r\n--${boundary}--\r\n`)])});}

test('CatVod模块入口识别覆盖原版default、namespace和default别名导出',async()=>{for(const [name,code]of Object.entries(sources))assert.equal(await detectSourceEngine(name+'.js',code),'cat',name);});
test('CatVod自动文件和ZIP导入保留原版模块成功/失败行为',async t=>{const {app,authorization}=await environment(t);for(const [name,code]of Object.entries(sources)){const r=await upload(app,authorization,name+'.js',code);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().engine,'cat');const id=r.json().id;const result=await app.inject({url:'/api/'+id,headers:{authorization}});if(name==='namespace'){assert.equal(result.statusCode,500);assert.match(result.json().error,/moduleObject.home is not a function/);}else{assert.equal(result.statusCode,200,result.body);assert.equal(result.json().class[0].type_id,'movie');}}
const zip=new AdmZip();zip.addFile('zip-default.js',Buffer.from(sources.default));const imported=await upload(app,authorization,'source.zip',zip.toBuffer());assert.equal(imported.statusCode,200,imported.body);assert.ok(app.store.state.scripts.some(s=>s.file==='zip-default.js'&&s.engine==='cat'));});

test('原版首页契约：空homeVod不覆盖home内已有推荐列表',async t=>{const {app,authorization}=await environment(t);const script=await app.store.saveScript('cat','home-contract.js',sources.default);const r=await app.inject({url:'/api/'+script.id,headers:{authorization}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().list[0]?.vod_name,'来自home');});

test('原版参数契约：play保留源默认参数、search保留空quick、category保留数字页码',async t=>{const {app,authorization}=await environment(t);const script=await app.store.saveScript('cat','argument-contract.js',sources.default);const query=async value=>{const r=await app.inject({url:'/api/'+script.id+'?'+new URLSearchParams(value),headers:{authorization}});assert.equal(r.statusCode,200,r.body);return r.json();};
assert.deepEqual((await query({play:'https://fixture.invalid/video.mp4'})).args,{flag:'source-default',flags:'source-flags'});
assert.deepEqual((await query({wd:'样片',quick:'',pg:'2'})).args,{wd:'样片',quick:'',pg:2});
assert.equal((await query({ac:'list',t:'movie',pg:'-2'})).args.pg,-2);
assert.deepEqual((await query({ac:'detail',ids:'one,two'})).ids,['one','two']);});

test('原版可选筛选契约：显式null与无效ext保持原版的默认处理',async t=>{const {app,authorization}=await environment(t);const script=await app.store.saveScript('cat','filter-contract.js',sources.default);const run=async payload=>{const r=await app.inject({url:'/api/'+script.id,method:'POST',headers:{authorization},payload});assert.equal(r.statusCode,200,r.body);return r.json();};assert.equal((await run({filter:null})).filter,null);assert.deepEqual((await run({ac:'list',t:'movie',ext:'not-json'})).args.extend,{});});

test('原版CatVod运行接口：异步req、local存储及包含ext的初始化对象保持一致',async t=>{const {app,authorization}=await environment(t);const script=await app.store.saveScript('cat','runtime-contract.js',`let config;export default {init:async value=>{config=value;},home:async()=>({class:[]}),homeVod:async()=>({list:[]}),action:async()=>{local.set('compat-fixture','key','stored');const value=local.get('compat-fixture','key');local.delete('compat-fixture','key');return {reqType:req.constructor.name,value,config};}};`);app.store.state.instances.find(i=>i.scriptId===script.id).params='opaque-ext';const r=await app.inject({url:'/api/'+script.id+'?ac=action&action=check',headers:{authorization}});assert.equal(r.statusCode,200,r.body);assert.deepEqual(r.json(),{reqType:'AsyncFunction',value:'stored',config:{stype:4,skey:'catvod_runtime-contract',sourceKey:'catvod_runtime-contract',ext:'opaque-ext'}});});

test('CatVod冷启动保留原版启动时提供的解析、歌词和数据库全局接口',async t=>{const {app,authorization}=await environment(t);const script=await app.store.saveScript('cat','shared-globals.js',`export default {init:async()=>{},home:async()=>({class:[]}),homeVod:async()=>({list:[]}),action:async()=>({extracted:strExtract('value=sample','value=(.*)',1),subtitle:lrcToSrt('[00:01.00]样片\\n[00:02.00]下一行'),databaseType:typeof DataBase,jsonBigType:typeof JsonBig})};`);const r=await app.inject({url:'/api/'+script.id+'?ac=action&action=check',headers:{authorization}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().extracted,'sample');assert.match(r.json().subtitle,/00:00:01,000/);assert.equal(r.json().databaseType,'function');assert.equal(r.json().jsonBigType,'object');});

test('CatVod BaseSpider.fetch的JSON getter冷启动与先加载drpyS行为一致',async t=>{
 const {app,authorization}=await environment(t),server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:'fixture'}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const script=await app.store.saveScript('cat','base-fetch.js',`class Spider extends BaseSpider {init(){}homeContent(){return {class:[]}}homeVideoContent(){return {list:[]}}async categoryContent(){try{const value=(await this.fetch('http://127.0.0.1:${server.address().port}/data')).data;return {list:[{vod_id:value.value,vod_name:'固定样片'}]};}catch{return {list:[]};}}}export default new Spider();`);
 const call=async id=>{const r=await app.inject({url:'/api/'+id+'?ac=list&t=fixture',headers:{authorization}});assert.equal(r.statusCode,200,r.body);return r.json();};const cold=await call(script.id);
 const warmup=await app.store.saveScript('js','warmup.js',"var rule={title:'warmup',host:'https://fixture.invalid',class_parse:async()=>({class:[]}),推荐:async()=>[]};");const warmed=await app.inject({url:'/api/'+warmup.id,headers:{authorization}});assert.equal(warmed.statusCode,200,warmed.body);const warm=await call(script.id);assert.equal(warm.list[0]?.vod_id,'fixture');assert.deepEqual(cold,warm);
});
