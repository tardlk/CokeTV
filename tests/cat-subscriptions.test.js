import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createApp} from '../src/server.js';
import {ROOT} from '../src/paths.js';

let app, directory, base, sub, root, client, clientBase, upstream, upstreamBase;
const ids = {}, seen = [];
const credential = 'cat-fixture-subscription';
const secret = 'private-media-cookie';
const json = async (url, body) => {
    const response = await fetch(url, {method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {} : {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: response.status, data: await response.json()};
};
const call = (id, action, body = {}) => json(`${clientBase}/spider/coketv_${id}/3/${action}`, body);

before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-cat-'));
    app = await createApp({directory, seed: false});
    app.store.state.settings.pythonPath = process.env.TEST_PYTHON || path.join(ROOT, '.venv/bin/python3');
    app.store.state.settings.phpPath = process.env.TEST_PHP || path.join(ROOT, '.tools/php/php');
    upstream = http.createServer((req, res) => {
        seen.push({url: req.url, headers: req.headers, method: req.method});
        if (req.url.startsWith('/strict/') && (req.headers.cookie !== secret || req.headers.authorization !== 'Bearer fixture' || req.headers.referer !== 'https://fixture.invalid/')) {
            res.writeHead(403); res.end('required headers missing'); return;
        }
        if (req.url === '/strict/master.m3u8') {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            if(req.headers.range){res.writeHead(206,{'Content-Range':'bytes 0-1/23'});res.end('#E');return;}
            res.end('#EXTM3U\nchild.m3u8\n');return;
        }
        if (req.url === '/strict/child.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\nsegment.ts\n'); return; }
        if (req.url === '/strict/key.bin') { res.end('0123456789abcdef'); return; }
        if (req.url.startsWith('/parser?')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({url: upstreamBase + '/video.mp4'})); return; }
        if (req.headers.range) { res.writeHead(206, {'Content-Type': 'video/mp4', 'Content-Range': 'bytes 2-5/10'}); res.end('2345'); return; }
        res.setHeader('Content-Type', 'video/mp4'); res.end('0123456789');
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    upstreamBase = `http://127.0.0.1:${upstream.address().port}`;
    for (const engine of ['js', 'dr2', 'cat', 'py', 'php']) {
        const suffix = engine === 'dr2' ? 'js' : engine === 'cat' ? 'cat.js' : engine;
        const fixture = await fs.readFile(path.join(ROOT, 'tests/fixtures', `协议样本.${suffix}`), 'utf8');
        const script = await app.store.saveScript(engine, `cat-${engine}.${['py', 'php'].includes(engine) ? engine : 'js'}`, fixture);
        ids[engine] = app.store.state.instances.find(item => item.scriptId === script.id).id;
    }
    const rich = await app.store.saveScript('cat', 'cat-rich.js', `export function __jsEvalReturn(){return {
        init:async()=>{}, home:async()=>({class:[{type_id:'movie',type_name:'电影'}]}), homeVod:async()=>({list:[]}),
        category:async(t,pg,filter,ext)=>({page:pg,pagecount:3,list:[{vod_id:'one',vod_name:JSON.stringify(ext)}]}),
        search:async(wd,quick,pg)=>{if(wd==='fail')throw new Error('fixture upstream failed');return {page:pg,pagecount:3,list:[{vod_id:'one',vod_name:wd}]};},
        detail:async(id)=>({list:[{vod_id:String(id),vod_name:'多线样本',vod_play_from:'线路A$$$线路B',vod_play_url:'第一集$one#第二集$two$$$备选$backup'}]}),
        play:async(flag,id)=>id==='page'?{parse:1,url:'https://fixture.invalid/watch/one'}:{parse:0,url:id==='proxy'?getProxyUrl()+'&hls=1':id,header:{Cookie:${JSON.stringify(secret)},Authorization:'Bearer fixture',Referer:'https://fixture.invalid/'}},
        proxy:async()=>[200,'application/vnd.apple.mpegurl','#EXTM3U\\n'+${JSON.stringify(upstreamBase)}+'/strict/child.m3u8\\n']
    };}`);
    ids.rich = app.store.state.instances.find(item => item.scriptId === rich.id).id;
    const excluded = await app.store.saveScript('cat', 'cat-excluded.js', 'export function __jsEvalReturn(){return {init:async()=>{},home:async()=>({class:[]}),homeVod:async()=>({list:[]})};}');
    ids.excluded = app.store.state.instances.find(item => item.scriptId === excluded.id).id;
    app.store.state.instances.find(item => item.id === ids.rich).params = 'private-source-parameter';
    sub = {id:'cat-fixture',name:'猫影视测试',enabled:true,token:credential,instances:[ids.rich, ...Object.values(ids).filter(id => id !== ids.rich && id !== ids.excluded)]};
    app.store.state.subscriptions.push(sub);
    await app.listen({host:'127.0.0.1',port:0});
    base = `http://127.0.0.1:${app.server.address().port}`;
    root = `${base}/cat/${sub.id}/${credential}`;
});
after(async () => {
    await client?.stop(); delete globalThis.catServerFactory; delete globalThis.catDartServerPort;
    await app?.close(); await new Promise(resolve => upstream?.close(resolve));
    if (directory) await fs.rm(directory,{recursive:true,force:true});
});

test('猫影视四文件、鉴权、最终字节摘要与轻量连接配置', async () => {
    for (const filename of ['index.js','index.config.js']) {
        const response = await fetch(`${root}/${filename}`);
        assert.equal(response.status,200);
        assert.match(response.headers.get('cache-control'),/no-store/);
        const bytes = Buffer.from(await response.arrayBuffer());
        const checksum = await (await fetch(`${root}/${filename}.md5`)).text();
        assert.equal(checksum,createHash('md5').update(bytes).digest('hex'));
        assert.ok(!bytes.includes(Buffer.from(secret)));
        assert.ok(!bytes.includes(Buffer.from('private-source-parameter')));
        await fs.writeFile(path.join(directory, filename.replace('.js','.cjs')),bytes);
    }
    assert.equal((await fetch(root.replace(credential,'invalid')+'/index.js.md5')).status,403);
    assert.equal((await fetch(root.replace(sub.id,'unknown')+'/index.js')).status,403);
    assert.equal((await fetch(root+'/admin.json')).status,404);
    const require = createRequire(import.meta.url);
    client = require(path.join(directory,'index.cjs'));
    const config = require(path.join(directory,'index.config.cjs')).default;
    assert.deepEqual(Object.keys(config).sort(),['endpoint','version']);
    let factoryCalls = 0;
    globalThis.catServerFactory = handler => { factoryCalls++; return http.createServer(handler); };
    const address = await client.start(config);
    assert.equal(address.address,'127.0.0.1');
    assert.equal(factoryCalls,1);
    clientBase = `http://127.0.0.1:${address.port}`;
    assert.deepEqual((await json(clientBase+'/check')).data,{run:true});
});

test('站点发现保持订阅顺序，源增减不改变连接文件，刷新立即读取最新列表', async () => {
    const original = await (await fetch(root+'/index.config.js')).text();
    const config = (await json(clientBase+'/config')).data;
    assert.deepEqual(config.video.sites.map(item=>item.key),sub.instances.map(id=>'nodejs_coketv_'+id));
    assert.ok(!JSON.stringify(config).includes(credential));
    const removed = sub.instances.shift();
    try {
        assert.equal((await json(clientBase+'/config')).data.video.sites.length,sub.instances.length);
        assert.equal((await call(removed,'home')).status,403);
        assert.equal(await (await fetch(root+'/index.config.js')).text(),original);
    } finally { sub.instances.unshift(removed); }
});

for (const engine of ['js','dr2','cat','py','php']) test(`猫影视连接程序实际调用 ${engine} 引擎及 Range 播放`, async () => {
    const id = ids[engine];
    assert.deepEqual((await call(id,'init')).data,{});
    const home = await call(id,'home'); assert.equal(home.status,200); assert.equal(home.data.class[0].type_id,'movie');
    assert.equal((await call(id,'category',{id:'movie',page:2})).data.list[0].vod_name,'movie-2-');
    assert.equal((await call(id,'search',{wd:'中文 + & 搜索',page:2})).data.list[0].vod_name,'中文 + & 搜索');
    assert.ok((await call(id,'detail',{id:'one'})).data.list[0].vod_play_url);
    const play = await call(id,'play',{flag:'测试',id:upstreamBase+'/video.mp4?signature=a%2Bb%24c'});
    assert.equal(play.status,200,JSON.stringify(play.data)); assert.equal(play.data.parse,0);
    assert.ok(play.data.url.startsWith(root+'/media/'));
    const response = await fetch(play.data.url,{headers:{Range:'bytes=2-5'}});
    assert.equal(response.status,206); assert.equal(response.headers.get('content-range'),'bytes 2-5/10'); assert.equal(await response.text(),'2345');
});

test('中文搜索分页、筛选、多线路与明确上游错误', async () => {
    const search = await call(ids.rich,'search',{wd:'中文 + & 搜索',page:2});
    assert.equal(search.data.page,2); assert.equal(search.data.list[0].vod_name,'中文 + & 搜索');
    const category = await call(ids.rich,'category',{id:'movie',page:2,filters:{year:'2026'}});
    assert.equal(category.data.page,2); assert.equal(category.data.list[0].vod_name,'{"year":"2026"}');
    const detail = await call(ids.rich,'detail',{id:['one','two']});
    assert.equal(detail.data.list.length,2);
    assert.equal(detail.data.list[0].vod_play_from,'线路A$$$线路B');
    assert.equal(detail.data.list[0].vod_play_url,'第一集$one#第二集$two$$$备选$backup');
    const failed = await call(ids.rich,'search',{wd:'fail'});
    assert.equal(failed.status,500); assert.match(failed.data.error,/fixture upstream failed/);
    assert.equal((await call(ids.excluded,'home')).status,403);
    assert.equal((await call(ids.rich,'action',{name:'write'})).status,404);
    const instance = app.store.state.instances.find(item=>item.id===ids.rich);
    instance.searchable=false;
    try { assert.equal((await call(ids.rich,'search',{wd:'test'})).status,409); }
    finally { instance.searchable=true; }
});

test('媒体头留在服务端，HLS 主/子/KEY/MAP/分片均在订阅范围内，支持 HEAD 与源代理', async () => {
    const play = await call(ids.rich,'play',{flag:'线路A',id:upstreamBase+'/strict/master.m3u8'});
    assert.equal(play.status,200); assert.deepEqual(play.data.header,{});
    assert.ok(!JSON.stringify(play.data).includes(secret));
    const master = await (await fetch(play.data.url)).text();
    const childUrl = master.split('\n').find(line=>line&&!line.startsWith('#'));
    assert.ok(childUrl.startsWith(root+'/media/'));
    const child = await (await fetch(childUrl)).text();
    const targets = [...child.matchAll(/URI="([^"]+)"/g)].map(m=>m[1]);
    targets.push(child.split('\n').find(line=>line&&!line.startsWith('#')));
    for (const target of targets) {
        assert.ok(target.startsWith(root+'/media/'));
        const response = await fetch(target); assert.equal(response.status,200); await response.arrayBuffer();
        assert.equal((await fetch(target,{method:'HEAD'})).status,200);
    }
    assert.ok(seen.filter(item=>item.url.startsWith('/strict/')).every(item=>item.headers.cookie===secret));
    const proxy = await call(ids.rich,'play',{id:'proxy',flag:'线路A'});
    const proxyMaster = await (await fetch(proxy.data.url)).text();
    assert.ok(proxyMaster.includes(root+'/media/'));
    assert.ok(!proxyMaster.includes('private-source-parameter'));
    assert.equal((await fetch(proxy.data.url.replace(credential,'invalid'))).status,403);
    const source = app.store.state.instances.find(item=>item.id===ids.rich);
    source.enabled=false;
    try { assert.equal((await fetch(childUrl)).status,403); }
    finally { source.enabled=true; }
    sub.enabled=false;
    try { assert.equal((await fetch(targets[0])).status,403); }
    finally { sub.enabled=true; }
    sub.token='rotated';
    try {
        assert.equal((await fetch(childUrl)).status,403);
        assert.equal((await fetch(childUrl.replace(credential,'rotated'))).status,403);
        assert.equal((await fetch(root+'/index.js')).status,403);
    } finally { sub.token=credential; }
});

test('猫影视有效媒体票据不耗尽接口预算，换票据或源不豁免', async () => {
    const oldLimit=process.env.RATE_LIMIT_PER_MINUTE;
    process.env.RATE_LIMIT_PER_MINUTE='3';
    let limited;
    try { limited=await createApp({directory:path.join(directory,'limited'),seed:false}); }
    finally { if(oldLimit===undefined)delete process.env.RATE_LIMIT_PER_MINUTE;else process.env.RATE_LIMIT_PER_MINUTE=oldLimit; }
    try {
        const fixture=await fs.readFile(path.join(ROOT,'tests/fixtures/协议样本.cat.js'),'utf8');
        const script=await limited.store.saveScript('cat','limited.js',fixture);
        const id=limited.store.state.instances.find(item=>item.scriptId===script.id).id;
        limited.store.state.subscriptions.push({id:'rate',name:'限流',enabled:true,token:'rate-token',instances:[id]});
        await limited.listen({host:'127.0.0.1',port:0});
        const rateRoot=`http://127.0.0.1:${limited.server.address().port}/cat/rate/rate-token`;
        const media=await json(`${rateRoot}/api/${id}/play`,{id:upstreamBase+'/video.mp4'});
        assert.equal(media.status,200);
        for(let i=0;i<2;i++)assert.equal((await fetch(rateRoot+'/manifest')).status,200);
        const executions=limited.runner.sequence;
        assert.equal((await json(`${rateRoot}/api/${id}/home`,{})).status,429);
        assert.equal(limited.runner.sequence,executions);
        for(let i=0;i<6;i++){
            const response=await fetch(media.data.url,{headers:{Range:'bytes=2-5'}});
            assert.equal(response.status,206);assert.equal(await response.text(),'2345');
            assert.equal((await fetch(media.data.url,{method:'HEAD'})).status,200);
        }
        assert.equal((await fetch(media.data.url.slice(0,-1)+'!')).status,429);
        assert.equal((await fetch(media.data.url.replace('/media/'+id+'/', '/media/outside/'))).status,429);
    } finally {await limited.close();}
});

test('反向代理子路径下的猫影视源代理媒体可实际读取',async()=>{
    const proxy=http.createServer((req,res)=>{
        const outgoing=http.request(base+req.url.replace(/^\/gateway/,''),{method:req.method,headers:{...req.headers,host:new URL(base).host}},incoming=>{
            res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);
        });outgoing.on('error',()=>{res.writeHead(502);res.end();});req.pipe(outgoing);
    });
    await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
    const publicBase=`http://127.0.0.1:${proxy.address().port}/gateway`;
    app.store.state.settings.publicUrl=publicBase;
    try {
        const play=await json(`${publicBase}/cat/${sub.id}/${credential}/api/${ids.js}/play`,{id:'proxy'});
        assert.equal(play.status,200,JSON.stringify(play.data));
        assert.ok(play.data.url.startsWith(publicBase+'/cat/'));
        const response=await fetch(play.data.url);assert.equal(response.status,200);assert.equal(await response.text(),'hello');
    }finally{app.store.state.settings.publicUrl='';proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
});

test('HLS 清单 Range 探测仍返回完整改写清单，分片 Range 保留',async()=>{
    const play=await json(`${root}/api/${ids.rich}/play`,{id:upstreamBase+'/strict/master.m3u8',flag:'HLS'});
    const response=await fetch(play.data.url,{headers:{Range:'bytes=0-1'}});
    assert.equal(response.status,200);
    const body=await response.text();assert.ok(body.startsWith('#EXTM3U'));assert.ok(body.includes(root+'/media/'));
    const segmentPlay=await json(`${root}/api/${ids.rich}/play`,{id:upstreamBase+'/strict/segment.ts',flag:'HLS'});
    const segment=await fetch(segmentPlay.data.url,{headers:{Range:'bytes=2-5'}});
    assert.equal(segment.status,206);assert.equal(await segment.text(),'2345');
});

test('HLS 播放地址保留清单扩展名，子清单和密钥仍有独立权限',async()=>{
    const play=await json(`${root}/api/${ids.rich}/play`,{id:upstreamBase+'/strict/master.m3u8',flag:'HLS'});
    assert.match(play.data.url,/\/stream\.m3u8$/);
    const master=await(await fetch(play.data.url)).text(),childUrl=master.split('\n').find(x=>x&&!x.startsWith('#'));
    assert.match(childUrl,/\/stream\.m3u8$/);
    const child=await(await fetch(childUrl)).text(),key=child.match(/URI="([^"]+)"/)[1];
    assert.match(key,/\/stream\.bin$/);
    assert.equal((await fetch(key)).status,200);
});

test('服务器 JSON 解析与宿主嗅探分别验证，无嗅探时明确失败；停止和重启不复用旧服务', async () => {
    app.store.state.settings.parses=[{name:'样本解析',type:1,url:upstreamBase+'/parser?url='}];
    try {
        const play=await call(ids.rich,'play',{id:'page',flag:'网页'});
        assert.equal(play.status,200); assert.equal((await fetch(play.data.url)).status,200);
    } finally { app.store.state.settings.parses=[]; }
    assert.equal((await call(ids.rich,'play',{id:'page',flag:'网页'})).status,422);
    const bridge=http.createServer(async(req,res)=>{
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const message=JSON.parse(Buffer.concat(chunks));
        assert.equal(message.action,'sniff');assert.equal(message.opt.url,'https://fixture.invalid/watch/one');
        assert.equal(message.prefix,`/spider/coketv_${ids.rich}/3`);
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:upstreamBase+'/video.mp4',headers:{'user-agent':'sniff-fixture'}}));
    });
    await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));
    globalThis.catDartServerPort=()=>bridge.address().port;
    try {
        const sniffed=await call(ids.rich,'play',{id:'page',flag:'网页'});
        assert.equal(sniffed.status,200);assert.equal(sniffed.data.url,upstreamBase+'/video.mp4');assert.equal(sniffed.data.header['user-agent'],'sniff-fixture');
    } finally {delete globalThis.catDartServerPort;await new Promise(resolve=>bridge.close(resolve));}
    const old=clientBase;
    await client.stop();
    await assert.rejects(fetch(old+'/check'));
    const address=await client.start({version:1,endpoint:root});clientBase=`http://127.0.0.1:${address.port}`;
    assert.equal((await json(clientBase+'/config')).data.video.sites.length,sub.instances.length);
    await client.stop();
});
