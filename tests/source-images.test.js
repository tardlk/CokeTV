import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceImages} from '../src/source-images.js';
import {createPlaybackSessions} from '../src/playback.js';

test('图片 Referer 绑定随机票据、目标和源，公开出口不扩大权限且不修改源缓存',()=>{
 const sessions=createPlaybackSessions();const original={list:[{vod_pic:'https://img.example/a.jpg@Referer=https://example.com/'}]};
 const result=sourceImages(original,'source-a','https://coketv.example',sessions);
 const url=new URL(result.list[0].vod_pic);const ticket=sessions.get(url.searchParams.get('token'));
 assert.equal(url.pathname,'/mediaProxy');assert.equal(url.searchParams.get('url'),'https://img.example/a.jpg');
 assert.equal(ticket.kind,'proxy');assert.equal(ticket.source,'source-a');assert.equal(ticket.egress,'public');assert.deepEqual(ticket.headers,{Referer:'https://example.com/'});
 assert.match(original.list[0].vod_pic,/@Referer=/);assert.notEqual(sourceImages(original,'source-a','https://coketv.example',sessions).list[0].vod_pic,result.list[0].vod_pic);
});
test('普通图片保持不变，异常协议/凭据不能铸造图片票据',()=>{
 const sessions=createPlaybackSessions();
 for(const pic of ['https://img.example/a.jpg','https://img.example/a.jpg@Referer=javascript:alert(1)','file:///etc/passwd@Referer=https://example.com/','https://u:p@img.example/a.jpg@Referer=https://example.com/']){
  const result={list:[{vod_pic:pic}]};assert.deepEqual(sourceImages(result,'a','https://coketv.example',sessions),result);
 }
 assert.deepEqual(sourceImages({class:[]},'a','https://coketv.example',sessions),{class:[]});
});
