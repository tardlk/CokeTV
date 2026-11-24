import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {EmbyStore} from '../src/emby/store.js';
import {Catalog} from '../src/emby/catalog.js';
import {ruleFixture} from './helpers/drpy3-fixture.js';
import Fastify from 'fastify';
import {registerEmby} from '../src/emby/index.js';

async function fixture(t,episodes=15) {
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-catalog-budget-'));
    const store=await new Store(directory).init(),db=await new EmbyStore(store).init();await db.open();
    t.after(async()=>{await catalog.close();db.close();await fs.rm(directory,{recursive:true,force:true});});
    const script=await store.saveScript('dr3','budget.js',ruleFixture('var rule={};'));
    const source=store.state.instances.find(i=>i.scriptId===script.id);
    const library={id:'budget',name:'目录',sourceId:source.id,kind:'Mixed',automatic:true,pages:1,maxItems:100,category:''};db.put('libraries',library.id,library);
    let selected=['large','small'];
    const content={query:async(_request,_source,q)=>q.ac==='detail'?{list:[{
        vod_id:q.ids,vod_name:q.ids,type_name:q.ids==='small'?'电影':'电视剧',vod_content:'简介'.repeat(2500),
        vod_play_from:'线路',vod_play_url:Array.from({length:q.ids==='large'?episodes:1},(_,i)=>`第${i+1}集$https://example.invalid/${i}.mp4`).join('#'),
    }]}:{list:selected.map(vod_id=>({vod_id}))}};
    const catalog=new Catalog(db,store,content);
    const old=await catalog.build({},library,'watched');
    db.transaction(()=>{for(const row of old)db.put('catalog:budget',row.id,row);});
    const episode=old.find(i=>i.type==='Episode');db.put('userdata','viewer:'+episode.id,{itemId:episode.id,position:500});
    return {store,source,db,catalog,library,old,episode,onlyLarge(){selected=['large'];}};
}

test('自动目录接近20000项时跳过超预算作品，保存可用作品和原观看目录',async t=>{
    const f=await fixture(t);
    f.db.transaction(()=>{for(let i=0;i<19990;i++)f.db.put('catalog:reserve',String(i),{id:String(i)});});
    const job=f.catalog.job(f.library,{});await f.catalog.queue;
    assert.equal(job.status,'complete');assert.equal(job.completed,1);assert.equal(job.errors.length,1);assert.match(job.errors[0].message,/容量/);
    const rows=f.db.all('catalog:budget');assert.equal(rows.length,f.old.length+1);assert.ok(rows.some(i=>i.vodId==='small'));assert.ok(!rows.some(i=>i.vodId==='large'));
    for(const old of f.old)assert.deepEqual(rows.find(i=>i.id===old.id),old);
    assert.equal(f.db.get('userdata','viewer:'+f.episode.id).position,500);
    f.onlyLarge();const failed=f.catalog.job(f.library,{});await f.catalog.queue;assert.equal(failed.status,'failed');assert.deepEqual(f.db.all('catalog:budget'),rows);
});

test('自动目录接近20MiB时保持字节上限并接受能放下的作品',async t=>{
    const f=await fixture(t,300);
    f.db.transaction(()=>{for(let i=0;i<2;i++)f.db.put('catalog:reserve',String(i),{id:String(i),overview:'x'.repeat(9.5*1024*1024)});});
    const job=f.catalog.job(f.library,{});await f.catalog.queue;
    assert.equal(job.status,'complete');assert.equal(job.completed,1);assert.equal(job.errors.length,1);
    assert.ok(f.db.all('catalog:budget').some(i=>i.vodId==='small'));
    const totals=f.db.db.get("SELECT SUM(length(CAST(body AS BLOB))) AS bytes FROM records WHERE namespace LIKE 'catalog:%'");
    assert.ok(totals.bytes<=20*1024*1024);assert.equal(f.db.get('userdata','viewer:'+f.episode.id).position,500);
});

test('旧电影线路条目合并后保留各订阅的收藏和最新进度，旧ID仍可访问且不能越权',async t=>{
    const f=await fixture(t);
    const vod={vod_id:'film',vod_name:'电影',type_name:'电影',vod_play_from:'高清$$$超清',vod_play_url:'上$https://example.invalid/a.mp4#下$https://example.invalid/b.mp4$$$正片$https://example.invalid/c.mp4'};
    f.catalog.content.query=async()=>({list:[vod]});
    let chosen;f.catalog.content.play=async(_r,_s,q)=>{chosen=q;return {url:'https://example.invalid/resolved.mp4',parse:0};};
    const [movie]=await f.catalog.build({},f.library,'film');assert.equal(movie.versions.length,3);
    const legacy=movie.versions.map((version,i)=>({...movie,id:'legacy-film-'+i,name:'旧线路 '+i,versions:[version]}));
    f.db.transaction(()=>{
        for(const item of legacy)f.db.put('catalog:budget',item.id,item);
        f.db.put('userdata','a:legacy-film-0',{id:'a:legacy-film-0',userId:'a',itemId:'legacy-film-0',position:10,favorite:true,updated:10});
        f.db.put('userdata','a:legacy-film-2',{id:'a:legacy-film-2',userId:'a',itemId:'legacy-film-2',position:20,updated:20});
        f.db.put('userdata','b:legacy-film-0',{id:'b:legacy-film-0',userId:'b',itemId:'legacy-film-0',position:99,updated:10});
    });
    const job=f.catalog.job(f.library,{}, {vodId:'film'});await f.catalog.queue;assert.equal(job.status,'complete');
    const current=f.db.all('catalog:budget').filter(i=>i.vodId==='film');assert.equal(current.length,1);assert.equal(current[0].id,movie.id);
    assert.equal(f.db.get('userdata','a:'+movie.id).position,20);assert.equal(f.db.get('userdata','a:'+movie.id).favorite,true);assert.equal(f.db.get('userdata','b:'+movie.id).position,99);
    assert.equal(f.db.get('userdata','a:legacy-film-0').position,10,'保留原始观看记录');
    await f.catalog.play({},movie,movie.versions[2],{});assert.deepEqual(chosen,{play:'https://example.invalid/c.mp4',flag:'超清'});
    const state=f.db.get('userdata','a:'+movie.id);f.db.put('userdata','a:'+movie.id,{...state,favorite:false});
    f.catalog.job(f.library,{}, {vodId:'film'});await f.catalog.queue;assert.equal(f.db.get('userdata','a:'+movie.id).favorite,false,'后续刷新不应重新恢复已取消的收藏');
    const sub=f.store.state.subscriptions[0];sub.token='merge-test';sub.instances=[f.source.id];f.store.state.subscriptions.push({id:'outside',name:'outside',token:'outside',enabled:true,instances:[]});
    f.db.close();
    const app=Fastify();await registerEmby(app,{store:f.store,content:f.catalog.content,baseUrl:()=> 'http://127.0.0.1',serveMedia(){},isNetdiskCurrent:()=>true,targetGuard:async()=>{}});t.after(()=>app.close());
    const login=async password=>(await app.inject({method:'POST',url:'/Users/AuthenticateByName',payload:{Username:'coke',Pw:password}})).json();
    const user=await login('merge-test'),headers={'x-emby-token':user.AccessToken};
    const oldItem=await app.inject({url:'/Items/legacy-film-0',headers});assert.equal(oldItem.statusCode,200,oldItem.body);assert.equal(oldItem.json().Id,movie.id);
    const ids=await app.inject({url:'/Items?Ids=legacy-film-0&Recursive=true',headers});assert.equal(ids.json().Items[0].Id,movie.id);
    const outside=await login('outside');assert.equal((await app.inject({url:'/Items/legacy-film-0',headers:{'x-emby-token':outside.AccessToken}})).statusCode,404);
});

test('旧线路剧集与季、分集的观看状态迁移到合并后的对应分集',async t=>{
    const f=await fixture(t),vod={vod_id:'show',vod_name:'剧集',type_name:'电视剧',vod_play_from:'高清$$$超清',vod_play_url:'第1集$https://example.invalid/1.mp4#第2集$https://example.invalid/2.mp4$$$第2集$https://example.invalid/2hd.mp4#第3集$https://example.invalid/3hd.mp4'};
    f.catalog.content.query=async()=>({list:[vod]});
    const fresh=await f.catalog.build({},f.library,'show'),series=fresh.find(i=>i.type==='Series'),season=fresh.find(i=>i.type==='Season'),episode=fresh.find(i=>i.type==='Episode'&&i.index===2);
    assert.deepEqual(fresh.filter(i=>i.type==='Episode').map(i=>[i.index,i.versions.length]),[[1,1],[2,2],[3,1]]);
    vod.vod_play_from=vod.vod_play_from.split('$$$').reverse().join('$$$');vod.vod_play_url=vod.vod_play_url.split('$$$').reverse().join('$$$');
    assert.deepEqual((await f.catalog.build({},f.library,'show')).map(i=>i.id).sort(),fresh.map(i=>i.id).sort(),'线路顺序变化不能改变影视与分集ID');
    const old=[{...series,id:'old-series'},{...season,id:'old-season',parentId:'old-series',seriesId:'old-series'},{...episode,id:'old-episode',parentId:'old-season',seriesId:'old-series',seasonId:'old-season',versions:[episode.versions[1]]}];
    f.db.transaction(()=>{for(const item of old){f.db.put('catalog:budget',item.id,item);f.db.put('userdata','viewer:'+item.id,{id:'viewer:'+item.id,userId:'viewer',itemId:item.id,favorite:true,position:item.type==='Episode'?123:0,updated:10});}});
    f.catalog.job(f.library,{}, {vodId:'show'});await f.catalog.queue;
    assert.equal(f.db.all('catalog:budget').filter(i=>i.vodId==='show'&&i.type==='Series').length,1);
    assert.equal(f.db.get('userdata','viewer:'+episode.id).position,123);assert.equal(f.db.get('userdata','viewer:'+series.id).favorite,true);
    for(const [oldId,newId]of [['old-series',series.id],['old-season',season.id],['old-episode',episode.id]])assert.equal(f.db.get('aliases',oldId).itemId,newId);
});

test('不在本次推荐中的旧缓存作品也合并，不额外向源站补抓详情',async t=>{
    const f=await fixture(t),vod={vod_id:'cached-film',vod_name:'缓存电影',type_name:'电影',vod_play_from:'高清$$$超清',vod_play_url:'上$https://example.invalid/1.mp4#下$https://example.invalid/2.mp4$$$正片$https://example.invalid/3.mp4'};
    f.catalog.content.query=async()=>({list:[vod]});
    const [movie]=await f.catalog.build({},f.library,'cached-film');
    f.db.transaction(()=>{for(const [i,version]of movie.versions.entries())f.db.put('catalog:budget','old-cached-'+i,{...movie,id:'old-cached-'+i,name:`缓存电影 · ${version.locator.name} [${version.locator.flag}]`,versions:[version]});});
    let details=0;
    f.catalog.content.query=async(_r,_s,q)=>{
        if(q.ac!=='detail')return {list:[{vod_id:'new-film'}]};
        details++;assert.equal(q.ids,'new-film');return {list:[{...vod,vod_id:'new-film',vod_name:'新电影'}]};
    };
    const job=f.catalog.job(f.library,{});await f.catalog.queue;assert.equal(job.status,'complete');assert.equal(details,1);
    const cached=f.db.all('catalog:budget').filter(i=>i.vodId==='cached-film');assert.equal(cached.length,1);assert.equal(cached[0].name,'缓存电影');assert.equal(cached[0].versions.length,3);
    assert.deepEqual(cached[0].versions.map(v=>v.id),movie.versions.map(v=>v.id));
});
