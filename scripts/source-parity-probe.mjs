import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

// Runs the exact same synthetic inputs through the original HTTP API or CokeTV.
export async function probe({originalRoot,projectRoot=process.cwd(),fixtures,output}={}) {
    const {sources,marker,extension}=await import(pathToFileURL(fixtures||path.join(projectRoot,'tests/fixtures/source-parity/cases.mjs')).href);
    const directory=originalRoot||await fs.mkdtemp(path.join(os.tmpdir(),'coketv-source-parity-'));
    let app,base,authorization,pwd;const files=[],rows=[],ids=new Map();
    const normalize=(value,source)=>{
        if(Array.isArray(value))return value.map(x=>normalize(x,source));
        if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='cost').map(([key,x])=>[key,normalize(x,source)]));
        if(typeof value==='string'&&value.length>1024*1024)return {length:value.length,sha256:crypto.createHash('sha256').update(value).digest('hex')};
        if(typeof value==='string'&&value.startsWith(base+'/proxy/')) {
            const u=new URL(value),parts=u.pathname.split('/');
            const target=decodeURIComponent(parts[2]);
            const entry=sources.find(s=>target===ids.get(s.name)||target===marker+s.name);
            if(entry){parts[2]=marker+entry.name;u.pathname=parts.join('/');}
            u.hostname='fixture.example.test';u.port='';u.searchParams.delete('token');
            if(u.searchParams.get('do')==='ds')u.searchParams.set('do','js');
            u.searchParams.sort();return u.href;
        }
        return value;
    };
    try {
        if(originalRoot){
            const require=createRequire(path.join(originalRoot,'package.json'));
            pwd=require('dotenv').parse(await fs.readFile(path.join(originalRoot,'.env'))).API_PWD;
            base='http://127.0.0.1:5757';
            for(let i=0;i<100;i++){try{if((await fetch(base,{signal:AbortSignal.timeout(500)})).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
        }else{
            const {createApp}=await import(pathToFileURL(path.join(projectRoot,'src/server.js')).href);
            app=await createApp({directory,seed:false});
            app.store.state.settings.pythonPath=process.env.TEST_PYTHON||app.store.state.settings.pythonPath;
            app.store.state.settings.phpPath=process.env.TEST_PHP||app.store.state.settings.phpPath;
            await app.inject({method:'POST',url:'/admin/access/setup',payload:{password:'parity-fixture-only',confirmPassword:'parity-fixture-only'}});
            authorization='Basic '+Buffer.from(':parity-fixture-only').toString('base64');
            await app.listen({host:'127.0.0.1',port:0});base='http://127.0.0.1:'+app.server.address().port;
        }
        for(const s of sources){
            const file=marker+s.name+extension(s.engine);
            if(originalRoot){const dir=s.engine==='cat'?'catvod':s.engine;const full=path.join(originalRoot,'spider',dir,file);await fs.writeFile(full,s.code);files.push(full);ids.set(s.name,marker+s.name);}
            else{const saved=await app.store.saveScript(s.engine,file,s.code);ids.set(s.name,saved.id);}
        }
        // Cat first: tests must not warm the shared globals through an earlier JS request.
        const ordered=[...sources].sort((a,b)=>(a.name==='cat_cold'?-1:b.name==='cat_cold'?1:0));
        for(const s of ordered){
            if(app)app.store.state.settings.timeout=s.timeout||30000;
            for(const [index,query]of s.queries.entries()){
            const url=originalRoot?base+'/api/'+ids.get(s.name)+'?do='+s.engine:base+'/api/'+ids.get(s.name);
            const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...(authorization?{authorization}:{})},body:JSON.stringify(originalRoot?{pwd,...query}:query),signal:AbortSignal.timeout(30000)});
            const text=await response.text();let result;try{result=JSON.parse(text);}catch{result={invalidJson:true};}
            // Refresh executes the same lifecycle. Coke deliberately does not expose
            // the original rule/config object; the next request verifies re-init.
            rows.push({case:s.name+':'+index,engine:s.engine,status:response.status,result:'refresh'in query?{refreshed:response.ok}:normalize(result,s)});
            }
        }
        if(output)await fs.writeFile(output,JSON.stringify(rows,null,2)+'\n');
        return rows;
    }finally{await app?.close();if(originalRoot){for(const file of files)await fs.rm(file,{force:true});}else await fs.rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
    const [mode,root,fixtures,output]=process.argv.slice(2);
    const rows=await probe({...(mode==='original'?{originalRoot:root}:{projectRoot:root}),fixtures,output});
    console.log(JSON.stringify(rows.map(r=>({case:r.case,status:r.status}))));
}
