import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAuth} from '../src/auth.js';

const request=(password,body)=>({headers:{authorization:'Basic '+Buffer.from(':'+password).toString('base64')},body});
test('首装无需初始化码即可创建密码，重启后密码继续有效',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-direct-setup-'));
    const savedEnv=process.env.ADMIN_PASSWORD;delete process.env.ADMIN_PASSWORD;
    const store={directory,atomic:async(file,content)=>fs.writeFile(file,content,{mode:0o600})};
    try{
        const auth=await createAuth(store);
        assert.deepEqual(await auth.setup({body:{password:'direct-password',confirmPassword:'direct-password'}}),{ok:true});
        assert.equal('setupCode' in auth,false);
        await assert.rejects(fs.access(path.join(directory,'setup-code.txt')),{code:'ENOENT'});
        const restarted=await createAuth(store);
        assert.equal(restarted.needsSetup(),false);
        assert.equal(await restarted.isAdmin(request('direct-password')),true);
        await assert.rejects(restarted.setup({body:{password:'replacement',confirmPassword:'replacement'}}),{statusCode:409});
    }finally{
        if(savedEnv===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=savedEnv;
        await fs.rm(directory,{recursive:true,force:true});
    }
});
test('升级清理旧初始化码，仅删除遗留码文件并保留其他运行数据',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-setup-upgrade-'));
    const savedEnv=process.env.ADMIN_PASSWORD;delete process.env.ADMIN_PASSWORD;
    const store={directory,atomic:async(file,content)=>fs.writeFile(file,content,{mode:0o600})};
    try{
        const codeFile=path.join(directory,'setup-code.txt');
        const adminFile=path.join(directory,'admin.json');
        const otherFile=path.join(directory,'state.json');
        const admin=JSON.stringify({requiresSetup:true});
        await fs.writeFile(adminFile,admin,{mode:0o600});
        await fs.writeFile(codeFile,'legacy-code',{mode:0o600});
        await fs.writeFile(otherFile,'preserved-user-data');
        const auth=await createAuth(store);
        assert.equal(auth.needsSetup(),true);
        await assert.rejects(fs.access(codeFile),{code:'ENOENT'});
        assert.equal(await fs.readFile(adminFile,'utf8'),admin);
        assert.equal(await fs.readFile(otherFile,'utf8'),'preserved-user-data');
        await createAuth(store);
        await assert.rejects(fs.access(codeFile),{code:'ENOENT'});
        await auth.setup({body:{password:'kept-password',confirmPassword:'kept-password'}});
        const saved=await fs.readFile(adminFile,'utf8');
        await fs.writeFile(codeFile,'another-legacy-code',{mode:0o600});
        const restarted=await createAuth(store);
        assert.equal(await restarted.isAdmin(request('kept-password')),true);
        assert.equal(await fs.readFile(adminFile,'utf8'),saved);
        assert.equal(await fs.readFile(otherFile,'utf8'),'preserved-user-data');
        await assert.rejects(fs.access(codeFile),{code:'ENOENT'});
    }finally{
        if(savedEnv===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=savedEnv;
        await fs.rm(directory,{recursive:true,force:true});
    }
});
test('ADMIN_PASSWORD 预设跳过首次设密，重启仍需提供且不写明文',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-env-setup-'));
    const savedEnv=process.env.ADMIN_PASSWORD;
    const store={directory,atomic:async(file,content)=>fs.writeFile(file,content,{mode:0o600})};
    try{
        await fs.writeFile(path.join(directory,'admin.json'),JSON.stringify({requiresSetup:true}),{mode:0o600});
        process.env.ADMIN_PASSWORD='environment-password';
        const auth=await createAuth(store);
        assert.equal(auth.needsSetup(),false);
        assert.equal(await auth.isAdmin(request('environment-password')),true);
        await assert.rejects(auth.setup({body:{password:'replacement',confirmPassword:'replacement'}}),{statusCode:409});
        assert.deepEqual(JSON.parse(await fs.readFile(auth.file,'utf8')),{requiresSetup:true});
        const restarted=await createAuth(store);
        assert.equal(await restarted.isAdmin(request('environment-password')),true);
        delete process.env.ADMIN_PASSWORD;
        assert.equal((await createAuth(store)).needsSetup(),true);
        await assert.rejects(fs.access(path.join(directory,'setup-code.txt')),{code:'ENOENT'});
    }finally{
        if(savedEnv===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=savedEnv;
        await fs.rm(directory,{recursive:true,force:true});
    }
});
test('没有初始密码，首次直接创建；注册后持久化并禁止重新注册',async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'coketv-access-'));
    const savedEnv=process.env.ADMIN_PASSWORD;delete process.env.ADMIN_PASSWORD;
    const store={directory,atomic:async(file,content)=>{await fs.writeFile(file+'.tmp',content);await fs.rename(file+'.tmp',file);}};
    try{
        const auth=await createAuth(store);
        assert.equal(auth.needsSetup(),true);assert.equal(await auth.isAdmin(request('111111')),false);
        assert.equal(JSON.parse(await fs.readFile(auth.file,'utf8')).password,undefined);
        assert.equal('setupCode' in auth,false);
        await assert.rejects(fs.access(path.join(directory,'setup-code.txt')),{code:'ENOENT'});
        assert.equal(auth.needsSetup(),true);
        for(const [password,confirmation] of [['short','short'],['newpass','mismatch'],['      ','      '],['x'.repeat(201),'x'.repeat(201)],[null,null]]){
            await assert.rejects(auth.setup({headers:{},body:{password,confirmPassword:confirmation}}),{statusCode:400});
            assert.equal(auth.needsSetup(),true);
        }
        const results=await Promise.allSettled(['first-password','second-password'].map(password=>auth.setup({headers:{},body:{password,confirmPassword:password}})));
        assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
        assert.equal(results.find(result=>result.status==='rejected').reason.statusCode,409);
        assert.equal(await auth.isAdmin(request('111111')),false);assert.equal(await auth.isAdmin(request('first-password')),true);
        assert.equal(auth.needsSetup(),false);
        await assert.rejects(fs.access(path.join(directory,'setup-code.txt')));
        await assert.rejects(auth.setup(request('first-password',{password:'another-password',confirmPassword:'another-password'})));
        const stored=JSON.parse(await fs.readFile(auth.file,'utf8'));assert.equal(stored.requiresSetup,false);
        assert.equal((await fs.stat(auth.file)).mode&0o777,0o600);
        process.env.ADMIN_PASSWORD='111111';
        const restarted=await createAuth(store);assert.equal(restarted.needsSetup(),false);assert.equal(await restarted.isAdmin(request('first-password')),true);
        delete process.env.ADMIN_PASSWORD;
        const anotherDirectory=path.join(directory,'fresh');await fs.mkdir(anotherDirectory);
        const fresh=await createAuth({...store,directory:anotherDirectory});
        await fresh.setup({headers:{},body:{password:'111111',confirmPassword:'111111'}});
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
        await auth.setup({headers:{},body:{password:'kdf-password',confirmPassword:'kdf-password'}});
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
