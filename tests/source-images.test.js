import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceImages} from '../src/source-images.js';
import {createPlaybackSessions} from '../src/playback.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.js';

test('图片 Referer 绑定随机票据、目标和源，公开出口不扩大权限且不修改源缓存',()=>{
 const sessions=createPlaybackSessions();const original={list:[{vod_pic:'https://img.example/a.jpg@Referer=https://example.com/'}]};
 const result=sourceImages(original,'source-a','https://coketv.example',sessions);
 const url=new URL(result.list[0].vod_pic);const ticket=sessions.get(url.searchParams.get('token'));
 assert.equal(url.pathname,'/mediaProxy');assert.equal(url.searchParams.get('url'),'https://img.example/a.jpg');
 assert.equal(ticket.kind,'proxy');assert.equal(ticket.source,'source-a');assert.equal(ticket.egress,'public');assert.deepEqual(ticket.headers,{Referer:'https://example.com/','User-Agent':'Mozilla/5.0'});
 assert.match(original.list[0].vod_pic,/@Referer=/);assert.notEqual(sourceImages(original,'source-a','https://coketv.example',sessions).list[0].vod_pic,result.list[0].vod_pic);
});
test('普通图片保持不变，异常协议/凭据不能铸造图片票据',()=>{
 const sessions=createPlaybackSessions();
 for(const pic of ['https://img.example/a.jpg','https://img.example/a.jpg@Referer=javascript:alert(1)','file:///etc/passwd@Referer=https://example.com/','https://u:p@img.example/a.jpg@Referer=https://example.com/']){
  const result={list:[{vod_pic:pic}]};assert.deepEqual(sourceImages(result,'a','https://coketv.example',sessions),result);
 }
 assert.deepEqual(sourceImages({class:[]},'a','https://coketv.example',sessions),{class:[]});
});

test('真实图片转发携带 Referer 和固定 UA，保留 Range 且不转发客户端凭据',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-image-ua-'));
 const app=await createApp({directory});
 t.after(async()=>{await app.close();await fs.rm(directory,{recursive:true,force:true});});
 const bytes=Buffer.from([255,216,255,224,0,16,74,70,73,70]);
 app.get('/fixture/poster',(request,reply)=>{
  assert.equal(request.headers.authorization,undefined);assert.equal(request.headers.cookie,undefined);
  assert.equal(request.headers.range,'bytes=0-9');
  if(request.headers.referer!=='https://m.douban.com/'||request.headers['user-agent']!=='Mozilla/5.0')return reply.code(403).send('Image CDN rejected request headers');
  return reply.code(206).header('Content-Range','bytes 0-9/10').type('image/jpeg').send(bytes);
 });
 await app.listen({host:'127.0.0.1',port:0});const base='http://127.0.0.1:'+app.server.address().port;
 const source=await app.store.saveScript('dr3','image-ua.js',`export default {meta:{lang:'dr3'},rule:{},home:async()=>({list:[{vod_id:'one',vod_name:'图片样本',vod_pic:'${base}/fixture/poster@Referer=https://m.douban.com/'}]})};`);
 const data=await (await fetch(base+'/watch/sources/'+source.id)).json();
 const response=await fetch(data.list[0].vod_pic,{headers:{Range:'bytes=0-9',Cookie:'private-client-cookie','User-Agent':'Private Client UA'}});
 assert.equal(response.status,206);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 const tampered=new URL(data.list[0].vod_pic);tampered.searchParams.set('url',base+'/admin/state');
 assert.equal((await fetch(tampered)).status,403);
});
