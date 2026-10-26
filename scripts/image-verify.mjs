import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
const base=process.env.SMOKE_URL||'http://127.0.0.1:54058',data=process.env.DATA_DIR||'/app/data';
const expectedFile=process.env.CONTAINER_EXPECTED||'/tmp/coketv-expected-state.json',password='container-smoke-only';
const authorization='Basic '+Buffer.from(':'+password).toString('base64');
const call=async(url,payload,admin=true)=>{const r=await fetch(base+url,{method:payload===undefined?'GET':'POST',headers:{...(admin?{authorization}:{}),...(payload?{'content-type':'application/json'}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});assert.equal(r.status,200,await r.clone().text());return r.json();};
const upstream=http.createServer((req,res)=>{if(req.url==='/list.m3u8'){res.setHeader('content-type','application/vnd.apple.mpegurl');res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nseg.ts\n');return;}if(req.headers.range){res.writeHead(206,{'content-range':'bytes 2-5/10'});res.end('2345');return;}res.end('0123456789');});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const media='http://127.0.0.1:'+upstream.address().port;
try{
 const persistence=process.argv.includes('--persistence');let expected;
 if(persistence){expected=JSON.parse(await fs.readFile(expectedFile));assert.deepEqual((await call('/admin/state')).scripts,expected.scripts);assert.equal((await fetch(base+expected.oldTicket,{headers:{authorization}})).status,403);}
 else{
 const source=await call('/admin/scripts',{name:'image-contract.js',engine:'dr3',code:`export default {meta:{title:'容器验证',lang:'dr3'},rule:{class_name:'电影',class_url:'movie'},homeVod:async()=>({list:[{vod_id:'one',vod_name:'样本'}]}),category:async(ctx,t,p)=>({page:p,list:[{vod_id:'one',vod_name:t}]}),search:async(ctx,wd)=>({list:[{vod_id:'one',vod_name:wd}]}),detail:async(ctx,id)=>({list:[{vod_id:id,vod_name:'样本',vod_play_from:'mp4',vod_play_url:'正片$https://fixture.invalid/movie.mp4'}]}),play:async(ctx,flag,id)=>({parse:0,url:id}),proxy:async()=>[200,'application/octet-stream','AAH/',{},1]};`});
 expected={id:source.id,scripts:(await call('/admin/state')).scripts};
 }
 const id=expected.id;assert.equal((await call('/api/'+id)).class[0].type_id,'movie');assert.equal((await call('/api/'+id+'?ac=list&t=movie&pg=2')).page,2);assert.equal((await call('/api/'+id+'?wd=中文')).list[0].vod_name,'中文');assert.equal((await call('/api/'+id+'?ac=detail&ids=one')).list[0].vod_id,'one');
 assert.equal((await fetch(base+'/api/'+id)).status,403);
 const played=await call('/watch/sources/'+id+'/play',{play:media+'/video.mp4'});
 const range=await fetch(base+played.url,{headers:{authorization,range:'bytes=2-5'}});assert.equal(range.status,206);assert.equal(await range.text(),'2345');
 const head=await fetch(base+played.url,{method:'HEAD',headers:{authorization}});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
 const hls=await call('/watch/sources/'+id+'/play',{play:media+'/list.m3u8'});const playlist=await(await fetch(base+hls.url,{headers:{authorization}})).text();assert.match(playlist,/#EXTM3U/);for(const match of playlist.matchAll(/(?:URI="|\n)(http[^"\n]+)/g))assert.equal((await fetch(match[1],{headers:{authorization}})).status,200);
 const proxy=await fetch(base+'/proxy/'+id+'/',{headers:{authorization}});assert.deepEqual([...new Uint8Array(await proxy.arrayBuffer())],[0,1,255]);
 const child=spawn(process.execPath,[new URL('./verify.mjs',import.meta.url).pathname,id,base,'--password-stdin'],{stdio:['pipe','pipe','pipe']});child.stdin.end(password+'\n');let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);assert.equal(await new Promise(r=>child.on('exit',r)),0,output);
 if(!persistence){expected.oldTicket=played.url;await fs.writeFile(expectedFile,JSON.stringify(expected),{mode:0o600});}
 console.log('drpy3六环节、真实GET/HEAD/Range/HLS/二进制代理、CLI和重启持久化验证通过');
}finally{await new Promise(r=>upstream.close(r));}
