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
        assert.equal(auth.needsSetup(),true);assert.equal(await auth.isAdmin(request('111111')),false);
        assert.equal(JSON.parse(await fs.readFile(auth.file,'utf8')).password,undefined);
        const code=auth.setupCode;assert.ok(typeof code==='string'&&code.length>=8);
        assert.equal((await fs.stat(path.join(directory,'setup-code.txt'))).mode&0o777,0o600);
        await assert.rejects(auth.setup({headers:{},body:{password:'first-password',confirmPassword:'first-password'}}));
        await assert.rejects(auth.setup({headers:{},body:{password:'first-password',confirmPassword:'first-password',setupCode:'wrong-code'}}));
        assert.equal(auth.needsSetup(),true);
        for(const [password,confirmation] of [['short','short'],['newpass','mismatch']]){
            await assert.rejects(auth.setup({headers:{},body:{password,confirmPassword:confirmation,setupCode:code}}));
            assert.equal(auth.needsSetup(),true);
        }
        const results=await Promise.allSettled(['first-password','second-password'].map(password=>auth.setup({headers:{},body:{password,confirmPassword:password,setupCode:code}})));
        assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
        assert.equal(await auth.isAdmin(request('111111')),false);assert.equal(await auth.isAdmin(request('first-password')),true);
        assert.equal(auth.needsSetup(),false);assert.equal(auth.setupCode,null);
        await assert.rejects(fs.access(path.join(directory,'setup-code.txt')));
        await assert.rejects(auth.setup(request('first-password',{password:'another-password',confirmPassword:'another-password'})));
        const stored=JSON.parse(await fs.readFile(auth.file,'utf8'));assert.equal(stored.requiresSetup,false);
        assert.equal((await fs.stat(auth.file)).mode&0o777,0o600);
        process.env.ADMIN_PASSWORD='111111';
        const restarted=await createAuth(store);assert.equal(restarted.needsSetup(),false);assert.equal(await restarted.isAdmin(request('first-password')),true);
        delete process.env.ADMIN_PASSWORD;
        const anotherDirectory=path.join(directory,'fresh');await fs.mkdir(anotherDirectory);
        const fresh=await createAuth({...store,directory:anotherDirectory});
        await fresh.setup({headers:{},body:{password:'111111',confirmPassword:'111111',setupCode:fresh.setupCode}});
        assert.equal(fresh.needsSetup(),false);assert.equal(await fresh.isAdmin(request('111111')),true);
    }finally{
        if(savedEnv===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=savedEnv;
        await fs.rm(directory,{recursive:true,force:true});
    }
});
test('M1：新装写加盐 KDF 不含明文；旧明文格式在首登成功后迁移',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-kdf-'));
    const savedEnv=process.env.ADMIN_PASSWORD;delete process.env.ADMIN_PASSWORD;
    const store={directory,atomic:async(file,content)=>{await fs.writeFile(file+'.tmp',content);await fs.rename(file+'.tmp',file);}};
    const basic=password=>({headers:{authorization:'Basic '+Buffer.from(':'+password).toString('base64')}});
    try{
        let auth=await createAuth(store);
        await auth.setup({headers:{},body:{password:'kdf-password',confirmPassword:'kdf-password',setupCode:auth.setupCode}});
        const saved=JSON.parse(await fs.readFile(auth.file,'utf8'));
        assert.equal(saved.version,2);assert.equal(saved.password,undefined);
        assert.ok(!JSON.stringify(saved).includes('kdf-password'));
        assert.equal((await fs.stat(auth.file)).mode&0o777,0o600);
        // 旧明文格式：登录成功时迁移
        await fs.writeFile(auth.file,JSON.stringify({password:'legacy-password',requiresSetup:false}),{mode:0o600});
        auth=await createAuth(store);
        assert.equal(await auth.isAdmin(basic('wrong-password')),false);
        assert.equal(await auth.isAdmin(basic('legacy-password')),true);
        await new Promise(resolve=>setTimeout(resolve,300));
        const migrated=JSON.parse(await fs.readFile(auth.file,'utf8'));
        assert.equal(migrated.version,2);assert.equal(migrated.password,undefined);
        assert.ok(!JSON.stringify(migrated).includes('legacy-password'));
        const restarted=await createAuth(store);assert.equal(await restarted.isAdmin(basic('legacy-password')),true);
        // 错误密码不触发迁移
        await fs.writeFile(auth.file,JSON.stringify({password:'legacy-password',requiresSetup:false}),{mode:0o600});
        const bad=await createAuth(store);
        await bad.isAdmin(basic('nope-password'));
        await new Promise(resolve=>setTimeout(resolve,150));
        assert.equal(JSON.parse(await fs.readFile(bad.file,'utf8')).password,'legacy-password');
    }finally{
        if(savedEnv===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=savedEnv;
        await fs.rm(directory,{recursive:true,force:true});
    }
});
