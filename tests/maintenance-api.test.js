import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {createApp} from '../src/server.js';

let app, directory, authorization, previousLogFile;

before(async () => {
    const previous = process.env.ADMIN_PASSWORD;
    previousLogFile = process.env.LOG_FILE;
    process.env.ADMIN_PASSWORD = 'maintenance-password';
    process.env.LOG_FILE = 'logs/test.log';
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-maintenance-'));
    try { app = await createApp({directory}); }
    finally {
        if (previous === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = previous;
        if (previousLogFile === undefined) delete process.env.LOG_FILE; else process.env.LOG_FILE = previousLogFile;
    }
    authorization = `Basic ${Buffer.from(':maintenance-password').toString('base64')}`;
    await app.store.saveScript('dr3', '快照样本.js', "var rule={title:'快照样本'};");
});

after(async () => {
    await app?.close();
    await fs.rm(directory, {recursive: true, force: true});
});

const get = (url, headers = {}) => app.inject({method: 'GET', url, headers});
const post = (url, payload = {}) => app.inject({method: 'POST', url, headers: {authorization}, payload});

test('运行维护接口要求管理鉴权，快照可创建、列出、下载', async () => {
    assert.equal((await get('/admin/backups')).statusCode, 401);
    assert.equal((await get('/admin/logs/download')).statusCode, 401);

    const empty = await get('/admin/backups', {authorization});
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json().items, []);
    assert.equal(empty.json().keep, 7);

    const created = await post('/admin/backups');
    assert.equal(created.statusCode, 200, created.body);
    const backup = created.json().backup;
    assert.match(backup.name, /^coketv-\d{8}-\d{6}-[a-f0-9]{6}\.zip$/);
    assert.ok(backup.size > 0);

    const listed = await get('/admin/backups', {authorization});
    assert.deepEqual(listed.json().items.map(item => item.name), [backup.name]);

    const download = await get(`/admin/backups/${backup.name}`, {authorization});
    assert.equal(download.statusCode, 200);
    assert.match(download.headers['content-type'], /application\/zip/);
    assert.match(download.headers['content-disposition'], /attachment/);
    const names = new AdmZip(download.rawPayload).getEntries().map(entry => entry.entryName);
    assert.ok(names.includes('state.json'));
    assert.ok(names.some(name => name.startsWith('runtime/spider/js_dr3/')));

    const rejected = await get('/admin/backups/.%2Fstate.json', {authorization});
    assert.equal(rejected.statusCode, 400);
});

test('日志接口返回内存条目，下载文件落盘且已脱敏', async () => {
    await post('/admin/backups');
    const logs = await get('/admin/logs?limit=200', {authorization});
    assert.equal(logs.statusCode, 200);
    assert.ok(Array.isArray(logs.json()));
    assert.equal(logs.json().length <= 200, true);

    const download = await get('/admin/logs/download', {authorization});
    assert.equal(download.statusCode, 200);
    assert.match(download.headers['content-type'], /text\/plain/);
    assert.match(download.headers['content-disposition'], /attachment/);
    assert.match(download.body, /已创建数据快照/);
    assert.ok(!download.body.includes('Bearer '));

    const file = path.join(directory, 'logs/test.log');
    const content = await fs.readFile(file, 'utf8');
    assert.ok(content.includes('已创建数据快照'));
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('管理 JSON 响应按 Accept-Encoding 压缩，小响应保持原样', async () => {
    for (let index = 0; index < 12; index += 1) {
        await app.store.saveScript('dr3', `压缩样本${index}.js`, `var rule={title:'样本${index}'};`);
    }
    const compressed = await get('/admin/state', {authorization, 'accept-encoding': 'gzip'});
    assert.equal(compressed.statusCode, 200);
    assert.equal(compressed.headers['content-encoding'], 'gzip');
    assert.match(compressed.headers.vary || '', /accept-encoding/i);

    const plain = await get('/health', {'accept-encoding': 'gzip'});
    assert.equal(plain.statusCode, 200);
    assert.equal(plain.headers['content-encoding'], undefined);
});
