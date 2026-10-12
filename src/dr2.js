import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './paths.js';
import {uniqueSubscriptionByToken} from './subscriptions.js';

export function registerDr2Routes(app,store){
    const subscription=request=>{
        const sub=uniqueSubscriptionByToken(store.state,request.params.credential);
        if(!sub)throw Object.assign(new Error('订阅凭证无效或已停用'),{statusCode:403});
        return sub;
    };
    const libraries=new Map(['drpy/drpy2.min.js','dist/drpy-core-lite.min.js'].map(file=>[file,path.join(ROOT,'engine/client',file)]));
    const send=(reply,body)=>reply.header('Cache-Control','private, no-store').type('text/javascript; charset=utf-8').send(body);
    app.get('/tvbox/:credential/runtime/*',async(request,reply)=>{
        subscription(request);
        const file=libraries.get(request.params['*']);
        if(!file)throw Object.assign(new Error('运行库不存在'),{statusCode:404});
        return send(reply,await fs.readFile(file));
    });
    app.get('/tvbox/:credential/source/:id.js',async(request,reply)=>{
        const sub=subscription(request);
        const instance=store.state.instances.find(i=>i.id===request.params.id&&i.enabled&&sub.instances.includes(i.id));
        const script=instance&&store.state.scripts.find(s=>s.id===instance.scriptId&&s.engine==='dr2');
        if(!script)throw Object.assign(new Error('此订阅不包含该DR2源'),{statusCode:403});
        // Client receives its selected script, never source ENV or account files.
        return send(reply,await fs.readFile(store.scriptPath(script)));
    });
}
