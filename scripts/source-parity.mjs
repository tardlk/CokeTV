import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {ROOT} from '../src/paths.js';
import {checkEngine} from './check-engine.mjs';
import {probe} from './source-parity-probe.mjs';

// Developer/CI tool. Uses a disposable original container; no host data mounts.
const baseline=await checkEngine();
const docker=process.env.SOURCE_PARITY_DOCKER||'docker';
const name='coketv-source-parity-'+crypto.randomBytes(6).toString('hex');
const image=baseline.image;
const report={version:baseline.version,image,revision:baseline.revision,completed:false};
const output=process.env.SOURCE_PARITY_REPORT_DIR;
const command=(args,{input,allowFailure=false}={})=>{
    const r=spawnSync(docker,args,{encoding:'utf8',input,maxBuffer:64*1024*1024,timeout:300000});
    if(!allowFailure&&(r.error||r.status!==0))throw new Error(`Docker ${args[0]}失败：${r.error?.message||r.stderr||r.stdout}`);
    return r;
};
const hadImage=command(['image','inspect',image],{allowFailure:true}).status===0;
let created=false;
try{
    if(!hadImage)command(['pull',image]);
    command(['run','-d','--name',name,'--memory','1600m',image]);created=true;
    const identity=JSON.parse(command(['inspect','--format','{{json .Config.Labels}}',name]).stdout);
    assert.equal(identity['org.opencontainers.image.revision'],baseline.revision,'原版镜像revision不符');
    report.architecture=command(['image','inspect','--format','{{.Architecture}}',image]).stdout.trim();
    // Verify the whole registered upstream layer, not only the version string.
    const validate=`const fs=require('fs'),c=require('crypto'),b=JSON.parse(fs.readFileSync(0));for(const [f,v]of Object.entries(b.files)){if(v.upstreamSha256){const h=c.createHash('sha256').update(fs.readFileSync('/app/'+(v.upstreamPath||f))).digest('hex');if(h!==v.upstreamSha256)throw Error('Upstream drift: '+f);}}console.log('upstream files verified');`;
    command(['exec','-i',name,'node','-e',validate],{input:JSON.stringify(baseline)});
    for(const [local,remote]of [['scripts/source-parity-probe.mjs','/tmp/source-parity-probe.mjs'],['tests/fixtures/source-parity/cases.mjs','/tmp/source-parity-cases.mjs']]){
        command(['exec','-i',name,'node','-e',`require('fs').writeFileSync(${JSON.stringify(remote)},require('fs').readFileSync(0),{mode:0o600})`],{input:await fs.readFile(path.join(ROOT,local),'utf8')});
    }
    command(['exec',name,'node','/tmp/source-parity-probe.mjs','original','/app','/tmp/source-parity-cases.mjs','/tmp/source-parity.json']);
    const original=JSON.parse(command(['exec',name,'node','-e',"process.stdout.write(require('fs').readFileSync('/tmp/source-parity.json'))"]).stdout);
    const frozen=JSON.parse(await fs.readFile(path.join(ROOT,'tests/fixtures/source-parity/original-2.0.6.json'),'utf8'));
    const candidate=await probe();
    report.cases=original.length;
    report.differences=original.filter((row,index)=>!isDeepStrictEqual(row,candidate[index])).map(row=>row.case);
    assert.deepEqual(original,frozen,'固定原版与冻结响应不符，不得自动更新快照');
    assert.deepEqual(candidate,original,'CokeTV与原版同输入存在差异');
    report.completed=true;
    console.log(JSON.stringify(report,null,2));
}finally{
    if(created)command(['rm','-f',name],{allowFailure:true});
    if(!hadImage)command(['image','rm',image],{allowFailure:true});
    if(output){await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');}
}
