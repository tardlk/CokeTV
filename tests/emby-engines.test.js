import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApp} from '../src/server.js';
import {ROOT} from '../src/paths.js';

async function setup(t,options={}) {
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-emby-engine-'));
    let app=await createApp({directory,seed:false,...options});
    t.after(async()=>{await app.close();await fs.rm(directory,{recursive:true,force:true});});
    await app.inject({method:'POST',url:'/admin/access/setup',payload:{password:'fixture-admin',confirmPassword:'fixture-admin'}});
    const auth={authorization:'Basic '+Buffer.from(':fixture-admin').toString('base64')};
    const admin=async(url,body,method=body===undefined?'GET':'POST')=>{
        const r=await app.inject({url:'/admin/emby'+url,method,headers:auth,...(body===undefined?{}:{payload:body})});assert.equal(r.statusCode,200,r.body);return r.json();
    };
    return {directory,admin,get app(){return app;},async restart(){await app.close();app=await createApp({directory,seed:false,...options});},async account(sourceIds){
        app.store.state.subscriptions.push({id:'test-sub',name:'fixture',token:'private-sub-token',enabled:true,instances:sourceIds});await app.store.persist();
        const r=await app.inject({url:'/Users/AuthenticateByName',method:'POST',payload:{Username:'coke',Pw:'private-sub-token'}});assert.equal(r.statusCode,200,r.body);return {user:{id:r.json().User.Id},headers:{'x-emby-token':r.json().AccessToken},token:r.json().AccessToken};
    }};
}
async function sync(f,library){
    const job=await f.admin(`/libraries/${library.id}/sync`,{});
    for(let attempt=0;attempt<300;attempt++){const state=await f.admin('/jobs/'+job.id);if(state.status==='complete')return;assert.notEqual(state.status,'failed',JSON.stringify(state));await new Promise(r=>setTimeout(r,10));}
    assert.fail('同步超时');
}
test('Emby实际执行五引擎并提供经过鉴权的媒体Range/HEAD，源ID不混合',async t=>{
    const upstream=http.createServer((req,res)=>{res.writeHead(206,{'Content-Range':'bytes 0-3/10','Content-Type':'video/mp4','Content-Length':4});res.end('0123');});
    await new Promise(r=>upstream.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>upstream.close(r)));
    const media=`http://127.0.0.1:${upstream.address().port}/sample.mp4`,f=await setup(t),sourceIds=[];
    for(const engine of ['js','dr2','cat','py','php']){
        const ext=engine==='cat'?'cat.js':engine==='dr2'?'js':engine;
        const code=(await fs.readFile(path.join(ROOT,'tests/fixtures/协议样本.'+ext),'utf8')).replaceAll('https://example.invalid/video.mp4',media);
        const script=await f.app.store.saveScript(engine,'emby-'+engine+(engine==='py'?'.py':engine==='php'?'.php':'.js'),code);
        const source=f.app.store.state.instances.find(i=>i.scriptId===script.id);sourceIds.push(source.id);
        const library=await f.admin('/libraries',{name:engine,sourceId:source.id,kind:'Movie',maxItems:10});await sync(f,library);
    }
    const p=await f.account(sourceIds);await f.app.listen({port:0,host:'127.0.0.1'});f.app.store.state.settings.publicUrl=`http://127.0.0.1:${f.app.server.address().port}`;
    const response=await f.app.inject({url:'/emby/Items?Recursive=true&IncludeItemTypes=Movie',headers:p.headers});assert.equal(response.statusCode,200,response.body);
    const movies=response.json().Items;assert.equal(movies.length,5);assert.equal(new Set(movies.map(i=>i.Id)).size,5);
    for(const movie of movies){const info=await f.app.inject({url:`/Items/${movie.Id}/PlaybackInfo`,headers:p.headers});assert.equal(info.statusCode,200,info.body);
        const url=info.json().MediaSources[0].DirectStreamUrl;
        const actual=await fetch(url,{headers:{Range:'bytes=0-3'}});assert.equal(actual.status,206);assert.equal(await actual.text(),'0123');
        const head=await fetch(url,{method:'HEAD',headers:{Range:'bytes=0-3'}});assert.equal(head.status,206);assert.equal(await head.text(),'');
    }
});

for(const provider of ['115','guangya'])test(`Emby统一${provider}引用清空/重启后按稳定文件身份重新取链，保持UA且NAS不下载媒体`,async t=>{
    let downloads=0,resolveCalls=0,lastUA;const cdn=http.createServer((_req,res)=>{downloads++;res.writeHead(206,{'Content-Range':'bytes 0-3/10'});res.end('0123');});
    await new Promise(r=>cdn.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>cdn.close(r)));
    const media=`http://127.0.0.1:${cdn.address().port}/temporary.mkv?signature=fixture`;
    const request=async options=>{
        if(provider==='115'){
            if(options.url.includes('/snap'))return {status:200,data:{state:true,data:{count:1,list:[{fc:'1',fid:'98765432109876543210',n:'S01E01.mkv'}]}}};
            resolveCalls++;lastUA=options.headers['User-Agent'];return {status:200,data:{state:true,data:{url:{url:media}}}};
        }
        const body=JSON.parse(options.data||'{}');
        if(options.url.endsWith('/get_share_access_token'))return {status:200,data:{code:0,data:{accessToken:'private-share-token'}}};
        if(options.url.endsWith('/get_share_page_files_list'))return {status:200,data:{code:0,data:{list:[{fileId:'98765432109876543210',fileName:'S01E01.mkv',resType:1,fileSize:10}],nextCursor:0}}};
        assert.ok(options.url.endsWith('/get_share_download_url'),options.url);assert.equal(body.fileId,'98765432109876543210');resolveCalls++;return {status:200,data:{code:0,data:{downloadUrl:media}}};
    };
    const f=await setup(t,provider==='115'?{netdiskRequest:request}:{guangyaRequest:request});
    if(provider==='115')await f.app.netdisk.accounts.save115('UID=123; CID=fixture; SEID=private-cookie','web');
    else await f.app.netdisk.guangyaAccounts.save({accessToken:'private-access',refreshToken:'private-refresh',expiresAt:Date.now()+3600000,clientId:'fixture-client',deviceId:'1'.repeat(32)});
    const share=provider==='115'?'https://115.com/s/fixture':'https://www.guangyapan.com/s/fixture';
    const sourceCode=`var rule={title:'Emby fixture',host:'https://example.invalid',推荐:async()=>setResult([{title:'样片',url:'one'}]),二级:async function(){return {vod_id:this.orId,vod_name:'样片',vod_play_from:'网盘',vod_play_url:'正片$${share}'};}};`;
    const script=await f.app.store.saveScript('js','emby-netdisk.js',sourceCode),source=f.app.store.state.instances.find(i=>i.scriptId===script.id);
    const library=await f.admin('/libraries',{name:provider,sourceId:source.id,kind:'Series',maxItems:10});await sync(f,library);
    const p=await f.account([source.id]);
    const before=(await f.app.inject({url:'/Items?Recursive=true&IncludeItemTypes=Episode',headers:p.headers})).json();assert.equal(before.Items.length,1);
    assert.equal(resolveCalls,0,'同步目录不能预取媒体或触发转存');assert.equal(downloads,0);
    await f.restart();await f.app.listen({port:0,host:'127.0.0.1'});f.app.store.state.settings.publicUrl=`http://127.0.0.1:${f.app.server.address().port}`;
    const after=(await f.app.inject({url:'/Items?Recursive=true&IncludeItemTypes=Episode',headers:p.headers})).json();assert.equal(after.Items[0].Id,before.Items[0].Id);
    const info=await f.app.inject({url:`/Items/${after.Items[0].Id}/PlaybackInfo`,headers:p.headers});assert.equal(info.statusCode,200,info.body);
    const stream=info.json().MediaSources[0].DirectStreamUrl;
    const response=await fetch(stream,{redirect:'manual',headers:{'User-Agent':'EmbyFixture/1.0'}});assert.equal(response.status,302);assert.equal(response.headers.get('location'),media);assert.equal(downloads,0);assert.equal(resolveCalls,1);
    if(provider==='115')assert.equal(lastUA,'EmbyFixture/1.0');
    assert.equal((await fetch(response.headers.get('location'))).status,206);assert.equal(downloads,1);
    assert.equal(info.body.includes('private-cookie'),false);assert.equal(info.body.includes('private-access'),false);assert.equal(info.body.includes('private-sub-token'),false);
    f.app.store.state.instances.find(i=>i.id===source.id).enabled=false;
    assert.equal((await fetch(stream,{redirect:'manual'})).status,404);assert.equal(resolveCalls,1);
});
