import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createApp} from '../src/server.js';
import {ROOT} from '../src/paths.js';
import {createTvboxImporter, remoteUrl} from '../src/tvbox-import.js';

let app, directory, upstream, base, authorization, contentVersion = 1;
const payloads = new Map();
const xml = '<rss><list page="1" pagecount="3"><video><id>one</id><name>XML电影</name><dl><dd flag="m3u8"><![CDATA[正片$https://fixture.invalid/video.m3u8]]></dd><dd flag="mp4"><![CDATA[备用$https://fixture.invalid/video.mp4]]></dd></dl></video></list><class><ty id="movie">电影</ty></class></rss>';
before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-tvbox-'));
    upstream = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://fixture.invalid');
        if (url.pathname === '/redirect') { res.writeHead(302, {Location: '/config/list.json'}); res.end(); return; }
        if (url.pathname === '/json-api') {
            const complete = url.searchParams.get('ac') === 'detail';
            res.end(JSON.stringify({class: [{type_id: 'movie', type_name: '电影'}], page: 1, pagecount: 2,
                list: [{vod_id: 'one', vod_name: url.searchParams.get('wd') || 'JSON电影', ...(complete ? {vod_pic: './covers/json.jpg', vod_play_from: 'm3u8', vod_play_url: '正片$https://fixture.invalid/movie.m3u8'} : {})}]})); return;
        }
        if (url.pathname === '/xml-api') { res.end(url.searchParams.get('ac') === 'videolist' ? xml.replace('</name>', '</name><pic>//127.0.0.1:' + upstream.address().port + '/covers/xml.jpg</pic>') : xml); return; }
        if (url.pathname === '/script-changing.js') { res.end('// lang: \'ds\'\nvar rule={title:\'版本' + contentVersion + '\',host:\'https://fixture.invalid\'};'); return; }
        if (url.pathname === '/invalid-api') { res.end('<html>访问验证</html>'); return; }
        const value = payloads.get(url.pathname);
        if (value === undefined) { res.writeHead(404); res.end('not found'); return; }
        res.end(value);
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + upstream.address().port;
    app = await createApp({directory, seed: false});
    await app.inject({url: '/admin/access/setup', method: 'POST', payload: {password: 'tvbox-password', confirmPassword: 'tvbox-password'}});
    authorization = 'Basic ' + Buffer.from(':tvbox-password').toString('base64');
    const localPython = path.join(ROOT, '.tools/python/bin/python3'), localPhp = path.join(ROOT, '.tools/php/php');
    app.store.state.settings.pythonPath = process.env.TEST_PYTHON || await fs.access(localPython).then(() => localPython).catch(() => 'python3');
    app.store.state.settings.phpPath = process.env.TEST_PHP || await fs.access(localPhp).then(() => localPhp).catch(() => 'php');
    for (const type of ['js', 'py', 'php']) payloads.set('/config/source.' + type, await fs.readFile(path.join(ROOT, 'tests/fixtures/协议样本.' + type), 'utf8'));
    payloads.set('/config/marked.js', '// lang: \'ds\'\nvar rule={title:\'标记源\',host:\'https://fixture.invalid\'};');
    payloads.set('/config/lib.js', 'export const suffix = "依赖成功";');
    payloads.set('/config/cat-deps.js', 'import {suffix} from "./lib.js";export function __jsEvalReturn(){return {init:async()=>{},home:async()=>({class:[]}),homeVod:async()=>({list:[{vod_id:"one",vod_name:suffix}]})};}');
    payloads.set('/config/list.json', JSON.stringify({spider: './spider.jar', sites: [
        {key: 'json', name: 'JSON站点', type: 1, api: '../json-api', searchable: 1, categories: ['电影']},
        {key: 'xml', name: 'XML站点', type: 0, api: '../xml-api'},
        {key: 'ds', name: 'DS站点', type: 3, api: './marked.js', ext: {url: './params.json'}, searchable: 0},
        {key: 'ds2', name: '同脚本实例', type: 3, api: './marked.js', ext: './other.json'},
        {key: 'py', name: 'Python站点', type: 3, api: './source.py'},
        {key: 'php', name: 'PHP站点', type: 3, api: './source.php'},
        {key: 'cat', name: 'Cat依赖站点', type: 3, api: './cat-deps.js'},
        {key: 'dr2', name: 'DR2站点', type: 3, api: './drpy2.min.js', ext: './source.js'},
        {key: 'jar', name: 'Android站点', type: 3, api: 'csp_Douban'},
        {key: 'html', name: '无效接口', type: 1, api: '../invalid-api'},
    ]}));
});
after(async () => { await app?.close(); await new Promise(resolve => upstream?.close(resolve)); await fs.rm(directory, {recursive: true, force: true}); });
async function call(url, payload) {
    const response = await app.inject({url, method: 'POST', headers: {authorization}, payload});
    assert.equal(response.statusCode, 200, response.body); return response.json();
}
test('TVBox 预览鉴权、重定向相对路径和五种引擎识别，无写入或执行脚本', async () => {
    const before = JSON.stringify(app.store.state);
    assert.equal((await app.inject({url: '/admin/import/tvbox/preview', method: 'POST', payload: {url: base + '/redirect'}})).statusCode, 401);
    const preview = await call('/admin/import/tvbox/preview', {url: base + '/redirect'});
    assert.equal(preview.total, 10); assert.equal(preview.ready, 8);
    assert.deepEqual(preview.entries.filter(item => item.status === 'ready').map(item => item.engine), ['cat', 'cat', 'js', 'js', 'py', 'php', 'cat', 'dr2']);
    assert.equal(preview.entries.find(item => item.key === 'cat').dependencyCount, 1);
    assert.equal(preview.entries.find(item => item.key === 'jar').status, 'skipped');
    assert.equal(preview.entries.find(item => item.key === 'html').status, 'skipped');
    assert.ok(!JSON.stringify(preview).includes('var rule'));
    assert.equal(JSON.stringify(app.store.state), before); assert.equal(app.runner.child, null);
});
test('导入所选保留站点名称与参数，共用脚本不串实例，不改订阅；重复导入去重', async () => {
    const subscriptions = JSON.stringify(app.store.state.subscriptions);
    const preview = await call('/admin/import/tvbox/preview', {url: base + '/redirect'});
    const ids = preview.entries.filter(item => item.status === 'ready').map(item => item.id);
    const result = await call('/admin/import/tvbox', {previewId: preview.previewId, ids});
    assert.equal(result.imported, 8); assert.equal(result.existing, 0);
    const first = app.store.state.instances.find(item => item.name === 'DS站点'), second = app.store.state.instances.find(item => item.name === '同脚本实例');
    assert.equal(first.scriptId, second.scriptId); assert.equal(first.searchable, false);
    assert.equal(JSON.parse(first.params).url, base + '/config/params.json'); assert.equal(second.params, base + '/config/other.json');
    assert.equal(JSON.stringify(app.store.state.subscriptions), subscriptions);
    const repeat = await call('/admin/import/tvbox/preview', {url: base + '/redirect'});
    const duplicate = await call('/admin/import/tvbox', {previewId: repeat.previewId, ids});
    assert.equal(duplicate.imported, 0); assert.equal(duplicate.existing, 8);
    assert.equal((await app.inject({url: '/admin/import/tvbox', method: 'POST', headers: {authorization}, payload: {previewId: repeat.previewId, ids}})).statusCode, 409);
});
test('生成的 JSON/XML 脚本可浏览分类搜索详情和播放；CatVod 依赖落地', async () => {
    for (const name of ['JSON站点', 'XML站点', 'Cat依赖站点']) {
        const instance = app.store.state.instances.find(item => item.name === name);
        const home = await app.inject('/watch/sources/' + instance.id);
        assert.equal(home.statusCode, 200, home.body);
        if (name === 'Cat依赖站点') { assert.equal(home.json().list[0].vod_name, '依赖成功'); continue; }
        assert.equal(home.json().class[0].type_name, '电影');
        assert.equal(home.json().list[0].vod_pic, base + '/covers/' + (name === 'JSON站点' ? 'json' : 'xml') + '.jpg');
        for (const query of ['ac=list&t=movie&pg=2', 'wd=测试&pg=1', 'ac=detail&ids=one']) {
            const response = await app.inject('/watch/sources/' + instance.id + '?' + query);
            assert.equal(response.statusCode, 200, response.body); assert.ok(response.json().list[0].vod_play_url);
        }
        const play = await app.inject({url: '/watch/sources/' + instance.id + '/play', method: 'POST', payload: {flag: 'm3u8', play: 'https://fixture.invalid/movie.m3u8'}});
        assert.equal(play.statusCode, 200, play.body); assert.equal(play.json().type, 'm3u8');
    }
});
test('歧义 JS 选择格式后才导入，支持 JSON5 注释和末尾逗号', async () => {
    payloads.set('/ambiguous.json', '{sites:[{key:"plain",name:"未标记JS",type:3,api:"' + base + '/config/source.js",},],}');
    const preview = await call('/admin/import/tvbox/preview', {url: base + '/ambiguous.json'});
    assert.equal(preview.entries[0].status, 'needsEngine');
    const before = JSON.stringify(app.store.state);
    const invalid = await app.inject({url: '/admin/import/tvbox', method: 'POST', headers: {authorization}, payload: {previewId: preview.previewId, ids: ['0']}});
    assert.equal(invalid.statusCode, 400); assert.equal(JSON.stringify(app.store.state), before);
    assert.equal((await call('/admin/import/tvbox', {previewId: preview.previewId, ids: ['0'], engines: {'0': 'dr2'}})).imported, 1);
});
test('远程内容变动不覆盖原脚本，生成独立版本', async () => {
    payloads.set('/changing.json', JSON.stringify({sites: [{key: 'change', name: '变动源', type: 3, api: base + '/script-changing.js'}]}));
    const first = await call('/admin/import/tvbox/preview', {url: base + '/changing.json'});
    const result = await call('/admin/import/tvbox', {previewId: first.previewId, ids: ['0']});
    const instance = app.store.state.instances.find(item => item.id === result.sources[0].id), script = app.store.state.scripts.find(item => item.id === instance.scriptId);
    const original = await fs.readFile(app.store.scriptPath(script), 'utf8'); contentVersion = 2;
    const second = await call('/admin/import/tvbox/preview', {url: base + '/changing.json'});
    assert.equal((await call('/admin/import/tvbox', {previewId: second.previewId, ids: ['0']})).imported, 1);
    assert.equal(await fs.readFile(app.store.scriptPath(script), 'utf8'), original);
});
test('错误配置、非法协议、跳过项和过期预览无写入', async () => {
    const before = JSON.stringify(app.store.state); payloads.set('/bad.json', '{"sites":"invalid"}');
    for (const url of ['file:///etc/passwd', base + '/bad.json', base + '/invalid-api']) {
        const response = await app.inject({url: '/admin/import/tvbox/preview', method: 'POST', headers: {authorization}, payload: {url}}); assert.equal(response.statusCode, 400);
    }
    assert.throws(() => remoteUrl('ftp://fixture/file')); assert.throws(() => remoteUrl('https://name:pass@fixture/file'));
    const preview = await call('/admin/import/tvbox/preview', {url: base + '/redirect'});
    assert.equal((await app.inject({url: '/admin/import/tvbox', method: 'POST', headers: {authorization}, payload: {previewId: preview.previewId, ids: ['8']}})).statusCode, 400);
    let now = 0; const importer = createTvboxImporter(app.store, {now: () => now});
    const stale = await importer.preview(base + '/ambiguous.json'); now = 16 * 60000;
    await assert.rejects(importer.commit({previewId: stale.previewId, ids: ['0'], engines: {'0': 'js'}}), /过期/);
    assert.equal(JSON.stringify(app.store.state), before);
});
test('批量持久化失败回滚状态和新文件，不留下半导入', async () => {
    const before = JSON.stringify(app.store.state), persist = app.store.persist;
    const entry = {engine: 'js', file: 'tvbox-rollback.js', code: 'var rule={};', dependencies: [], key: 'rollback', params: '', name: '回滚', searchable: true, filterable: false};
    try {
        app.store.persist = async () => { throw new Error('模拟磁盘错误'); };
        await assert.rejects(app.store.importSources([entry]), /模拟磁盘错误/);
        assert.equal(JSON.stringify(app.store.state), before);
        await assert.rejects(fs.access(path.join(app.store.runtime, 'spider/js/tvbox-rollback.js')));
    } finally { app.store.persist = persist; }
});
test('同时提交同一预览只允许一次，不能并发重复写入', async () => {
    const preview = await call('/admin/import/tvbox/preview', {url: base + '/ambiguous.json'});
    const responses = await Promise.all([1, 2].map(() => app.inject({url: '/admin/import/tvbox', method: 'POST', headers: {authorization}, payload: {previewId: preview.previewId, ids: ['0'], engines: {'0': 'js'}}})));
    assert.deepEqual(responses.map(item => item.statusCode).sort(), [200, 409]);
});
