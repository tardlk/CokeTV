import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAuth} from '../src/auth.js';

const request=(password,body)=>({headers:{authorization:'Basic '+Buffer.from(':'+password).toString('base64')},body});
test('首次创建密码校验、并发保护、持久化与旧密码失效',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-access-'));
    const savedEnv=process.env.ADMIN_PASSWORD;delete process.env.ADMIN_PASSWORD;
    const store={directory,atomic:async(file,content)=>{await fs.writeFile(file+'.tmp',content);await fs.rename(file+'.tmp',file);}};
    try{
        const auth=await createAuth(store);
        assert.equal(auth.needsSetup(),true);assert.equal(auth.isAdmin(request('111111')),false);
        for(const [password,confirmation,old] of [['short','short','111111'],['newpass','mismatch','111111'],['111111','111111','111111'],['newpass','newpass','wrong']]){
            await assert.rejects(auth.setup(request(old,{password,confirmPassword:confirmation})));
            assert.equal(auth.needsSetup(),true);
        }
        const results=await Promise.allSettled(['first-password','second-password'].map(password=>auth.setup(request('111111',{password,confirmPassword:password}))));
        assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
        assert.equal(auth.isAdmin(request('111111')),false);assert.equal(auth.isAdmin(request('first-password')),true);
        assert.equal(auth.needsSetup(),false);
        await assert.rejects(auth.setup(request('first-password',{password:'another-password',confirmPassword:'another-password'})));
        const stored=JSON.parse(await fs.readFile(auth.file,'utf8'));assert.equal(stored.requiresSetup,false);
        assert.equal((await fs.stat(auth.file)).mode&0o777,0o600);
        process.env.ADMIN_PASSWORD='111111';
        const restarted=await createAuth(store);assert.equal(restarted.needsSetup(),false);assert.equal(restarted.isAdmin(request('first-password')),true);
    }finally{
        if(savedEnv===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=savedEnv;
        await fs.rm(directory,{recursive:true,force:true});
    }
});
