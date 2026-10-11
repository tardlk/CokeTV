import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApp} from '../src/server.js';
import {Pan115} from '../src/netdisk/pan115.js';

test('115网页和猫影视默认直连，保留客户端标识、账号与订阅范围，不从NAS读取媒体', async t => {
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-direct-'));
    t.after(()=>fs.rm(directory,{recursive:true,force:true}));
    let mediaRequests=0;
    const upstream=http.createServer((req,res)=>{mediaRequests++;assert.equal(req.headers.cookie,undefined);res.writeHead(206,{'Content-Range':'bytes 0-3/10','Content-Type':'video/mp4'});res.end('0123');});
    await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>upstream.close(resolve)));
    const media=`http://127.0.0.1:${upstream.address().port}/signed-file?signature=fixture`;
    const cookie='UID=123; CID=fixture; SEID=private-direct-cookie', calls=[];
    const app=await createApp({directory,seed:false,netdiskRequest:async options=>{
        calls.push(options);return {status:200,data:{state:true,data:options.url.includes('/snap')?{count:1,list:[{fc:'1',fid:'1',n:'sample.mkv'}]}:{url:{url:media}}}};
    }});
    t.after(()=>app.close());await app.netdisk.accounts.save115(cookie,'web');
    const script=await app.store.saveScript('js','direct.js','var rule={};');
    const source=app.store.state.instances.find(i=>i.scriptId===script.id);
    const [file]=await app.netdisk.files(source.id,'https://115.com/s/fixture');
    const browserUA='FixtureBrowser/1.0';
    const web=await app.inject({method:'POST',url:`/watch/sources/${source.id}/play`,headers:{'user-agent':browserUA},payload:{play:file.reference}});
    assert.equal(web.statusCode,200,web.body);assert.equal(web.json().url,media);assert.equal(web.json().direct,true);assert.equal(web.json().type,'native');
    assert.equal(web.json().headers,undefined);assert.equal(web.json().header,undefined);
    assert.equal(web.body.includes('netdiskRevision'),false);assert.equal(web.body.includes(cookie),false);
    assert.equal(calls.at(-1).headers['User-Agent'],browserUA);
    assert.equal(mediaRequests,0,'取播放地址不能在NAS下载媒体');
    const received=await fetch(web.json().url,{headers:{Range:'bytes=0-3','User-Agent':browserUA}});
    assert.equal(received.status,206);assert.equal(await received.text(),'0123');assert.equal(mediaRequests,1);
    app.store.state.subscriptions.push({id:'direct-sub',token:'direct-token',name:'fixture',enabled:true,instances:[source.id]});
    const cat=await app.inject({method:'POST',url:`/cat/direct-token/api/${source.id}/play`,payload:{id:file.reference}});
    assert.equal(cat.statusCode,200,cat.body);assert.equal(cat.json().url,media);assert.ok(cat.json().header['User-Agent']);
    assert.equal(cat.json().header.Cookie,undefined);assert.equal(cat.body.includes('netdiskRevision'),false);assert.equal(mediaRequests,1);
    const tv=await app.inject(`/api/${source.id}?token=direct-token&play=${encodeURIComponent(file.reference)}`);
    assert.equal(tv.statusCode,200,tv.body);assert.equal(tv.json().url,media);assert.ok(tv.json().header['User-Agent']);
    assert.equal((await app.inject({method:'POST',url:`/cat/bad-token/api/${source.id}/play`,payload:{id:file.reference}})).statusCode,403);
    source.enabled=false;
    assert.equal((await app.inject({method:'POST',url:`/watch/sources/${source.id}/play`,payload:{play:file.reference}})).statusCode,403);
    source.enabled=true;await app.netdisk.accounts.save115(cookie+'; KID=changed','web');
    assert.equal((await app.inject({method:'POST',url:`/watch/sources/${source.id}/play`,payload:{play:file.reference}})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:`/cat/direct-token/api/${source.id}/play`,payload:{id:file.reference}})).statusCode,403);
    assert.equal(mediaRequests,1,'停用或换账号的解析失败不能触发代理回退');
});

test('115取直链时用指定客户端UA签发，旧接口回退App也保持同一UA；非法UA不发请求', async () => {
    const calls=[], ua='FixtureBrowser/2.0';
    const pan=new Pan115({accounts:{cookie:()=> 'UID=123; CID=fixture; SEID=private'},cipher:{encode:()=>({data:'fixture',key:Buffer.alloc(16)}),decode:()=>'{"url":{"url":"https://cdn.example.test/signed"}}'},request:async options=>{
        calls.push(options);return options.url.includes('/webapi/')?{status:200,data:{state:false,errno:50029}}:{status:200,data:{state:true,data:'encoded'}};
    }});
    const file={shareCode:'fixture',receiveCode:'AB12',fileId:'1'};
    const result=await pan.resolveFile(file,{userAgent:ua});
    assert.equal(calls.length,2);assert.ok(calls.every(c=>c.headers['User-Agent']===ua));assert.equal(result.headers['User-Agent'],ua);
    assert.equal(result.headers.Cookie,undefined);
    await assert.rejects(pan.resolveFile(file,{userAgent:'bad\r\nCookie: secret'}),/客户端标识/);
    assert.equal(calls.length,2);
});
