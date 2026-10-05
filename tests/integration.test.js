import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {gzipSync} from 'node:zlib';
import AdmZip from 'adm-zip';
import {createApp} from '../src/server.js';
import {ROOT} from '../src/paths.js';

let app, directory, authorization, base;
const ids = {};
const engines = ['js', 'cat', 'py', 'php', 'dr2'];
before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'drpy-http-'));
    app = await createApp({directory, seed: false});
    const credentials = JSON.parse(await fs.readFile(path.join(directory, 'admin.json')));
    assert.equal(credentials.password,undefined);
    assert.equal((await app.inject({url:'/admin/state',headers:{authorization:'Basic '+Buffer.from(':111111').toString('base64')}})).statusCode,428);
    const setupPassword='integration-password';
    assert.equal((await app.inject({url:'/admin/access/setup',method:'POST',payload:{password:setupPassword,confirmPassword:setupPassword}})).statusCode,200);
    credentials.password=setupPassword;
    authorization = `Basic ${Buffer.from(`:${credentials.password}`).toString('base64')}`;
    const localPython = path.join(ROOT, '.tools/python/bin/python3'), localPhp = path.join(ROOT, '.tools/php/php');
    app.store.state.settings.pythonPath = process.env.TEST_PYTHON || await fs.access(localPython).then(() => localPython).catch(() => 'python3');
    app.store.state.settings.phpPath = process.env.TEST_PHP || await fs.access(localPhp).then(() => localPhp).catch(() => 'php');
    for (const engine of engines) {
        const fixture = engine === 'dr2' ? 'js' : engine === 'cat' ? 'cat.js' : engine;
        const code = await fs.readFile(path.join(ROOT, 'tests/fixtures', `协议样本.${fixture}`), 'utf8');
        const script = await app.store.saveScript(engine, `协议样本${engine === 'cat' || engine === 'dr2' ? '.js' : '.' + engine}`, code);
        ids[engine] = script.id;
    }
    await app.listen({host: '127.0.0.1', port: 0}); base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { await app?.close(); if (directory) await fs.rm(directory, {recursive: true, force: true}); });
const call = async (url, options = {}) => {
    const response = await app.inject({url, headers: {authorization}, ...options});
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
};

test('后台登录与空闲启动：管理页面/订阅不会启动任何引擎', async () => {
    assert.equal((await app.inject('/admin/state')).statusCode, 401);
    assert.equal((await app.inject('/')).statusCode, 200);
    const result = await call('/admin/state');
    assert.equal(result.runtime.started, false);
    assert.equal(app.runner.child, null);
    const password=JSON.parse(await fs.readFile(path.join(directory,'admin.json'))).password;
    for(const invalid of ['Basic '+Buffer.from(':wrong').toString('base64'),'Basic '+Buffer.from('no-separator').toString('base64')]){
        assert.equal((await app.inject({url:'/admin/state',headers:{authorization:invalid}})).statusCode,401);
    }
    assert.equal((await app.inject({url:'/admin/state',headers:{authorization:'Basic '+Buffer.from('legacy-name:'+password).toString('base64')}})).statusCode,200);
    assert.equal(JSON.parse(await fs.readFile(path.join(directory,'admin.json'))).username,undefined);
});
for (const engine of engines) test(`${engine} 引擎：中文源名、首页、分类、搜索、详情、播放和代理`, async () => {
    const id = ids[engine];
    const home = await call(`/api/${id}`);
    const publicHome = await app.inject(`/watch/sources/${id}`);
    assert.equal(publicHome.statusCode, 200, publicHome.body);
    assert.equal(publicHome.json().list[0].vod_name, '样本电影');
    assert.equal(home.class[0].type_id, 'movie');
    assert.equal(home.list[0].vod_name, '样本电影');
    const category = await call(`/api/${id}?ac=list&t=movie&pg=2`);
    assert.equal(category.list[0].vod_name, 'movie-2-');
    const search = await call(`/api/${id}?wd=${encodeURIComponent('中文搜索')}`);
    assert.equal(search.list[0].vod_name, '中文搜索');
    const detail = await call(`/api/${id}?ac=detail&ids=one`);
    assert.equal(detail.list[0].vod_id, 'one');
    assert.ok(detail.list[0].vod_play_url.includes('.mp4'));
    const play = await call(`/api/${id}?play=https://example.invalid/video.mp4&flag=test`);
    assert.equal(play.url, 'https://example.invalid/video.mp4');
    const proxy = await app.inject({url: `/proxy/${id}/`, headers: {authorization}});
    assert.equal(proxy.statusCode, 200, proxy.body); assert.equal(proxy.body, 'hello');
});
test('订阅范围、站点参数隔离、热更新与旧路径', async () => {
    const original = app.store.state.instances.find(s => s.id === ids.js);
    const instance = await call('/admin/instances', {method: 'POST', payload: {...original, name: '第二参数实例', params: 'second'}});
    const sameParams = await call('/admin/instances', {method: 'POST', payload: {...original, name: '同参数实例', params: ''}});
    const samePlay = await call(`/api/${sameParams.id}?play=proxy`);
    assert.equal(new URL(samePlay.url).pathname, `/proxy/${sameParams.id}/`);
    const legacyPlay = await call(`/api/${sameParams.id}?play=legacy-proxy`);
    assert.equal(new URL(legacyPlay.url).pathname, `/proxy/${sameParams.id}/`);
    const sub = await call('/admin/subscriptions', {method: 'POST', payload: {name: '测试订阅', enabled: true, instances: [instance.id, ids.js]}});
    const config = await app.inject(`/subscription/${sub.id}?token=${sub.token}`);
    assert.equal(config.statusCode, 200);
    assert.deepEqual(config.json().sites.map(s => s.name), ['第二参数实例', '协议样本']);
    const withToken = await app.inject(`/api/${instance.id}?token=${sub.token}&ac=list&t=movie`);
    assert.equal(withToken.statusCode, 200, withToken.body);
    assert.equal(withToken.json().list[0].vod_name, 'movie-1-second');
    assert.equal((await app.inject(`/api/${ids.py}?token=${sub.token}`)).statusCode, 403);
    const ownProxy = `${base}/proxy/${ids.js}/?text=self`;
    const selfResponse = await app.inject(`/unified-proxy/proxy?token=${sub.token}&url=${encodeURIComponent(ownProxy)}`);
    assert.equal(selfResponse.statusCode, 200, selfResponse.body); assert.equal(selfResponse.body, 'self');
    const forbiddenProxy = `${base}/proxy/${ids.py}/`;
    const forbidden = await app.inject(`/unified-proxy/proxy?token=${sub.token}&url=${encodeURIComponent(forbiddenProxy)}`);
    assert.equal(forbidden.statusCode, 403);
    const oldRoute = await call(`/api/${encodeURIComponent('协议样本')}?do=js&ac=list&t=movie&extend=second`);
    assert.equal(oldRoute.list[0].vod_name, 'movie-1-second');
    await call(`/admin/instances/${instance.id}`, {method: 'PUT', payload: {...instance, enabled: false}});
    const updated = await app.inject(`/subscription/${sub.id}?token=${sub.token}`);
    assert.equal(updated.json().sites.length, 1);
});
test('订阅描述保存、重读与校验不改变 Token 或源顺序', async () => {
    const sub=await call('/admin/subscriptions',{method:'POST',payload:{name:'客厅',description:'家庭使用',enabled:true,instances:[ids.php,ids.js]}});
    assert.equal(sub.description,'家庭使用');
    const updated=await call(`/admin/subscriptions/${sub.id}`,{method:'PUT',payload:{name:sub.name,description:'更新后的说明',enabled:true,instances:sub.instances}});
    assert.equal(updated.token,sub.token);
    assert.deepEqual(updated.instances,[ids.php,ids.js]);
    const state=await call('/admin/state');
    assert.equal(state.subscriptions.find(s=>s.id===sub.id).description,'更新后的说明');
    const invalid=await app.inject({url:`/admin/subscriptions/${sub.id}`,method:'PUT',headers:{authorization},payload:{name:sub.name,description:{invalid:true},enabled:true,instances:[]}});
    assert.equal(invalid.statusCode,400);
    assert.equal(app.store.state.subscriptions.find(s=>s.id===sub.id).description,'更新后的说明');
});
test('三种类型创建语法有效的初始脚本，重复创建不能覆盖代码', async () => {
    for(const type of ['js','py','php']){
        const script=await call('/admin/scripts/create',{method:'POST',payload:{type,name:'新建测试'}});
        assert.equal(script.file,`新建测试.${type}`);
        assert.equal(script.engine,type);
        const content=await call(`/admin/scripts/${script.id}`);
        assert.ok(content.code.trim());
        const instance=app.store.state.instances.find(item=>item.scriptId===script.id);
        assert.equal(instance.name,'新建测试');
        const home=await call(`/watch/sources/${instance.id}`);
        assert.ok(Array.isArray(home.class));
        const file=app.store.scriptPath(script);
        await fs.writeFile(file,content.code+'\n// saved content');
        const results=await Promise.all([1,2].map(()=>app.inject({url:'/admin/scripts/create',method:'POST',headers:{authorization},payload:{type,name:'新建测试'}})));
        assert.deepEqual(results.map(result=>result.statusCode),[409,409]);
        assert.equal(await fs.readFile(file,'utf8'),content.code+'\n// saved content');
    }
    for(const payload of [{type:'cat',name:'错误'},{type:'js',name:'../越界'},{type:'py',name:''}]){
        const result=await app.inject({url:'/admin/scripts/create',method:'POST',headers:{authorization},payload});
        assert.notEqual(result.statusCode,200);
    }
});
test('CatVod 参数实例交替调用保持各自模块状态', async () => {
    const original = app.store.state.instances.find(s => s.id === ids.cat);
    const alpha = await call('/admin/instances', {method: 'POST', payload: {...original, name: 'Cat A', params: 'alpha'}});
    const beta = await call('/admin/instances', {method: 'POST', payload: {...original, name: 'Cat B', params: 'beta'}});
    for (const instance of [alpha, beta, alpha]) {
        const result = await call(`/api/${instance.id}?ac=list&t=movie`);
        assert.equal(result.list[0].vod_name, `movie-1-${instance.params}`);
    }
});
test('源 ENV.set 写入在 GUI 和重新初始化后保留', async () => {
    await call(`/api/${ids.js}?ac=action&action=save-env&value=source-cookie`);
    const environment = await call(`/admin/instances/${ids.js}/environment`);
    assert.equal(environment.values.fixture_cookie, 'source-cookie');
    const state = await call('/admin/state');
    assert.equal(state.settings.env.fixture_cookie, undefined);
    const {Store} = await import('../src/store.js');
    const reopened = await new Store(directory).init({seed: false});
    assert.equal((await reopened.readSourceEnvironment(ids.js)).fixture_cookie, 'source-cookie');
    const exported = await call('/admin/export');
    assert.equal(exported.environments[ids.js].fixture_cookie, 'source-cookie');
    await call(`/admin/instances/${ids.js}/environment`, {method:'PUT',payload:{values:{}}});
    await call('/admin/import', {method:'POST',payload:exported});
    assert.equal((await call(`/admin/instances/${ids.js}/environment`)).values.fixture_cookie,'source-cookie');
});
test('同脚本实例的 ENV 隔离、空值覆盖、辅助库读取与代理上下文', async () => {
    const code = `var initialCookie = ENV.get('fixture_cookie', 'missing'); var rule = {title:'环境样本',host:'https://example.invalid',class_parse:async function(){await new Promise(r=>setTimeout(r,5)); log('cookie: '+ENV.get('fixture_cookie')); return {class:[{type_id:'env',type_name:ENV.get('fixture_cookie','missing')}], initialCookie, envObject:ENV.get(), raw:_ENV.fixture_cookie};},推荐:async function(){return [];},proxy_rule:async function(){return [200,'text/plain',ENV.get('fixture_cookie','missing')];},action:async function(name,value){if(name==='delete')ENV.delete('fixture_cookie');else ENV.set('fixture_cookie',value);return {ok:true};}};`;
    const script = await app.store.saveScript('js', '源环境样本.js', code);
    const first = app.store.state.instances.find(s => s.id === script.id);
    const second = await call('/admin/instances', {method:'POST',payload:{...first,name:'第二环境'}});
    app.store.state.settings.env = {fixture_cookie: 'global-default', shared: 'common'};
    await app.store.syncEnvironment();
    await call(`/admin/instances/${first.id}/environment`, {method:'PUT',payload:{values:{fixture_cookie:'cookie-A',empty:'',zero:0,off:false}}});
    await call(`/admin/instances/${second.id}/environment`, {method:'PUT',payload:{values:{fixture_cookie:'cookie-B'}}});
    for (const [instance, cookie] of [[first,'cookie-A'],[second,'cookie-B'],[first,'cookie-A']]) {
        const result = await call(`/api/${instance.id}`);
        assert.equal(result.class[0].type_name,cookie); assert.equal(result.initialCookie,cookie); assert.equal(result.raw,cookie);
        assert.equal(result.envObject.shared,'common');
        const proxy=await app.inject({url:`/proxy/${instance.id}/`,headers:{authorization}}); assert.equal(proxy.body,cookie);
    }
    const a=await call(`/api/${first.id}`); assert.equal(a.envObject.zero,0); assert.equal(a.envObject.off,false);
    await call(`/api/${first.id}?ac=action&action=set&value=updated-A`);
    assert.equal((await call(`/api/${first.id}`)).raw,'updated-A');
    assert.equal((await call(`/admin/instances/${first.id}/environment`)).values.fixture_cookie,'updated-A');
    assert.equal((await call(`/admin/instances/${second.id}/environment`)).values.fixture_cookie,'cookie-B');
    const logText=JSON.stringify(await call(`/admin/logs?source=${first.id}`)); assert.ok(!logText.includes('cookie-A')); assert.ok(logText.includes('已隐藏'));
    await call(`/admin/instances/${first.id}/environment`,{method:'PUT',payload:{values:{fixture_cookie:''}}});
    assert.equal((await call(`/api/${first.id}`)).class[0].type_name,'');
    await call(`/api/${first.id}?ac=action&action=delete`);
    assert.equal((await call(`/api/${first.id}`)).class[0].type_name,'global-default');
    const sub=await call('/admin/subscriptions',{method:'POST',payload:{name:'环境不外发',enabled:true,instances:[first.id]}});
    const publicConfig=await app.inject(`/subscription/${sub.id}?token=${sub.token}`); assert.ok(!publicConfig.body.includes('fixture_cookie'));
    const noAuth=await app.inject(`/admin/instances/${first.id}/environment`); assert.equal(noAuth.statusCode,401);
    const invalid=await app.inject({url:`/admin/instances/${first.id}/environment`,method:'PUT',headers:{authorization},payload:{values:[]}}); assert.equal(invalid.statusCode,400);
    app.store.state.settings.env={}; await app.store.syncEnvironment();
});
test('代理二进制与媒体 Range 流式返回、HLS key/分片改写', async () => {
    const bytes = await app.inject({url: `/proxy/${ids.js}/?bytes=1`, headers: {authorization}});
    assert.equal(bytes.body, '二进制');
    let closed = false;
    const upstream = http.createServer((request, response) => {
        if (request.url === '/list.m3u8') { response.setHeader('content-type', 'application/vnd.apple.mpegurl'); response.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nseg.ts'); return; }
        assert.equal(request.headers.range, 'bytes=2-5');
        response.writeHead(206, {'Content-Range': 'bytes 2-5/8', 'Content-Length': '4'}); response.end('2345');
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    try {
        const url = `http://127.0.0.1:${upstream.address().port}`;
        const media = await fetch(`${base}/mediaProxy?url=${encodeURIComponent(url + '/video')}`, {headers: {authorization, Range: 'bytes=2-5'}});
        assert.equal(media.status, 206); assert.equal(await media.text(), '2345'); assert.equal(media.headers.get('content-range'), 'bytes 2-5/8');
        const playlist = await fetch(`${base}/mediaProxy?url=${encodeURIComponent(url + '/list.m3u8')}`, {headers: {authorization}});
        const content = await playlist.text(); assert.ok(content.includes('/mediaProxy?url=')); assert.ok(content.includes('key.bin'));
        const proxy = await fetch(`${base}/proxy/${ids.js}/?stream=${encodeURIComponent(url + '/video')}`, {headers: {authorization, Range: 'bytes=2-5'}});
        assert.equal(proxy.status, 206); assert.equal(await proxy.text(), '2345');
    } finally { await new Promise(resolve => upstream.close(resolve)); }
});
test('脚本保存语法验证与版本回退', async () => {
    const script = await call(`/admin/scripts/${ids.js}`);
    const bad = await app.inject({url: '/admin/scripts', method: 'POST', headers: {authorization}, payload: {engine: 'js', name: script.file, code: 'var rule = {'}});
    assert.equal(bad.statusCode, 400);
    assert.equal((await call(`/admin/scripts/${ids.js}`)).code, script.code);
    await call('/admin/scripts', {method: 'POST', payload: {engine: 'js', name: script.file, code: script.code.replace('样本电影', '已修改电影')}});
    const saved = await call(`/admin/scripts/${ids.js}`); assert.ok(saved.revisions.length);
    await call(`/admin/scripts/${ids.js}/restore`, {method: 'POST', payload: {revision: saved.revisions[0]}});
    assert.equal((await call(`/admin/scripts/${ids.js}`)).code, script.code);
});
test('自动导入识别三种语言及 CatVod，歧义 JS 无写入并可选择 DR2', async () => {
    const upload=async(name,bytes,engine)=>{
        const boundary='auto-import-boundary';
        const header=(engine?`--${boundary}\r\nContent-Disposition: form-data; name="engine"\r\n\r\n${engine}\r\n`:'')+`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
        return app.inject({url:'/admin/upload',method:'POST',headers:{authorization,'content-type':`multipart/form-data; boundary=${boundary}`},payload:Buffer.concat([Buffer.from(header),Buffer.from(bytes),Buffer.from(`\r\n--${boundary}--\r\n`)])});
    };
    for(const [engine,fixture,suffix] of [['py','协议样本.py','.py'],['php','协议样本.php','.php'],['cat','协议样本.cat.js','.js']]){
        const response=await upload('自动识别-'+engine+suffix,await fs.readFile(path.join(ROOT,'tests/fixtures',fixture)));
        assert.equal(response.statusCode,200,response.body);assert.equal(response.json().engine,engine);
    }
    const marked='/* @header({lang:"ds"}) */\nvar rule={title:"自动识别DS"};';
    const js=await upload('自动识别DS.js',gzipSync(marked).toString('base64'));assert.equal(js.statusCode,200,js.body);assert.equal(js.json().engine,'js');
    const before=app.store.state.scripts.length;
    const unclear=await upload('未注明格式.js','var rule={};');assert.equal(unclear.statusCode,422);assert.equal(unclear.json().code,'IMPORT_ENGINE_REQUIRED');
    assert.equal(app.store.state.scripts.length,before);
    const chosen=await upload('未注明格式.js','var rule={};','dr2');assert.equal(chosen.statusCode,200,chosen.body);assert.equal(chosen.json().engine,'dr2');
    const mixed=new AdmZip();mixed.addFile('根目录.py',await fs.readFile(path.join(ROOT,'tests/fixtures/协议样本.py')));mixed.addFile('根目录.php',await fs.readFile(path.join(ROOT,'tests/fixtures/协议样本.php')));mixed.addFile('spider/js_dr2/明确目录.js',Buffer.from('var rule={};'));
    const bundle=await upload('混合包.zip',mixed.toBuffer());assert.equal(bundle.statusCode,200,bundle.body);
    for(const [engine,file] of [['py','根目录.py'],['php','根目录.php'],['dr2','明确目录.js']])assert.ok(app.store.state.scripts.some(script=>script.engine===engine&&script.file===file));
    const bad=new AdmZip();bad.addFile('spider/js/禁止先写.js',Buffer.from('var rule={};'));bad.addFile('不明格式.js',Buffer.from('var rule={};'));
    const blocked=await upload('先检查.zip',bad.toBuffer());assert.equal(blocked.statusCode,422);assert.ok(!app.store.state.scripts.some(script=>script.file==='禁止先写.js'));
});
test('压缩源编辑、辅助库 ZIP 导入', async () => {
    const code = await fs.readFile(path.join(ROOT, 'tests/fixtures/协议样本.js'), 'utf8');
    const encoded = gzipSync(code).toString('base64');
    const saved = await call('/admin/scripts', {method: 'POST', payload: {engine: 'js', name: '压缩样本.js', code: encoded}});
    const editor = await call(`/admin/scripts/${saved.id}`); assert.equal(editor.code, code);
    const zip = new AdmZip(); zip.addFile('_lib样本.js', Buffer.from('$.exports = {value: 1};'));
    zip.addFile('json/样本.json', Buffer.from('{"test":true}'));
    const body = zip.toBuffer();
    const boundary = 'drpy-test-boundary';
    const multipart = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="engine"\r\n\r\njs\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.zip"\r\nContent-Type: application/zip\r\n\r\n`), body, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const response = await app.inject({url: '/admin/upload', method: 'POST', headers: {authorization, 'content-type': `multipart/form-data; boundary=${boundary}`}, payload: multipart});
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(JSON.parse(await fs.readFile(path.join(app.store.runtime, 'json/样本.json'))).test, true);
});
test('源的同源 HTTP 能力、WebDAV/FTP 辅助服务按需启动', async () => {
    const upstream = http.createServer((request, response) => { response.setHeader('content-type', 'application/json'); response.end('{"ok":true}'); });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${upstream.address().port}`;
    try {
        const response = await call('/http', {method: 'POST', payload: {url}}); assert.equal(response.data.ok, true);
        const gateway = await app.inject({url: '/webdav/health', headers: {authorization}}); assert.equal(gateway.statusCode, 200, gateway.body);
        assert.ok(app.runner.gatewayPort);
        const code = `var rule={title:'同源HTTP',host:'https://example.invalid',class_parse:async function(){const r=await req(this.httpUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:${JSON.stringify(url)}})}); return {class:[{type_id:'ok',type_name:JSON.parse(r.content).data.ok?'成功':'失败'}]};},推荐:async function(){return [];}};`;
        const script = await app.store.saveScript('js', '同源HTTP样本.js', code);
        const result = await call(`/api/${script.id}`); assert.equal(result.class[0].type_name, '成功');
        app.store.state.settings.publicUrl = 'https://public.example.invalid';
        const verified = await call(`/admin/verify/${script.id}`, {method: 'POST', payload: {step: 'home'}});
        assert.equal(verified.result.class[0].type_name, '成功');
        app.store.state.settings.publicUrl = '';
    } finally { await new Promise(resolve => upstream.close(resolve)); }
});
test('同步死循环可回收，管理服务和后续源调用继续工作', async () => {
    const script = await app.store.saveScript('js', '超时样本.js', "var rule = {title: '超时样本', host: 'https://example.invalid', class_parse: async function () { while (true) {} }};");
    app.store.state.settings.timeout = 1200;
    const result = await app.inject({url: `/api/${script.id}`, headers: {authorization}});
    assert.equal(result.statusCode, 500);
    assert.match(result.json().error, /已回收运行进程/);
    assert.equal((await app.inject('/health')).statusCode, 200);
    app.store.state.settings.timeout = 30000;
    const healthy = await call(`/api/${ids.js}`); assert.equal(healthy.class[0].type_id, 'movie');
});
test('批量删除原子移除所选实例和订阅引用，保留脚本、ENV和其他实例', async () => {
    const create = name => call('/admin/instances', {method:'POST',payload:{scriptId:ids.js,name,params:'batch-delete',enabled:true,searchable:true,filterable:false}});
    const first=await create('删除A'), second=await create('删除B'), kept=await create('保留C');
    const sub=await call('/admin/subscriptions',{method:'POST',payload:{name:'批量删除测试',enabled:true,instances:[first.id,kept.id,second.id]}});
    const script=app.store.state.scripts.find(item=>item.id===ids.js), code=await fs.readFile(app.store.scriptPath(script),'utf8');
    await call('/admin/instances/'+first.id+'/environment',{method:'PUT',payload:{values:{fixture_cookie:'keep-cookie'}}});
    const envFile=app.store.sourceEnvPath(first.id), env=await fs.readFile(envFile,'utf8');
    assert.equal((await app.inject({url:'/admin/instances/batch',method:'DELETE',payload:{ids:[first.id]}})).statusCode,401);
    for(const invalid of [[],[null],['../escape']]){
        assert.equal((await app.inject({url:'/admin/instances/batch',method:'DELETE',headers:{authorization},payload:{ids:invalid}})).statusCode,400);
    }
    const removed=await call('/admin/instances/batch',{method:'DELETE',payload:{ids:[first.id,second.id,first.id,'missing']}});
    assert.equal(removed.deleted,2);
    assert.ok(!app.store.state.instances.some(item=>[first.id,second.id].includes(item.id)));
    assert.ok(app.store.state.instances.some(item=>item.id===kept.id));
    assert.deepEqual(app.store.state.subscriptions.find(item=>item.id===sub.id).instances,[kept.id]);
    assert.equal(await fs.readFile(app.store.scriptPath(script),'utf8'),code);
    assert.equal(await fs.readFile(envFile,'utf8'),env);
    assert.equal((await app.inject('/watch/sources/'+first.id)).statusCode,404);
    assert.equal((await app.inject('/api/'+first.id+'?token='+sub.token)).statusCode,404);
    assert.deepEqual(JSON.parse(await fs.readFile(app.store.stateFile)).subscriptions.find(item=>item.id===sub.id).instances,[kept.id]);
});
