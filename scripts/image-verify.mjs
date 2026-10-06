import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';

const base = process.env.SMOKE_URL || 'http://127.0.0.1:54058';
const dataDir = process.env.DATA_DIR || '/app/data';
const fixtures = process.env.CONTAINER_FIXTURES || '/app/tests/fixtures';
const expectedFile = process.env.CONTAINER_EXPECTED || '/tmp/coketv-expected-state.json';
const password = 'container-smoke-only';
const authorization = 'Basic ' + Buffer.from(':' + password).toString('base64');
assert.notEqual(process.getuid?.(), 0, '镜像必须以非 root 用户运行');
const call = async (url, body, admin = false, method) => {
    const response = await fetch(base + url, {method: method || (body === undefined ? 'GET' : 'POST'),
        headers: {...(admin ? {Authorization: authorization} : {}), ...(body ? {'Content-Type': 'application/json'} : {})},
        body: body === undefined ? undefined : JSON.stringify(body)});
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
};
const upstream = http.createServer((req, res) => {
    if (req.url === '/master.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end('#EXTM3U\nchild.m3u8\n'); return; }
    if (req.url === '/child.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:1,\nsegment.ts\n'); return; }
    if (req.url === '/key.bin') { res.end('0123456789abcdef'); return; }
    if (req.headers.range) { assert.equal(req.headers.range, 'bytes=2-5'); res.writeHead(206, {'Content-Range':'bytes 2-5/10'}); res.end('2345'); return; }
    res.setHeader('Content-Type', 'video/mp4'); res.end('0123456789');
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
const cli = async (id, credential = password) => {
    const child = spawn(process.execPath, [new URL('./verify.mjs', import.meta.url).pathname, id, base, '--password-stdin'], {env: {...process.env, ADMIN_PASSWORD: ''}, stdio: ['pipe','pipe','pipe']});
    let output = '';
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
    child.stdin.end(credential + '\n');
    const code = await new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',resolve); });
    assert.equal(code,0,output); assert.match(output,/首页：/); assert.match(output,/详情：/);
    assert.ok(!output.includes(credential));
};
const snapshot = async () => {
    const state = await call('/admin/state', undefined, true);
    const files = {};
    const paths = ['admin.json','runtime/config/env.json','runtime/.plugins.js'];
    for (const instance of state.instances) paths.push(`runtime/config/source-env/${instance.id}.json`);
    for (const script of state.scripts) {
        const directories = {js:'js',dr2:'js_dr2',cat:'catvod',py:'py',php:'php'};
        paths.push(`runtime/spider/${directories[script.engine]}/${script.file}`);
    }
    const walk = async (relative) => {
        for (const entry of await fs.readdir(path.join(dataDir,relative),{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;})) {
            const next=relative+'/'+entry.name;
            if (entry.isDirectory()) await walk(next); else paths.push(next);
        }
    };
    await walk('revisions');
    for (const relative of paths) {
        try { files[relative] = (await fs.readFile(path.join(dataDir,relative))).toString('base64'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const {runtime, baseUrl, ...persistent} = state;
    return {state:persistent, files};
};
try {
    let expected;
    const persistence = process.argv.includes('--persistence');
    if (persistence) {
        expected = JSON.parse(await fs.readFile(expectedFile,'utf8'));
        const state = await call('/admin/state',undefined,true);
        assert.equal(state.runtime.started,false);
        assert.deepEqual(await snapshot(),expected.snapshot);
        assert.equal((await call('/access/status')).requiresSetup,false);
        assert.equal((await fetch(base + expected.oldMedia)).status,403,'重启旧票据应失效');
    } else {
        const before = await call('/admin/state',undefined,true);
        expected = {baseline: before.scripts.map(s => s.id), baselineInstances:before.instances.map(s=>s.id), sources:{}};
        for (const engine of ['js','dr2','cat','py','php']) {
            const fixture = engine === 'dr2' ? 'js' : engine === 'cat' ? 'cat.js' : engine;
            const code = await fs.readFile(path.join(fixtures,'协议样本.'+fixture),'utf8');
            const script = await call('/admin/scripts', {engine,name:'matrix-'+engine+(['py','php'].includes(engine)?'.'+engine:'.js'),code},true);
            const state = await call('/admin/state',undefined,true);
            const instance = state.instances.find(item => item.scriptId === script.id);
            expected.sources[engine] = instance.id;
            await call('/admin/instances/'+instance.id,{...instance,params:'container-persist-param'},true,'PUT');
            await call('/admin/instances/'+instance.id+'/environment',{values:{fixture_cookie:'container-source-cookie'}},true,'PUT');
        }
        const configured = await call('/admin/state',undefined,true);
        await call('/admin/settings',{...configured.settings,env:{fixture_global:'container-global-value'}},true,'PUT');
        const exported = await call('/admin/export',undefined,true);
        exported.subscriptions[0].instances = Object.values(expected.sources).reverse();
        await call('/admin/import',exported,true);
    }
    for (const [engine,id] of Object.entries(expected.sources)) {
        const api = '/watch/sources/'+id;
        const home = await call(api);
        assert.equal(home.class[0].type_id,'movie'); assert.equal(home.list[0].vod_name,'样本电影');
        assert.equal((await call(api+'?ac=list&t=movie&pg=1')).list[0].vod_name,'movie-1-container-persist-param');
        assert.equal((await call(api+'?wd=matrix')).list[0].vod_name,'matrix');
        assert.ok((await call(api+'?ac=detail&ids=one')).list[0].vod_play_url);
        const media = await call(api+'/play',{play:upstreamUrl+'/video.mp4',flag:'测试'});
        assert.match(media.url,/^\/watch\/media\//); expected.oldMedia = media.url;
        const direct = await fetch(base+media.url); assert.equal(direct.status,200); assert.equal(await direct.text(),'0123456789');
        assert.equal((await fetch(base+media.url,{method:'HEAD'})).status,200);
        const range = await fetch(base+media.url,{headers:{range:'bytes=2-5'}});
        assert.equal(range.status,206); assert.equal(range.headers.get('content-range'),'bytes 2-5/10'); assert.equal(await range.text(),'2345');
        const hls = await call(api+'/play',{play:upstreamUrl+'/master.m3u8',flag:'测试'});
        const masterResponse = await fetch(base+hls.url); assert.equal(masterResponse.status,200);
        const master = await masterResponse.text();
        const childUrl = master.split('\n').find(line => line && !line.startsWith('#'));
        const childResponse = await fetch(childUrl); assert.equal(childResponse.status,200);
        const child = await childResponse.text();
        const segment = child.split('\n').find(line => line && !line.startsWith('#'));
        const key = child.match(/URI="([^"]+)"/)[1];
        for (const [url,bytes] of [[segment,'0123456789'],[key,'0123456789abcdef']]) {
            const response = await fetch(url); assert.equal(response.status,200); assert.equal(await response.text(),bytes);
        }
        const proxy = await fetch(base+'/proxy/'+id+'/',{headers:{Authorization:authorization}});
        assert.equal(proxy.status,200); assert.equal(await proxy.text(),'hello');
        await cli(id);
        console.log(engine+'：首页/分类/搜索/详情/代理/正式CLI，实际 GET/HEAD/Range/HLS 主子列表/分片/key 通过');
    }
    const state = await call('/admin/state',undefined,true);
    const expectedScripts = new Set([...expected.baseline,...Object.values(expected.sources).map(id => state.instances.find(s => s.id === id).scriptId)]);
    assert.deepEqual(new Set(state.scripts.map(s => s.id)),expectedScripts);
    assert.deepEqual(new Set(state.instances.map(s => s.scriptId)),expectedScripts);
    assert.equal(state.scripts.length,expectedScripts.size);
    assert.deepEqual(state.instances.map(s=>s.id),[...expected.baselineInstances,...Object.values(expected.sources)]);
    assert.equal((await fetch(base+'/admin/state')).status,401); assert.equal((await fetch(base+'/config')).status,403);
    for (const route of ['/','/admin','/watch','/watch/history']) assert.equal((await fetch(base+route)).status,200);
    if (!persistence) { expected.snapshot = await snapshot(); await fs.writeFile(expectedFile,JSON.stringify(expected),{mode:0o600}); }
    console.log(persistence ? '同卷重启持久化、旧票据失效和五引擎实际媒体复验通过' : '样本集合/公开页面/管理鉴权/订阅边界通过；仅临时数据');
} finally { await new Promise(resolve => upstream.close(resolve)); }
