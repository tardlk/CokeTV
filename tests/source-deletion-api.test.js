import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {createApp} from '../src/server.js';

const code = "var rule={title:'删除样本',lang:'ds'};";
async function environment(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-delete-api-'));
    const app = await createApp({directory, seed: false});
    t.after(async () => { await app.close(); await fs.rm(directory, {recursive: true, force: true}); });
    await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'fixture-delete', confirmPassword: 'fixture-delete'}});
    const headers = {authorization: 'Basic ' + Buffer.from(':fixture-delete').toString('base64')};
    const upload = async (name = '删除样本.js', bytes = Buffer.from(code)) => {
        const boundary = 'deletion-upload';
        return app.inject({method: 'POST', url: '/admin/upload', headers: {...headers, 'content-type': 'multipart/form-data; boundary=' + boundary}, payload: Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
        ])});
    };
    return {app, headers, upload};
}

test('真实上传接口：默认删除后同名重传恢复实例，不恢复原订阅范围或重复创建', async t => {
    const {app, headers, upload} = await environment(t);
    const first = await upload(); assert.equal(first.statusCode, 200, first.body);
    const id = first.json().id;
    await app.store.mutate(state => { state.subscriptions[0].instances = [id]; });
    const removed = await app.inject({method: 'DELETE', url: '/admin/instances/' + id, headers});
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(removed.json().deletedScripts, 0);
    assert.equal((await app.inject('/watch/sources/' + id)).statusCode, 404);
    const again = await upload(); assert.equal(again.statusCode, 200, again.body);
    assert.equal((await app.inject('/watch/sources')).json().length, 1);
    assert.deepEqual(app.store.state.subscriptions[0].instances, []);
    await upload(); assert.equal(app.store.state.instances.length, 1);
});

test('真实删除接口：鉴权与清理参数校验、共享保护及最后引用清理', async t => {
    const {app, headers, upload} = await environment(t);
    const uploaded = await upload(); const script = uploaded.json(), id = script.id;
    const created = await app.inject({method: 'POST', url: '/admin/instances', headers, payload: {scriptId: id, name: '共享实例', params: 'keep', enabled: true, searchable: true, filterable: false}});
    const sibling = created.json().id;
    const file = app.store.scriptPath(script);
    await app.store.atomic(app.store.sourceEnvPath(id), '{}');
    assert.equal((await app.inject({method: 'DELETE', url: '/admin/instances/' + id, payload: {deleteScripts: true}})).statusCode, 401);
    assert.equal((await app.inject({method: 'DELETE', url: '/admin/instances/' + id, headers, payload: {deleteScripts: 'true'}})).statusCode, 400);
    assert.equal((await app.inject({method: 'DELETE', url: '/admin/instances/batch', headers, payload: {ids: [id], deleteScripts: 'true'}})).statusCode, 400);
    const partial = await app.inject({method: 'DELETE', url: '/admin/instances/' + id, headers, payload: {deleteScripts: true}});
    assert.equal(partial.statusCode, 200, partial.body); assert.equal(partial.json().retainedScripts, 1); await fs.access(file);
    const last = await app.inject({method: 'DELETE', url: '/admin/instances/batch', headers, payload: {ids: [sibling, sibling, 'missing'], deleteScripts: true}});
    assert.equal(last.statusCode, 200, last.body); assert.equal(last.json().deletedScripts, 1);
    assert.equal(app.store.state.scripts.length, 0); await assert.rejects(fs.access(file), {code: 'ENOENT'});
    assert.equal((await upload()).statusCode, 200); assert.equal(app.store.state.instances.length, 1);
});

test('真实ZIP上传接口：相同内容重导入恢复已移除实例', async t => {
    const {app, headers, upload} = await environment(t);
    const zip = new AdmZip(); zip.addFile('删除样本.js', Buffer.from(code));
    const first = await upload('source.zip', zip.toBuffer()); assert.equal(first.statusCode, 200, first.body);
    const id = app.store.state.instances[0].id;
    await app.inject({method: 'DELETE', url: '/admin/instances/' + id, headers});
    const again = await upload('source.zip', zip.toBuffer()); assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().added, 1); assert.equal(app.store.state.instances[0].id, id);
});
