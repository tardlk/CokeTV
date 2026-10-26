import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import AdmZip from 'adm-zip';
import {createApp} from '../src/server.js';
import {isDrpy3Source, importBundle} from '../src/sources.js';
import {drpy3Request} from '../src/drpy3.js';

const code = `import {defineSource} from 'drpy3';
export default defineSource({
    meta:{title:'drpy3固定样本',lang:'dr3'},
    rule:{host:'https://fixture.invalid',class_name:'电影',class_url:'movie'},
    async init(ctx,extend){this.fixtureExtend=extend;},
    async homeVod(){return {list:[{vod_id:'one',vod_name:'推荐'}]};},
    async category(ctx,tid,pg,filter,extend){return {page:pg,pagecount:3,list:[{vod_id:tid,vod_name:extend.area||'分类'}]};},
    async search(ctx,wd,quick,pg){return {page:pg,list:[{vod_id:'search',vod_name:wd}]};},
    async detail(ctx,id){return {list:[{vod_id:id,vod_name:'详情',vod_play_from:'direct',vod_play_url:'正片$https://fixture.invalid/video.mp4'}]};},
    async play(ctx,flag,id){return {parse:0,...(flag==='multi'?{urls:['高清',id,'备用',id+'?backup=1']}:{url:id}),header:{Referer:'https://fixture.invalid/'}};},
    async proxy(ctx,params){return [200,'application/octet-stream',params.bytes?'AAH/':'代理',{},params.bytes?1:0];},
    async action(ctx,name,value){
        if(name==='store'){ctx.store.set('value',value);return value;}
        if(name==='http'){const res=await ctx.lib.net.req(value,{buffer:1});return {bytes:[...res.content],status:res.headers.status};}
        if(name==='syncHttp'){const res=ctx.__rt.resolve('syncReq')(value,{buffer:1});return {bytes:[...res.content],status:res.headers.status};}
        if(name==='tools')return {md5:md5('abc'),crypto:typeof CryptoJS,wasm:typeof WebAssembly.instantiate,parsed:ctx.lib.parse.pdfh('<b>标题</b>','b&&Text')};
        return {extend:this.fixtureExtend,value:ctx.store.get('value','empty'),proxy:await ctx.getProxyUrl()};
    }
});`;

async function environment(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-drpy3-test-'));
    const app = await createApp({directory, seed:false});
    t.after(async () => {await app.close(); await fs.rm(directory, {recursive:true, force:true});});
    await app.inject({method:'POST',url:'/admin/access/setup',payload:{password:'fixture-drpy3',confirmPassword:'fixture-drpy3'}});
    const authorization = 'Basic '+Buffer.from(':fixture-drpy3').toString('base64');
    const api = async (id, query = {}) => {
        const response = await app.inject({url:'/api/'+id+'?'+new URLSearchParams(query),headers:{authorization}});
        assert.equal(response.statusCode,200,response.body);
        return response.headers['content-type']?.includes('application/json') ? response.json() : response.body;
    };
    return {app, directory, authorization, api};
}
async function upstream(t, handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    return 'http://127.0.0.1:'+server.address().port;
}

test('仅接受drpy3源标记，拒绝旧脚本和已移除的采集生成器入口',()=>{
    assert.equal(isDrpy3Source(code),true);
    assert.equal(isDrpy3Source('export default {rule:{host:""}};'),true);
    assert.equal(isDrpy3Source('export default {home:async()=>({class:[]})};'),false);
    assert.equal(isDrpy3Source("var rule={lang:'ds'};"),false);
    assert.equal(isDrpy3Source("var rule={lang:'dr2'};"),false);
    assert.equal(isDrpy3Source("import {createCmsSource} from 'coketv/cms'; export default createCmsSource({});"),false);
});

test('drpy3六环节、批量详情、代理二进制、工具全局与公开/订阅入口',async t=>{
    const {app,api,authorization}=await environment(t);
    const script=await app.store.saveScript('dr3','contract.js',code),id=script.id;
    const home=await api(id);assert.equal(home.class[0].type_id,'movie');assert.equal(home.list[0].vod_name,'推荐');
    const category=await api(id,{ac:'list',t:'movie',pg:'2',ext:Buffer.from('{"area":"中国"}').toString('base64')});
    assert.equal(category.page,2);assert.equal(category.list[0].vod_name,'中国');
    assert.equal((await api(id,{wd:'测试',pg:'3'})).list[0].vod_name,'测试');
    assert.deepEqual((await api(id,{ac:'detail',ids:'one,two'})).list.map(item=>item.vod_id),['one','two']);
    const play=await api(id,{flag:'direct',play:'https://fixture.invalid/video.mp4'});assert.equal(play.parse,0);assert.equal(play.header.Referer,'https://fixture.invalid/');
    const multi=await api(id,{flag:'multi',play:'https://fixture.invalid/video.mp4'});assert.equal(multi.url,multi.urls[1]);assert.equal(multi.urls.length,4);
    const web=await app.inject({method:'POST',url:'/watch/sources/'+id+'/play',payload:{flag:'multi',play:'https://fixture.invalid/video.mp4'}});
    assert.equal(web.statusCode,200,web.body);assert.match(web.json().url,/^\/watch\/media\//);
    assert.deepEqual(await api(id,{ac:'action',action:'tools'}),{md5:'900150983cd24fb0d6963f7d28e17f72',crypto:'object',wasm:'function',parsed:'标题'});
    const proxy=await app.inject({url:'/proxy/'+id+'/?bytes=1',headers:{authorization}});assert.equal(proxy.statusCode,200,proxy.body);assert.deepEqual([...proxy.rawPayload],[0,1,255]);
    assert.equal((await app.inject('/watch/sources/'+id)).statusCode,200);
    const sub=app.store.state.subscriptions[0];sub.instances=[id];
    const config=(await app.inject('/tvbox/'+sub.token)).json();assert.equal(config.sites[0].type,4);assert.equal(config.sites[0].engine,'dr3');
    const url=new URL(config.sites[0].api);assert.equal((await app.inject(url.pathname+url.search)).statusCode,200);
    assert.equal((await app.inject('/api/'+id)).statusCode,403);
});

test('drpy3本地解析脚本同时服务网页播放与原生解析入口',async t=>{
    const {app,authorization}=await environment(t);
    const script=await app.store.saveScript('dr3','needs-parser.js',`export default {meta:{lang:'dr3'},rule:{},play:async(ctx,flag,url)=>({parse:1,url})};`);
    await fs.mkdir(path.join(app.store.runtime,'jx'),{recursive:true});
    await fs.writeFile(path.join(app.store.runtime,'jx/native.js'),`export default {meta:{lang:'dr3'},rule:{},play:async(ctx,flag,url)=>({parse:0,url:'https://fixture.invalid/video.m3u8?input='+encodeURIComponent(url)})};`);
    app.store.state.settings.parses=[{name:'本地drpy3',type:2,url:'http://localhost/parse/native'}];
    const target='https://fixture.invalid/item';
    const web=await app.inject({method:'POST',url:'/watch/sources/'+script.id+'/play',payload:{play:target,parser:0}});
    assert.equal(web.statusCode,200,web.body);assert.equal(web.json().type,'m3u8');assert.match(web.json().url,/^\/watch\/media\//);
    const direct=await app.inject({url:'/parse/native?'+new URLSearchParams({url:target}),headers:{authorization}});
    assert.equal(direct.statusCode,200,direct.body);assert.equal(direct.json().parse,0);
    assert.equal(direct.json().url,'https://fixture.invalid/video.m3u8?input='+encodeURIComponent(target));
});

test('drpy3实例参数和持久KV隔离，worker回收后仍可读取',async t=>{
    const {app,api}=await environment(t);
    const script=await app.store.saveScript('dr3','instances.js',code),first=app.store.state.instances.find(i=>i.scriptId===script.id);
    first.params='first';
    const second={...first,id:'second-dr3',params:'second'};app.store.state.instances.push(second);
    assert.equal(await api(first.id,{ac:'action',action:'store',value:'saved'}),'saved');
    const a=await api(first.id,{ac:'action',action:'state'}),b=await api(second.id,{ac:'action',action:'state'});
    assert.equal(a.extend,'first');assert.equal(a.value,'saved');assert.equal(b.extend,'second');assert.equal(b.value,'empty');
    assert.match(a.proxy,new RegExp('/proxy/'+first.id+'/'));assert.match(b.proxy,/\/proxy\/second-dr3\//);
    app.runner.reset();assert.equal((await api(first.id,{ac:'action',action:'state'})).value,'saved');
    const directory=path.join(app.store.runtime,'data/drpy3');
    for(const file of await fs.readdir(directory)) assert.equal((await fs.stat(path.join(directory,file))).mode&0o777,0o600);
});

test('drpy3 ZIP保留ESM模块与WASM字节，实例模块隔离、刷新和重复导入',async t=>{
    const {app,api}=await environment(t),zip=new AdmZip();
    zip.addFile('spider/js_dr3/modules.js',Buffer.from(`import {next} from './lib/counter.mjs';
import wasm from './lib/empty.wasm?bytes';
export default {meta:{lang:'dr3'},rule:{},home:async()=>({class:[]}),homeVod:async()=>({list:[]}),action:async(ctx)=>({count:next(),valid:WebAssembly.validate(wasm),bytes:[...wasm],sum:(await ctx.lib.wasm.load(wasm)).exports.add(20,22)})};`));
    zip.addFile('spider/js_dr3/lib/counter.mjs',Buffer.from('let n=0;export const next=()=>++n;'));
    const bytes=Buffer.from([0,97,115,109,1,0,0,0,1,7,1,96,2,127,127,1,127,3,2,1,0,7,7,1,3,97,100,100,0,0,10,9,1,7,0,32,0,32,1,106,11]);zip.addFile('spider/js_dr3/lib/empty.wasm',bytes);
    assert.equal((await importBundle(app.store,zip.toBuffer())).added,1);
    const first=app.store.state.instances[0],second={...first,id:'modules-second'};app.store.state.instances.push(second);
    const action=id=>api(id,{ac:'action',action:'probe'});
    assert.deepEqual(await action(first.id),{count:1,valid:true,bytes:[...bytes],sum:42});
    assert.equal((await action(first.id)).count,2);assert.equal((await action(second.id)).count,1);
    await api(first.id,{refresh:'1'});assert.equal((await action(first.id)).count,1);
    assert.equal((await importBundle(app.store,zip.toBuffer())).added,0);
    assert.deepEqual(await fs.readFile(path.join(app.store.runtime,'spider/js_dr3/lib/empty.wasm')),bytes);
});

test('drpy3原生异步HTTP：请求体、重定向开关、状态、GBK、buffer与失败契约',async t=>{
    const base=await upstream(t,async(req,res)=>{
        if(req.url==='/redirect'){res.writeHead(302,{location:'/bytes'});res.end();return;}
        if(req.url==='/gbk'){res.setHeader('content-type','text/plain; charset=gbk');res.end(Buffer.from([0xd6,0xd0,0xce,0xc4]));return;}
        if(req.url==='/bytes'){res.end(Buffer.from([0,1,255]));return;}
        let body='';for await(const chunk of req)body+=chunk;res.statusCode=418;res.end(JSON.stringify({url:req.url,method:req.method,body,header:req.headers['x-fixture']}));
    });
    assert.equal((await drpy3Request(base+'/gbk')).content,'中文');
    assert.deepEqual([...(await drpy3Request(base+'/redirect',{buffer:1})).content],[0,1,255]);
    assert.equal((await drpy3Request(base+'/bytes',{buffer:2})).content,'AAH/');
    assert.match((await drpy3Request(base+'/redirect',{redirect:0})).headers.status,/302/);
    const post=await drpy3Request(base+'/echo',{method:'POST',data:{hello:'world'},headers:{'content-type':'application/json','x-fixture':'yes'}});
    assert.match(post.headers.status,/418/);assert.deepEqual(JSON.parse(post.content),{url:'/echo',method:'POST',body:'{"hello":"world"}',header:'yes'});
    assert.equal(JSON.parse((await drpy3Request(base+'/echo',{data:{q:'中文'}})).content).url,'/echo?q=%E4%B8%AD%E6%96%87');
    assert.ok((await drpy3Request('invalid://fixture')).headers.error);
    const {app,api}=await environment(t);const script=await app.store.saveScript('dr3','network.js',code);
    assert.deepEqual((await api(script.id,{ac:'action',action:'http',value:base+'/bytes'})).bytes,[0,1,255]);
    assert.deepEqual((await api(script.id,{ac:'action',action:'syncHttp',value:base+'/bytes'})).bytes,[0,1,255]);
});

test('drpy3 CJS相对模块与bytes资产走上游shim',async t=>{
    const {app,api}=await environment(t),zip=new AdmZip();
    zip.addFile('spider/js_dr3/cjs.js',Buffer.from(`import {defineSource} from 'drpy3';
const helper=require('./lib/helper.cjs');
const bytes=require('./lib/data.wasm?bytes');
module.exports=defineSource({meta:{lang:'dr3'},rule:{},home:async()=>({class:[{type_id:'cjs',type_name:helper.label+bytes.length}]}),homeVod:async()=>({list:[]})});`));
    zip.addFile('spider/js_dr3/lib/helper.cjs',Buffer.from("module.exports={label:'CJS'};"));zip.addFile('spider/js_dr3/lib/data.wasm',Buffer.from([0,255]));
    await importBundle(app.store,zip.toBuffer());assert.equal((await api(app.store.state.instances[0].id)).class[0].type_name,'CJS2');
});

test('drpy3新建与单文件上传可用，发行树仍无预置源',async t=>{
    const {app,authorization,api}=await environment(t);
    assert.deepEqual(app.store.state.scripts,[]);
    const created=await app.inject({url:'/admin/scripts/create',method:'POST',headers:{authorization},payload:{type:'dr3',name:'新源'}});
    assert.equal(created.statusCode,200,created.body);assert.equal(created.json().engine,'dr3');assert.deepEqual((await api(created.json().id)).class,[]);
    const boundary='drpy3-upload';
    const upload=await app.inject({url:'/admin/upload',method:'POST',headers:{authorization,'content-type':'multipart/form-data; boundary='+boundary},payload:Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="uploaded.js"\r\nContent-Type: text/javascript\r\n\r\n${code}\r\n--${boundary}--\r\n`)});
    assert.equal(upload.statusCode,200,upload.body);assert.equal(upload.json().engine,'dr3');assert.equal((await api(upload.json().id)).list[0].vod_name,'推荐');
});

