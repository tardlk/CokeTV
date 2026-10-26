import {ruleFixture} from './helpers/drpy3-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {createApp} from '../src/server.js';

const code = ruleFixture("var rule={title:'删除样本',lang:'ds'};");
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

test('真实上传接口：真删除后同名重传创建新源，不恢复原订阅范围或重复创建', async t => {
    const {app, headers, upload} = await environment(t);
    const first = await upload(); assert.equal(first.statusCode, 200, first.body);
    const id = first.json().id;
    await app.store.mutate(state => { state.subscriptions[0].instances = [id]; });
    const removed = await app.inject({method: 'DELETE', url: '/admin/scripts/' + id, headers});
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(removed.json().deletedScripts, 1);
    assert.equal((await app.inject('/watch/sources/' + id)).statusCode, 404);
    const again = await upload(); assert.equal(again.statusCode, 200, again.body);
    assert.equal((await app.inject('/watch/sources')).json().length, 1);
    assert.deepEqual(app.store.state.subscriptions[0].instances, []);
    await upload(); assert.equal(app.store.state.instances.length, 1);
});

test('脚本删除接口鉴权、批量校验、共享源连带清理和退役入口',async t=>{
    const {app,headers,upload}=await environment(t);
    const uploaded=await upload(),script=uploaded.json(),id=script.id;
    app.store.state.instances.push({...app.store.state.instances[0],id:'sibling'});
    const file=app.store.scriptPath(script);await app.store.atomic(app.store.sourceEnvPath(id),'{}');
    assert.equal((await app.inject({method:'DELETE',url:'/admin/scripts/'+id})).statusCode,401);
    assert.equal((await app.inject({method:'DELETE',url:'/admin/scripts/batch',headers,payload:{ids:['../escape']}})).statusCode,400);
    assert.equal((await app.inject({method:'DELETE',url:'/admin/scripts/batch',headers,payload:{ids:[]}})).statusCode,400);
    const removed=await app.inject({method:'DELETE',url:'/admin/scripts/'+id,headers,payload:{deleteScripts:false}});
    assert.equal(removed.statusCode,200,removed.body);assert.equal(removed.json().deletedScripts,1);assert.equal(removed.json().deleted,2);
    assert.equal(app.store.state.scripts.length,0);assert.equal(app.store.state.instances.length,0);await assert.rejects(fs.access(file),{code:'ENOENT'});
    assert.equal((await upload()).statusCode,200);
    const batch=await app.inject({method:'DELETE',url:'/admin/scripts/batch',headers,payload:{ids:[id,id,'missing']}});
    assert.equal(batch.statusCode,200,batch.body);assert.equal(batch.json().deletedScripts,1);
    for(const url of ['/admin/scan','/admin/instances'])assert.equal((await app.inject({method:'POST',url,headers,payload:{}})).statusCode,404);
    assert.equal((await app.inject({method:'DELETE',url:'/admin/instances/'+id,headers})).statusCode,404);
});

test('真实ZIP上传接口：相同内容重导入恢复已移除实例', async t => {
    const {app, headers, upload} = await environment(t);
    const zip = new AdmZip(); zip.addFile('删除样本.js', Buffer.from(code));
    const first = await upload('source.zip', zip.toBuffer()); assert.equal(first.statusCode, 200, first.body);
    const id = app.store.state.instances[0].id;
    await app.inject({method: 'DELETE', url: '/admin/scripts/' + id, headers});
    const again = await upload('source.zip', zip.toBuffer()); assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().added, 1); assert.equal(app.store.state.instances[0].id, id);
});
