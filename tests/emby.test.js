import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApp} from '../src/server.js';

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-emby-'));
    let app = await createApp({directory, seed: false});
    t.after(async () => {await app.close(); await fs.rm(directory, {recursive: true, force: true});});
    const password = 'admin-emby-fixture';
    await app.inject({method:'POST', url:'/admin/access/setup', payload:{password, confirmPassword:password}});
    const headers = {authorization:'Basic ' + Buffer.from(':' + password).toString('base64')};
    const admin = async (url, payload, method = payload === undefined ? 'GET' : 'POST') => {
        const response = await app.inject({url:'/admin/emby' + url, method, headers, ...(payload === undefined ? {} : {payload})});
        assert.equal(response.statusCode,200,response.body); return response.json();
    };
    const script = await app.store.saveScript('js','emby-fixture.js','var rule={};');
    const source = app.store.state.instances.find(s => s.scriptId === script.id);
    app.store.state.subscriptions.push({id:'viewer-sub',name:'观看范围',token:'subscription-secret',enabled:true,instances:[source.id]});
    await app.store.persist();
    const run = async (_source, q) => q.play ? {url:'https://example.invalid/video.mp4',header:{Cookie:'private-media-cookie'},parse:0} : q.ac === 'detail'
        ? {list:[{vod_id:q.ids,vod_name:'剧集 '+q.ids,vod_pic:'',vod_content:'简介',vod_play_from:'高清$$$超清',vod_play_url:'第1集$https://example.invalid/one.mp4#第2集$https://example.invalid/two.mp4$$$第1集$https://example.invalid/one-hd.mp4#第2集$https://example.invalid/two-hd.mp4'}]}
        : {class:[{type_id:'tv',type_name:'剧集'}],list:[{vod_id:'one',vod_name:'剧集 one'},{vod_id:'two',vod_name:'剧集 two'}]};
    app.runner.run = run;
    return {directory, admin, source, get app(){return app;}, async restart(){await app.close();app=await createApp({directory,seed:false});app.runner.run=run;}};
}
async function provision(f) {
    const library = await f.admin('/libraries',{name:'电视剧',sourceId:f.source.id,kind:'Series',category:'tv',pages:1,maxItems:10});
    const job = await f.admin(`/libraries/${library.id}/sync`,{});
    for(let attempt=0;attempt<100;attempt++) {
        const status = await f.admin('/jobs/'+job.id);
        if(status.status==='complete') break;
        assert.notEqual(status.status,'failed',JSON.stringify(status));
        await new Promise(resolve=>setTimeout(resolve,10));
        if(attempt===99) assert.fail('同步没有结束');
    }
    const login = await f.app.inject({method:'POST',url:'/emby/Users/AuthenticateByName',headers:{'x-emby-authorization':'MediaBrowser Client="Infuse-Direct", DeviceId="fixture-device", Device="iPhone", Version="8.5.3"'},payload:{Username:'coke',Pw:'subscription-secret'}});
    assert.equal(login.statusCode,200,login.body);
    return {user:{id:login.json().User.Id},library,login:login.json(),headers:{'x-emby-token':login.json().AccessToken}};
}
test('Emby为订阅输出，无全局开关；未访问协议前零数据库/账户，管理仍鉴权',async t=>{
    const f=await fixture(t);
    await assert.rejects(fs.access(path.join(f.directory,'emby','emby.sqlite')));
    assert.equal((await f.app.inject('/emby/System/Info/Public')).statusCode,200);
    assert.equal((await f.app.inject('/admin/emby')).statusCode,401);
    const state=await f.admin('');assert.equal(state.enabled,undefined);assert.equal(state.users,undefined);assert.equal(state.login.username,'coke');assert.equal(state.basePath,'');assert.deepEqual(state.libraries,[]);
    assert.equal((await f.app.inject({method:'PUT',url:'/admin/emby',payload:{enabled:true}})).statusCode,404);
});
test('Infuse目录/分集/多版本、实际收藏/续播/下一集和退出撤销',async t=>{
    const f=await fixture(t),p=await provision(f);
    const get=async url=>{const r=await f.app.inject({url,headers:p.headers});assert.equal(r.statusCode,200,r.body);return r.json();};
    assert.equal(p.login.SessionInfo.Client,'Infuse-Direct');assert.equal(p.login.User.Policy.IsAdministrator,false);
    const views=await get(`/Users/${p.user.id}/Views`);assert.equal(views.Items[0].Id,p.library.id);
    const folders=await get('/Library/VirtualFolders');assert.equal(folders[0].ItemId,p.library.id);assert.equal(folders[0].CollectionType,'tvshows');
    const preferences=await get('/DisplayPreferences/usersettings');assert.deepEqual(preferences.CustomPrefs,{});
    assert.equal((await f.app.inject({method:'POST',url:'/DisplayPreferences/usersettings',headers:p.headers,payload:{CustomPrefs:{view:'list'}}})).statusCode,204);
    assert.equal((await get('/DisplayPreferences/usersettings')).CustomPrefs.view,'list');
    const series=await get('/emby/Items?IncludeItemTypes=Series&Recursive=true&StartIndex=0&Limit=1');
    assert.equal(series.TotalRecordCount,2);assert.equal(series.Items.length,1);
    const id=series.Items[0].Id;
    const episodes=await get(`/emby/Shows/${id}/Episodes?Fields=Etag,MediaSources,AlternateMediaSources,Genres,Overview,ParentId,ProviderIds`);
    assert.equal(episodes.Items.length,2);const ep=episodes.Items[0];
    for(const key of ['Etag','Genres','Overview','ParentId','SeriesId','SeasonId','MediaSources'])assert.ok(key in ep,key);
    assert.equal(ep.MediaSources.length,2);assert.equal(ep.MediaSources[0].SupportsTranscoding,false);
    assert.equal(JSON.stringify(episodes).includes('private-media-cookie'),false);
    assert.equal(JSON.stringify(episodes).includes('subscription-secret'),false);
    assert.equal((await f.app.inject({method:'POST',url:`/Users/${p.user.id}/FavoriteItems/${id}`,headers:p.headers})).statusCode,200);
    assert.equal((await get('/Items?Filters=IsFavorite&Recursive=true')).Items[0].Id,id);
    const info=await f.app.inject({method:'POST',url:`/Items/${ep.Id}/PlaybackInfo`,headers:p.headers,payload:{MediaSourceId:ep.MediaSources[1].Id}});
    assert.equal(info.statusCode,200,info.body);const play=info.json();assert.ok(play.PlaySessionId);
    const progress=await f.app.inject({method:'POST',url:'/Sessions/Playing/Progress',headers:p.headers,payload:{ItemId:ep.Id,PlaySessionId:play.PlaySessionId,PositionTicks:120000000}});
    assert.equal(progress.statusCode,204,progress.body);
    assert.equal((await get(`/Users/${p.user.id}/Items/Resume`)).Items[0].UserData.PlaybackPositionTicks,120000000);
    assert.equal((await f.app.inject({method:'POST',url:`/Users/${p.user.id}/PlayedItems/${ep.Id}`,headers:p.headers})).statusCode,200);
    assert.equal((await get('/Shows/NextUp')).Items[0].Id,episodes.Items[1].Id);
    const stream=play.MediaSources[0].DirectStreamUrl;
    assert.match(stream,/Videos/);assert.equal(info.body.includes('private-media-cookie'),false);
    const logout=await f.app.inject({method:'POST',url:'/Sessions/Logout',headers:p.headers});assert.equal(logout.statusCode,204);
    assert.equal((await f.app.inject({url:stream,headers:p.headers})).statusCode,401);
});
test('稳定ID/订阅观看身份跨重启；订阅Token不复制入Emby库，会话仅存哈希',async t=>{
    const f=await fixture(t),p=await provision(f);
    const request=async url=>f.app.inject({url,headers:p.headers});
    const before=(await request('/Items?Recursive=true')).json();
    await f.restart();
    assert.deepEqual((await request('/Items?Recursive=true')).json().Items.map(i=>i.Id),before.Items.map(i=>i.Id));
    const bytes=await fs.readFile(path.join(f.directory,'emby','emby.sqlite'));
    assert.equal(bytes.includes(Buffer.from('subscription-secret')),false);assert.equal(bytes.includes(Buffer.from(p.login.AccessToken)),false);
    assert.equal((await fs.stat(path.join(f.directory,'emby','emby.sqlite'))).mode&0o777,0o600);
    assert.equal((await request('/Users/not-mine/Views')).statusCode,403);
    const sub=f.app.store.state.subscriptions.find(s=>s.id==='viewer-sub');sub.instances=[];
    assert.equal((await request('/Items?Recursive=true')).json().Items.length,0);
    sub.instances=[f.source.id];sub.token='rotated';
    assert.equal((await request('/Items')).statusCode,401);
});

test('Emby媒体实际GET/HEAD/Range及多层HLS保持私密头和撤销范围',async t=>{
    const secret='emby-private-upstream-cookie',seen=[];
    const upstream=http.createServer((req,res)=>{
        seen.push(req.url);assert.equal(req.headers.cookie,secret);assert.equal(req.headers.authorization,undefined);
        if(req.url==='/master.m3u8'){res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nchild.m3u8\n');}
        else if(req.url==='/child.m3u8'){res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:10,\nsegment.ts\n');}
        else if(req.headers.range){res.writeHead(206,{'Content-Range':'bytes 2-5/10','Content-Type':'video/mp4','Content-Length':4});res.end('2345');}
        else {res.setHeader('Content-Type','application/octet-stream');res.end('0123456789');}
    });
    await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>upstream.close(resolve)));
    const f=await fixture(t),p=await provision(f);
    await f.app.listen({port:0,host:'127.0.0.1'});const base=`http://127.0.0.1:${f.app.server.address().port}`;f.app.store.state.settings.publicUrl=base;
    const raw=f.app.runner.run;let hls=false;
    f.app.runner.run=async(s,q)=>q.play?{parse:0,url:`http://127.0.0.1:${upstream.address().port}/${hls?'master.m3u8':'media.mp4'}`,header:{Cookie:secret}}:raw(s,q);
    const list=(await f.app.inject({url:'/Items?IncludeItemTypes=Episode&Recursive=true',headers:p.headers})).json();const item=list.Items[0];
    const info=(await f.app.inject({method:'POST',url:`/Items/${item.Id}/PlaybackInfo`,headers:p.headers,payload:{}})).json();
    const stream=info.MediaSources[0].DirectStreamUrl;
    const response=await fetch(stream,{headers:{Range:'bytes=2-5',Cookie:'caller-cookie'}});assert.equal(response.status,206);assert.equal(await response.text(),'2345');
    const head=await fetch(stream,{method:'HEAD',headers:{Range:'bytes=2-5'}});assert.equal(head.status,206);assert.equal(await head.text(),'');
    hls=true;
    const master=await fetch(stream);assert.equal(master.status,200);const body=await master.text();
    assert.equal(body.includes(secret),false);assert.equal(body.includes('subscription-secret'),false);
    const childURL=body.split('\n').find(line=>line.startsWith('http'));
    const child=await fetch(childURL);const childBody=await child.text();assert.equal(child.status,200);
    const keyURL=childBody.match(/URI="([^"]+)"/)[1],segmentURL=childBody.split('\n').find(line=>line.startsWith('http'));
    assert.equal((await fetch(keyURL)).status,200);assert.equal((await fetch(segmentURL)).status,200);
    f.app.store.state.subscriptions.find(s=>s.id==='viewer-sub').instances=[];
    assert.equal((await fetch(keyURL)).status,403);assert.equal((await fetch(segmentURL)).status,403);
    assert.ok(seen.includes('/key.bin'));
});

test('Emby库根目录、元数据etag刷新、失败同步保持目录、订阅Token重置及冲突凭据',async t=>{
    const f=await fixture(t),p=await provision(f);
    const views=(await f.app.inject({url:`/Users/${p.user.id}/Views`,headers:p.headers})).json();
    const lib=views.Items[0];
    assert.equal((await f.app.inject({url:'/Items?ParentId='+lib.ParentId,headers:p.headers})).json().Items[0].Id,lib.Id);
    const before=(await f.app.inject({url:'/Items?IncludeItemTypes=Series&Recursive=true',headers:p.headers})).json().Items[0];
    const old=f.app.runner.run;
    f.app.runner.run=async(s,q)=>{const value=await old(s,q);if(q.ac==='detail')value.list[0].vod_content='更新简介';return value;};
    const sync=await f.admin(`/libraries/${p.library.id}/sync`,{});
    while(['running','queued'].includes((await f.admin('/jobs/'+sync.id)).status))await new Promise(r=>setTimeout(r,10));
    const after=(await f.app.inject({url:'/Items?IncludeItemTypes=Series&Recursive=true',headers:p.headers})).json().Items[0];
    assert.equal(before.Id,after.Id);assert.notEqual(before.Etag,after.Etag);
    f.app.runner.run=async()=>{throw Error('upstream-private-secret');};const failed=await f.admin(`/libraries/${p.library.id}/sync`,{});
    let status;do{await new Promise(r=>setTimeout(r,10));status=await f.admin('/jobs/'+failed.id);}while(['running','queued'].includes(status.status));
    assert.equal(status.status,'failed');assert.equal(JSON.stringify(status).includes('upstream-private-secret'),false);
    assert.equal((await f.app.inject({url:'/Items?IncludeItemTypes=Series&Recursive=true',headers:p.headers})).json().TotalRecordCount,2);
    assert.equal((await f.app.inject({url:'/Items?api_key='+ 'a'.repeat(43),headers:p.headers})).statusCode,401);
    f.app.store.state.subscriptions.find(s=>s.id==='viewer-sub').token='new-subscription-token';
    assert.equal((await f.app.inject({url:'/Items',headers:p.headers})).statusCode,401);
});

test('分页刷新期间固定目录快照，账号范围变化即时生效',async t=>{
    const f=await fixture(t),p=await provision(f);
    const read=async start=>(await f.app.inject({url:`/Items?IncludeItemTypes=Series&Recursive=true&StartIndex=${start}&Limit=1`,headers:p.headers})).json();
    const first=await read(0);assert.equal(first.TotalRecordCount,2);
    const old=f.app.runner.run;
    f.app.runner.run=async(s,q)=>{
        const value=await old(s,q);
        if(q.ac!=='detail'&&!q.play)value.list.push({vod_id:'zero',vod_name:'AAA'});
        if(q.ac==='detail'&&q.ids==='zero')value.list[0].vod_name='AAA';
        return value;
    };
    const job=await f.admin(`/libraries/${p.library.id}/sync`,{});
    for(let attempt=0;attempt<100;attempt++){const j=await f.admin('/jobs/'+job.id);if(j.status==='complete')break;assert.notEqual(j.status,'failed');await new Promise(r=>setTimeout(r,10));}
    const second=await read(1);assert.equal(second.TotalRecordCount,2);assert.notEqual(second.Items[0].Id,first.Items[0].Id);
    assert.equal((await read(0)).TotalRecordCount,3);
    f.app.store.state.subscriptions.find(s=>s.id==='viewer-sub').instances=[];
    assert.equal((await read(1)).TotalRecordCount,0);
});

test('分集不对齐的多线路分别展示作品版本，不把线路伪装成不同季',async t=>{
    const f=await fixture(t),original=f.app.runner.run;
    f.app.runner.run=async(s,q)=>{const value=await original(s,q);if(q.ac==='detail')value.list[0].vod_play_url='第1集$https://example.invalid/one.mp4#第2集$https://example.invalid/two.mp4$$$第2集$https://example.invalid/two-hd.mp4';return value;};
    const p=await provision(f);
    const response=await f.app.inject({url:'/Items?Recursive=true&IncludeItemTypes=Series',headers:p.headers});assert.equal(response.statusCode,200,response.body);
    const series=response.json().Items;assert.equal(series.length,4);assert.ok(series.some(i=>i.Name.includes('[高清]')));assert.ok(series.some(i=>i.Name.includes('[超清]')));
    for(const item of series){const seasons=await f.app.inject({url:`/Shows/${item.Id}/Seasons`,headers:p.headers});assert.equal(seasons.json().Items.length,1);assert.equal(seasons.json().Items[0].IndexNumber,1);}
});

test('根地址无需账号创建：coke+订阅Token定位唯一启用订阅，隔离观看状态并实时撤销',async t=>{
    const f=await fixture(t),p=await provision(f);
    assert.equal((await f.app.inject('/System/Info/Public')).statusCode,200);
    const login=async(token,username='coke')=>f.app.inject({method:'POST',url:'/Users/AuthenticateByName',payload:{Username:username,Pw:token}});
    const original=await login('subscription-secret');assert.equal(original.statusCode,200,original.body);
    assert.equal(original.json().User.Name,'coke');assert.equal(original.json().User.Id,p.user.id);
    const info=await f.admin('');assert.equal(info.users,undefined);assert.equal(info.basePath,'');assert.equal(JSON.stringify(info).includes('subscription-secret'),false);
    assert.equal((await login('subscription-secret','viewer')).statusCode,401);
    assert.equal((await login('wrong-token')).statusCode,401);
    // The old administration surface must no longer create independent accounts.
    assert.equal((await f.app.inject({method:'POST',url:'/admin/emby/users',payload:{name:'other',password:'irrelevant-password'}})).statusCode,404);
    const item=(await f.app.inject({url:'/Items?Recursive=true&IncludeItemTypes=Series',headers:p.headers})).json().Items[0];
    await f.app.inject({method:'POST',url:`/Users/${p.user.id}/FavoriteItems/${item.Id}`,headers:p.headers});
    const other={id:'other-sub',name:'其他订阅',token:'x',enabled:true,instances:[]};f.app.store.state.subscriptions.push(other);
    const second=await login('x');assert.equal(second.statusCode,200,second.body);assert.notEqual(second.json().User.Id,p.user.id);
    const secondHeaders={'x-emby-token':second.json().AccessToken};
    assert.equal((await f.app.inject({url:'/Items?Recursive=true',headers:secondHeaders})).json().Items.length,0);
    assert.equal((await f.app.inject({url:`/Users/${p.user.id}/Views`,headers:secondHeaders})).statusCode,403);
    other.instances=[f.source.id];
    const secondFavorite=await f.app.inject({url:'/Items?Recursive=true&Filters=IsFavorite',headers:secondHeaders});assert.equal(secondFavorite.json().Items.length,0);
    const sub=f.app.store.state.subscriptions.find(s=>s.id==='viewer-sub');sub.token='changed-token';
    assert.equal((await f.app.inject({url:'/Items',headers:p.headers})).statusCode,401);assert.equal((await login('subscription-secret')).statusCode,401);
    const changed=await login('changed-token');assert.equal(changed.statusCode,200,changed.body);assert.equal(changed.json().User.Id,p.user.id);
    const newHeaders={'x-emby-token':changed.json().AccessToken};
    assert.equal((await f.app.inject({url:'/Items?Recursive=true&Filters=IsFavorite',headers:newHeaders})).json().Items[0].Id,item.Id);
    sub.enabled=false;assert.equal((await login('changed-token')).statusCode,401);assert.equal((await f.app.inject({url:'/Items',headers:newHeaders})).statusCode,401);
    sub.enabled=true;other.token=sub.token;
    assert.equal((await login(sub.token)).statusCode,401);assert.equal((await f.app.inject({url:'/Items',headers:newHeaders})).statusCode,401);
    other.enabled=false;assert.equal((await login(sub.token)).statusCode,401,'重复Token即使一个订阅停用也不能任意选择');
    other.token='other-token';f.app.store.state.subscriptions=f.app.store.state.subscriptions.filter(s=>s.id!==sub.id);
    assert.equal((await f.app.inject({url:'/Items',headers:newHeaders})).statusCode,401);
});

test('订阅直接输出Emby：免开关/建库，按订阅源自动准备目录并持久复用',async t=>{
    const f=await fixture(t);let calls=0;const original=f.app.runner.run;
    f.app.runner.run=async(...args)=>{calls++;return original(...args);};
    assert.equal((await f.app.inject('/System/Info/Public')).statusCode,200);
    assert.equal(calls,0,'匿名探测不能执行源');
    assert.equal((await f.app.inject({method:'POST',url:'/Users/AuthenticateByName',payload:{Username:'coke',Pw:'invalid'}})).statusCode,401);
    assert.equal(calls,0);
    const login=await f.app.inject({method:'POST',url:'/Users/AuthenticateByName',payload:{Username:'coke',Pw:'subscription-secret'}});assert.equal(login.statusCode,200,login.body);
    const headers={'x-emby-token':login.json().AccessToken};
    const views=await f.app.inject({url:`/Users/${login.json().User.Id}/Views`,headers});assert.equal(views.statusCode,200,views.body);assert.equal(views.json().Items.length,2);
    assert.deepEqual(views.json().Items.map(i=>i.CollectionType).sort(),['movies','tvshows']);
    const root=await f.app.inject({url:`/Users/${login.json().User.Id}/Items//`,headers});assert.equal(root.statusCode,200,root.body);assert.equal(root.json().Type,'UserRootFolder');
    const list=await f.app.inject({url:'/Items?Recursive=true&IncludeItemTypes=Series',headers});assert.equal(list.statusCode,200,list.body);assert.equal(list.json().TotalRecordCount,2);
    const first=list.json().Items[0];const episodes=await f.app.inject({url:`/Shows/${first.Id}/Episodes`,headers});assert.equal(episodes.json().Items.length,2);
    const folder=views.json().Items.find(i=>i.CollectionType==='tvshows');
    const folderInfo=await f.app.inject({url:`/Users/${login.json().User.Id}/Items/${folder.Id}`,headers});assert.equal(folderInfo.statusCode,200,folderInfo.body);
    const children=await f.app.inject({url:`/Items?ParentId=${folder.Id}`,headers});assert.equal(children.json().TotalRecordCount,2);
    const before=calls;await f.app.inject({url:'/Items?Recursive=true',headers});assert.equal(calls,before,'读取有效缓存不能再次执行全部源');
    await f.restart();const same=await f.app.inject({url:'/Items?Recursive=true&IncludeItemTypes=Series',headers});assert.equal(same.json().Items[0].Id,first.Id);
    const prepare=await f.app.inject({method:'POST',url:'/admin/subscriptions/viewer-sub/emby/prepare',headers:{authorization:'Basic '+Buffer.from(':admin-emby-fixture').toString('base64')},payload:{}});
    assert.equal(prepare.statusCode,200,prepare.body);assert.equal(prepare.json().sources,1);assert.equal(prepare.json().ready,1);
});
