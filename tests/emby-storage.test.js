import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EmbyStore} from '../src/emby/store.js';
import {Store} from '../src/store.js';

test('Emby复用SQLite：并发首次打开同一连接、事务失败完整回滚、重启保持ServerId和0600',async t=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-emby-store-'));
    const store=new Store(directory),db=await new EmbyStore(store).init();let next;
    t.after(async()=>{db.close();next?.close();await fs.rm(directory,{recursive:true,force:true});});
    await Promise.all([db.open(),db.open(),db.open()]);
    const server=db.get('meta','server');assert.ok(server);
    db.put('sample','keep',{value:'old'});
    assert.throws(()=>db.transaction(()=>{db.put('sample','keep',{value:'new'});db.put('sample','other',{});throw Error('rollback');}),/rollback/);
    assert.deepEqual(db.get('sample','keep'),{value:'old'});assert.equal(db.get('sample','other'),undefined);
    db.close();next=await new EmbyStore(store).init();assert.equal(next.get('meta','server'),server);
    assert.equal((await fs.stat(path.join(directory,'emby'))).mode&0o777,0o700);
    for(const name of ['emby.sqlite'])assert.equal((await fs.stat(path.join(directory,'emby',name))).mode&0o777,0o600);
});
test('旧全局开关不再控制订阅协议，损坏数据库拒绝覆盖',async t=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-emby-corrupt-'));
    t.after(()=>fs.rm(directory,{recursive:true,force:true}));const store=new Store(directory),db=await new EmbyStore(store).init();
    await db.open();const server=db.get('meta','server');db.close();
    const settings=path.join(directory,'emby','settings.json');await fs.writeFile(settings,JSON.stringify({enabled:false}),{mode:0o600});
    const reopened=await new EmbyStore(store).init();assert.equal(reopened.get('meta','server'),server);reopened.close();assert.equal(await fs.readFile(settings,'utf8'),JSON.stringify({enabled:false}));
    const file=path.join(directory,'emby','emby.sqlite');await fs.writeFile(file,'{broken');
    await assert.rejects(new EmbyStore(store).init(),/数据库不可读/);assert.equal(await fs.readFile(file,'utf8'),'{broken');

});
