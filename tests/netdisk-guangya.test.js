import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {GuangyaAccountStore} from '../src/netdisk/guangya-account.js';
import {Guangya, parseGuangyaShare} from '../src/netdisk/guangya.js';
import {createApp} from '../src/server.js';

const credentials={accessToken:'fixture-access',refreshToken:'fixture-refresh',clientId:'fixture-client',deviceId:'a'.repeat(32),expiresAt:Date.now()+3600000};
const response=data=>({status:200,data:JSON.stringify({msg:'success',data})});
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-guangya-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return new GuangyaAccountStore(dir).init();}
test('光鸭分享精确域名与字符串长ID、提取码解析',()=>{
    assert.deepEqual(parseGuangyaShare('https://www.guangyapan.com/s/9007199254740993123_Example#/share'),{shareId:'9007199254740993123_Example',code:''});
    assert.equal(parseGuangyaShare('https://guangyapan.com/s/example?code=AB12#/share').code,'AB12');
    for(const url of ['https://guangyapan.com.evil.test/s/example','https://x:y@www.guangyapan.com/s/example','https://www.guangyapan.com:123/s/example','https://www.guangyapan.com/s/abc/other','file:///s/example'])assert.throws(()=>parseGuangyaShare(url));
});
test('光鸭凭据0600持久化，刷新保留账号revision，旧刷新不覆盖新登录，损坏文件保留',async t=>{
    const store=await setup(t);await store.save(credentials);const revision=store.status().revision;
    assert.equal(JSON.stringify(store.status()).includes('fixture-access'),false);assert.equal((await fs.stat(store.file)).mode&0o777,0o600);
    await store.updateTokens(revision,{accessToken:'next-access',refreshToken:'next-refresh',expiresAt:credentials.expiresAt});assert.equal(store.status().revision,revision);
    const reload=await new GuangyaAccountStore(path.dirname(store.directory)).init();assert.equal(reload.value().accessToken,'next-access');
    await store.save(credentials);await assert.rejects(store.updateTokens(revision,{accessToken:'stale',refreshToken:'stale'}));assert.equal(store.value().accessToken,credentials.accessToken);
    await fs.writeFile(store.file,'{broken');await assert.rejects(new GuangyaAccountStore(path.dirname(store.directory)).init());assert.equal(await fs.readFile(store.file,'utf8'),'{broken');
});
test('光鸭扫码会话随机引用、不暴露device_code，等待/确认并发只保存一次',async t=>{
    const accounts=await setup(t);let now=100000,status='waiting',exchanges=0;
    const pan=new Guangya({accounts,now:()=>now,request:async options=>{
        if(options.url.endsWith('/device/code'))return {status:200,data:{device_code:'private-device-code',verification_uri_complete:'https://www.guangyapan.com/#/oauth?code=fixture',expires_in:120,interval:3}};
        assert.ok(!options.headers.Authorization);if(status==='waiting')return {status:400,data:{error:'authorization_pending'}};
        exchanges++;return {status:200,data:{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600}};
    }});
    const session=await pan.startLogin();assert.equal(JSON.stringify(session).includes('private-device-code'),false);assert.match(await pan.qrImage(session.id),/^data:image\/png;base64,/);
    assert.equal((await pan.pollLogin(session.id)).status,'waiting');now+=4000;status='confirmed';
    const result=await Promise.all([pan.pollLogin(session.id),pan.pollLogin(session.id)]);assert.equal(exchanges,1);assert.equal(result[0].status,'confirmed');assert.equal(accounts.status().connected,true);assert.equal(JSON.stringify(result).includes('fixture-access'),false);
});
test('光鸭分享令牌、游标分页、子目录、自然排序与不转存取直链',async t=>{
    const accounts=await setup(t);await accounts.save(credentials);const calls=[];
    const pan=new Guangya({accounts,request:async options=>{
        calls.push(options);const body=JSON.parse(options.data);
        if(options.url.endsWith('/get_share_access_token')){assert.equal(body.code,'AB12');return response({accessToken:'private-share-token'});}
        if(options.url.endsWith('/get_share_page_files_list')){
            assert.equal(body.accessToken,'private-share-token');
            assert.equal(typeof body.cursor,'number','实际接口的cursor必须为数字');
            if(!body.parentId&&!body.cursor)return response({total:2,list:[{fileId:'folder',fileName:'正片',resType:2}],cursor:100});
            if(!body.parentId)return response({total:2,list:[{fileId:'subtitle',fileName:'字幕.srt',resType:1}],cursor:200});
            return response({total:2,list:[{fileId:'9007199254740993',fileName:'第10集.mkv',resType:1,fileSize:10},{fileId:'2',fileName:'第2集.mp4',resType:1,fileSize:20}],cursor:100});
        }
        assert.ok(options.url.endsWith('/get_share_download_url'));assert.equal(options.headers.Authorization,'Bearer fixture-access');assert.equal(body.fileId,'2');return response({downloadUrl:'https://cdn.example.test/file.mp4'});
    }});
    const files=await pan.listShare('https://www.guangyapan.com/s/example?code=AB12#/share');assert.deepEqual(files.map(f=>f.name),['第2集.mp4','第10集.mkv']);assert.equal(files[1].fileId,'9007199254740993');
    const media=await pan.resolveFile(files[0]);assert.equal(media.url,'https://cdn.example.test/file.mp4');assert.deepEqual(media.headers,{});assert.equal(JSON.stringify(media).includes('fixture-access'),false);
    assert.ok(calls.every(c=>!c.url.includes('restore_share')&&!c.url.includes('delete_file')));
});
test('光鸭401只刷新一次并原子保存轮换token，下载限制207不绕过或转存',async t=>{
    const accounts=await setup(t);await accounts.save(credentials);let refreshes=0,denied=false;
    const pan=new Guangya({accounts,request:async options=>{
        if(options.url.endsWith('/auth/token')){refreshes++;await new Promise(r=>setTimeout(r,5));return {status:200,data:{access_token:'updated-access',refresh_token:'updated-refresh',expires_in:3600}};}
        if(options.headers.Authorization==='Bearer fixture-access')return {status:401,data:{error:'expired'}};
        if(denied)return {status:200,data:{code:207,msg:'分享者未开启免登录下载'}};
        return response({downloadUrl:'https://cdn.example.test/video.mp4'});
    }});
    const revision=accounts.status().revision,file={shareId:'example',shareToken:'share-token',fileId:'1',name:'sample.mp4'};
    await Promise.all([pan.resolveFile(file),pan.resolveFile(file)]);assert.equal(refreshes,1);assert.equal(accounts.status().revision,revision);assert.equal(accounts.value().refreshToken,'updated-refresh');
    denied=true;await assert.rejects(pan.resolveFile(file),/登录|207/);assert.equal(refreshes,1);
});
test('需要登录的分享必须用账号授权申请分享令牌，不能混用游客分享令牌',async t=>{
    const accounts=await setup(t);await accounts.save(credentials);
    const pan=new Guangya({accounts,request:async options=>{
        const body=JSON.parse(options.data);
        if(options.url.endsWith('/get_share_access_token'))return response({accessToken:options.headers.Authorization?'member-share':'guest-share'});
        if(options.url.endsWith('/get_share_page_files_list'))return response({total:1,list:[{fileId:'1',fileName:'sample.mkv',resType:1}],cursor:100});
        if(body.accessToken==='guest-share')return {status:200,data:{code:207,msg:'分享者未开启免登录下载'}};
        return response({downloadUrl:'https://cdn.example.test/member.mkv'});
    }});
    const [file]=await pan.listShare('https://www.guangyapan.com/s/example#/share');
    assert.equal((await pan.resolveFile(file)).url,'https://cdn.example.test/member.mkv');
});
test('光鸭转存需明确启用，仅在专用目录新增选中文件；并发和重启复用，关闭后不再写云盘',async t=>{
    const accounts=await setup(t);await accounts.save({...credentials,allowTransfer:true});
    const folders=new Map([['',[]]]);let restores=0,creates=0;
    const request=async options=>{
        const body=JSON.parse(options.data),endpoint=new URL(options.url).pathname;
        if(endpoint.endsWith('/get_share_download_url'))return {status:200,data:{code:207,msg:'not public'}};
        if(endpoint.endsWith('/get_file_list')){const list=folders.get(body.parentId)||[];return response(list.length?{list,total:list.length}:{});}
        if(endpoint.endsWith('/create_dir')){creates++;const fileId='folder'+creates;folders.get(body.parentId).push({fileId,fileName:body.dirName,resType:2});folders.set(fileId,[]);return response({fileId});}
        if(endpoint.endsWith('/restore_share')){restores++;assert.deepEqual(body.fileIds,['original']);assert.ok(body.parentId.startsWith('folder'));folders.get(body.parentId).push({fileId:'owned',fileName:'sample.mkv',resType:1,fileSize:10});return response({taskId:'task'});}
        if(endpoint.endsWith('/get_task_status'))return response({status:2,detail:{code:0}});
        assert.ok(endpoint.endsWith('/get_res_download_url'));assert.equal(body.fileId,'owned');assert.equal(body.accessToken,undefined);return response({signedURL:'https://cdn.example.test/owned.mkv'});
    };
    const pan=new Guangya({accounts,request}),file={shareId:'example',shareToken:'share-token',fileId:'original',name:'sample.mkv',size:10};
    const media=await Promise.all([pan.resolveFile(file),pan.resolveFile(file)]);assert.equal(restores,1);assert.equal(creates,2);assert.equal(media[0].url,'https://cdn.example.test/owned.mkv');
    await new Guangya({accounts,request}).resolveFile(file);assert.equal(restores,1);assert.equal(creates,2);
    await accounts.setTransferAllowed(false);await assert.rejects(pan.resolveFile(file),/开启按需转存/);assert.equal(restores,1);
});
test('统一光鸭管理鉴权、真实worker分享交接和三端直连，115与光鸭账号范围独立',async t=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-guangya-host-'));let app;
    t.after(async()=>{await app?.close();await fs.rm(directory,{recursive:true,force:true});});
    app=await createApp({directory,seed:false,guangyaRequest:async options=>{
        if(options.url.endsWith('/user/me'))return {status:200,data:{sub:'fixture'}};
        if(options.url.endsWith('/get_share_access_token'))return response({accessToken:'private-share-token'});
        if(options.url.endsWith('/get_share_page_files_list'))return response({total:1,list:[{fileId:'1',fileName:'视频.mp4',resType:1,fileSize:128}],cursor:100});
        return response({downloadUrl:'https://cdn.example.test/signed.mp4'});
    }});
    await app.listen({host:'127.0.0.1',port:0});
    await app.inject({method:'POST',url:'/admin/access/setup',payload:{password:'guangya-fixture',confirmPassword:'guangya-fixture'}});
    const headers={authorization:'Basic '+Buffer.from(':guangya-fixture').toString('base64')};
    assert.equal((await app.inject('/admin/netdisk')).statusCode,401);
    assert.equal((await app.inject({method:'POST',url:'/%61dmin/netdisk/guangya/account',payload:credentials})).statusCode,401);
    assert.equal((await app.inject({method:'POST',url:'/admin/netdisk/guangya/account',headers:{...headers,origin:'https://foreign.invalid'},payload:credentials})).statusCode,403);
    const imported=await app.inject({method:'POST',url:'/admin/netdisk/guangya/account',headers,payload:credentials});assert.equal(imported.statusCode,200,imported.body);assert.equal(imported.body.includes('fixture-access'),false);
    await app.netdisk.accounts.save115('UID=123; CID=fixture; SEID=private-115','web');const revision115=app.netdisk.status().revision;
    const code="var rule={title:'光鸭样本',host:'https://fixture.invalid',二级:async function(){return {vod_id:this.orId,vod_name:'视频',vod_play_from:'光鸭',vod_play_url:'分享$push://https%3A%2F%2Fwww.guangyapan.com%2Fs%2Fexample%3Fcode%3DAB12%23%2Fshare'};}};";
    const script=await app.store.saveScript('js','光鸭样本.js',code);const id=app.store.state.instances.find(i=>i.scriptId===script.id).id;
    app.store.state.subscriptions.push({id:'gy-sub',token:'gy-token',enabled:true,instances:[id],name:'fixture'});
    const detail=await app.inject(`/watch/sources/${id}?ac=detail&ids=one`);assert.equal(detail.statusCode,200,detail.body);
    const ref=detail.json().list[0].vod_play_url.split('$')[1];assert.match(ref,/^coketv-netdisk:guangya:/);
    const play=await app.inject({method:'POST',url:`/watch/sources/${id}/play`,payload:{play:ref}});assert.equal(play.statusCode,200,play.body);assert.equal(play.json().url,'https://cdn.example.test/signed.mp4');assert.equal(play.json().direct,true);
    const tv=await app.inject(`/api/${id}?token=gy-token&play=${encodeURIComponent(ref)}`);assert.equal(tv.statusCode,200,tv.body);assert.equal(tv.json().url,'https://cdn.example.test/signed.mp4');
    const cat=await app.inject({method:'POST',url:`/cat/gy-token/api/${id}/play`,payload:{id:ref}});assert.equal(cat.statusCode,200,cat.body);assert.equal(cat.json().url,'https://cdn.example.test/signed.mp4');assert.deepEqual(cat.json().header,{});
    const exported=await app.inject({url:'/admin/export',headers});for(const text of ['fixture-access','fixture-refresh','private-share-token']){assert.equal(exported.body.includes(text),false);assert.equal(play.body.includes(text),false);assert.equal(cat.body.includes(text),false);}
    assert.equal((await app.inject({method:'POST',url:`/watch/sources/${id}/play`,payload:{play:ref.replace(':guangya:',':115:')}})).statusCode,403);
    const gyRevision=app.netdisk.guangyaAccounts.status().revision;
    await app.netdisk.guangyaAccounts.updateTokens(gyRevision,{accessToken:'rotated',refreshToken:'rotated-refresh'});assert.equal(app.netdisk.current(gyRevision),true);assert.equal(app.netdisk.current(revision115),true);
    await app.netdisk.guangyaAccounts.save(credentials);assert.equal(app.netdisk.current(gyRevision),false);assert.equal(app.netdisk.current(revision115),true);
    assert.equal((await app.inject({method:'POST',url:`/watch/sources/${id}/play`,payload:{play:ref}})).statusCode,403);
});
