import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAuth} from '../src/auth.js';

const request=(password,body)=>({headers:{authorization:'Basic '+Buffer.from(':'+password).toString('base64')},body});
test('没有初始密码，首次直接创建；注册后持久化并禁止重新注册',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-access-'));
    const savedEnv=process.env.ADMIN_PASSWORD;delete process.env.ADMIN_PASSWORD;
    const store={directory,atomic:async(file,content)=>{await fs.writeFile(file+'.tmp',content);await fs.rename(file+'.tmp',file);}};
    try{
        const auth=await createAuth(store);
        assert.equal(auth.needsSetup(),true);assert.equal(auth.isAdmin(request('111111')),false);
        assert.equal(JSON.parse(await fs.readFile(auth.file,'utf8')).password,undefined);
        for(const [password,confirmation] of [['short','short'],['newpass','mismatch']]){
            await assert.rejects(auth.setup({headers:{},body:{password,confirmPassword:confirmation}}));
            assert.equal(auth.needsSetup(),true);
        }
        const results=await Promise.allSettled(['first-password','second-password'].map(password=>auth.setup({headers:{},body:{password,confirmPassword:password}})));
        assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
        assert.equal(auth.isAdmin(request('111111')),false);assert.equal(auth.isAdmin(request('first-password')),true);
        assert.equal(auth.needsSetup(),false);
        await assert.rejects(auth.setup(request('first-password',{password:'another-password',confirmPassword:'another-password'})));
        const stored=JSON.parse(await fs.readFile(auth.file,'utf8'));assert.equal(stored.requiresSetup,false);
        assert.equal((await fs.stat(auth.file)).mode&0o777,0o600);
        process.env.ADMIN_PASSWORD='111111';
        const restarted=await createAuth(store);assert.equal(restarted.needsSetup(),false);assert.equal(restarted.isAdmin(request('first-password')),true);
        delete process.env.ADMIN_PASSWORD;
        const anotherDirectory=path.join(directory,'fresh');await fs.mkdir(anotherDirectory);
        const fresh=await createAuth({...store,directory:anotherDirectory});
        await fresh.setup({headers:{},body:{password:'111111',confirmPassword:'111111'}});
        assert.equal(fresh.needsSetup(),false);assert.equal(fresh.isAdmin(request('111111')),true);
    }finally{
        if(savedEnv===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=savedEnv;
        await fs.rm(directory,{recursive:true,force:true});
    }
});
