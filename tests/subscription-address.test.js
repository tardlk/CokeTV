import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.js';

async function fixture(t, trustProxy = false) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(),'coketv-address-'));
    const previous = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = trustProxy ? '1' : '0';
    let app;
    try { app = await createApp({directory,seed:false}); }
    finally { if (previous === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = previous; }
    t.after(async()=>{await app.close();await fs.rm(directory,{recursive:true,force:true});});
    await app.inject({method:'POST',url:'/admin/access/setup',payload:{password:'address-fixture',confirmPassword:'address-fixture'}});
    const authorization='Basic '+Buffer.from(':address-fixture').toString('base64');
    const source=await app.store.saveScript('dr3','address.js',`export default {meta:{lang:'dr3'},rule:{},action:async(ctx)=>({proxy:await ctx.getProxyUrl()})};`);
    const sub=app.store.state.subscriptions[0];sub.instances=[source.id];
    // Existing data must not force every visitor onto a historical address or timeout.
    app.store.state.settings.publicUrl='https://old.invalid/base';app.store.state.settings.timeout=1;
    return {app,source,sub,authorization};
}

test('域名、内网IP和IPv6访问分别生成同源订阅接口、猫影视配置及源代理地址',async t=>{
    const {app,source,sub}=await fixture(t);
    for (const host of ['abc.com:54058','192.168.1.10:54058','[fd00::1]:54058']) {
        const origin='http://'+host,headers={host};
        const subscription=await app.inject({url:'/tvbox/'+sub.token,headers});
        assert.equal(subscription.statusCode,200,subscription.body);
        assert.equal(new URL(subscription.json().sites[0].api).origin,origin);
        const config=await app.inject({url:'/cat/'+sub.token+'/index.config.js',headers});
        assert.equal(config.statusCode,200,config.body);assert.ok(config.body.includes(origin+'/cat/'+sub.token));
        const manifest=await app.inject({url:'/cat/'+sub.token+'/manifest',headers});
        assert.equal(manifest.json().timeout,30000);
        const action=await app.inject({url:'/api/'+source.id+'?'+new URLSearchParams({ac:'action',action:'origin',token:sub.token}),headers});
        assert.equal(action.statusCode,200,action.body);assert.equal(new URL(action.json().proxy).origin,origin);
    }
});

test('仅可信反代启用转发Host和HTTPS，默认忽略伪造转发头',async t=>{
    for (const trustProxy of [false,true]) {
        const {app,sub}=await fixture(t,trustProxy);
        const response=await app.inject({url:'/tvbox/'+sub.token,headers:{host:'internal:54058','x-forwarded-host':'tv.example.com:8443','x-forwarded-proto':'https'}});
        assert.equal(response.statusCode,200,response.body);
        assert.equal(new URL(response.json().sites[0].api).origin,trustProxy?'https://tv.example.com:8443':'http://internal:54058');
    }
});

test('设置保存不再需要地址或超时，旧字段不能重新开启覆盖；环境检测API已删除',async t=>{
    const {app,sub,authorization}=await fixture(t);
    const headers={authorization};
    const save=await app.inject({method:'PUT',url:'/admin/settings',headers,payload:{env:{},parses:[],lives:[],publicUrl:'https://override.invalid',timeout:1}});
    assert.equal(save.statusCode,200,save.body);
    assert.equal(app.store.state.settings.publicUrl,undefined);assert.equal(app.store.state.settings.timeout,undefined);
    const state=await app.inject({url:'/admin/state',headers});assert.equal(state.json().baseUrl,undefined);
    const response=await app.inject({url:'/tvbox/'+sub.token,headers:{host:'abc.com:54058'}});
    assert.equal(new URL(response.json().sites[0].api).origin,'http://abc.com:54058');
    assert.equal((await app.inject({url:'/admin/dependencies',headers})).statusCode,404);
    const policy={jsonPublic:true,allowPrivateTargets:false,targetAllowlist:['allowed.fixture.invalid']};
    Object.assign(app.store.state.settings,policy);
    const noLegacyFields=await app.inject({method:'PUT',url:'/admin/settings',headers,payload:{env:{},parses:[],lives:[]}});
    assert.equal(noLegacyFields.statusCode,200,noLegacyFields.body);
    for(const [key,value] of Object.entries(policy))assert.deepEqual(app.store.state.settings[key],value,'保存其他设置不能重置隐藏策略: '+key);
});
