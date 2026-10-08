import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const image = process.argv[2];
assert.ok(image, '用法：node scripts/container-matrix.mjs <image>');
assert.equal(process.platform,'linux','必须在原生 Linux runner 验收');
assert.equal(process.arch,'x64','必须在原生 amd64 runner 验收，不能用模拟架构替代');
const output = path.resolve(process.env.CONTAINER_REPORT_DIR || path.join(os.tmpdir(),'coketv-container-report'));
await fs.mkdir(output,{recursive:true});
const redact = text => String(text || '').replace(/首次部署初始化码：[^\r\n]+/g,'首次部署初始化码：[已隐藏]');
const docker = args => {
    const result = spawnSync('docker',args,{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024});
    if (result.error || result.status !== 0) {
        const error = new Error('Docker 验收命令失败：' + args[0]);
        error.output = redact((result.stdout || '') + (result.stderr || '')); throw error;
    }
    return args[0] === 'logs' ? redact(result.stdout + result.stderr) : result.stdout;
};
const inspected = JSON.parse(docker(['image','inspect',image]))[0];
assert.equal(inspected.Os + '/' + inspected.Architecture,'linux/amd64');
assert.ok(inspected.Config.User && !['root','0','0:0'].includes(inspected.Config.User));
const id = randomBytes(6).toString('hex');
const names = [], volumes = [];
const report = {sourceSha:inspected.Config.Labels?.['org.opencontainers.image.revision'] || 'unlabelled',verificationSha:process.env.GITHUB_SHA || 'local-unpublished',imageId:inspected.Id,platform:'linux/amd64',checks:[],completed:false};
const run = args => docker(args);
const create = (scenario, extra = []) => {
    const name = `coketv-${scenario}-${id}`, volume = `${name}-data`;
    names.push(name); volumes.push(volume);
    run(['volume','create',volume]);
    run(['run','-d','--name',name,'--platform','linux/amd64','--cap-drop=ALL','--security-opt=no-new-privileges:true','-v',volume+':/app/data',...extra,image]);
    return name;
};
const inside = (name,args) => run(['exec',name,...args]);
const wait = async name => {
    for (let attempt=0;attempt<60;attempt++) {
        try { inside(name,['node','-e',"fetch('http://127.0.0.1:54058/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]); return; } catch {}
        await new Promise(resolve => setTimeout(resolve,1000));
    }
    throw new Error('临时容器启动超时：'+name);
};
const inject = name => {
    run(['cp',path.join(root,'tests'),name+':/app/tests']);
    for (const script of ['container-smoke.mjs','image-verify.mjs']) run(['cp',path.join(root,'scripts',script),name+':/app/scripts/'+script]);
};
try {
    const clean = create('clean'); await wait(clean);
    // Before injecting test code, inspect the actual distribution and shipped CLI.
    inside(clean,['node','scripts/check-shell.mjs']);
    inside(clean,['node','-e',"const fs=require('fs'); for(const p of ['/app/tests','/app/.tools','/app/.venv','/app/HANDOFF.md','/app/scripts/container-smoke.mjs','/app/scripts/image-verify.mjs']) if(fs.existsSync(p)) throw Error('非发行文件进入镜像：'+p); if(process.getuid()===0) throw Error('root'); console.log(JSON.stringify({uid:process.getuid(),node:process.version,arch:process.arch}));"]);
    inside(clean,['node','scripts/verify.mjs','--help']);
    report.runtime = {node:inside(clean,['node','--version']).trim(),python:inside(clean,['/opt/python/bin/python3','--version']).trim(),php:inside(clean,['php','-v']).split('\n')[0],uid:inside(clean,['id','-u']).trim()};
    assert.equal(report.runtime.uid,'1000','README 的卷属主修正需与实际 UID 一致');
    inject(clean);
    inside(clean,['node','scripts/container-smoke.mjs']); report.checks.push('empty-data/setup/auth/templates/non-root/zero-sources/CLI-distribution');
    inside(clean,['node','scripts/image-verify.mjs']); report.checks.push('five-engines/real-GET-HEAD-Range-HLS-key/CLI');
    run(['restart',clean]); await wait(clean);
    inside(clean,['node','scripts/image-verify.mjs','--persistence']); report.checks.push('same-volume-restart/snapshot/old-ticket-invalid/five-engine-media-replay');

    // Every regression creates its own temporary data; no test mutates /app/data.
    const regressions = create('regressions'); await wait(regressions); inject(regressions);
    const files = ['core','access','integration','tvbox-import','cat-subscriptions','cat-client','netdisk-115','netdisk-cipher','netdisk-integration','shell','runtime-upgrade','bridge','private-data','source-env','playback-capabilities','playback','outbound','ssrf','proxy-headers','rate-limit','security','verify-cli'];
    let tap;
    try { tap = inside(regressions,['env','TEST_PYTHON=/opt/python/bin/python3','TEST_PHP=php','node','--test','--test-reporter=tap',...files.map(file=>'tests/'+file+'.test.js')]); }
    catch (error) { await fs.writeFile(path.join(output,'regressions.tap'),error.output || error.message); throw error; }
    await fs.writeFile(path.join(output,'regressions.tap'),tap);
    assert.match(tap,/# fail 0\s/); assert.match(tap,/# skipped 0\s/); assert.doesNotMatch(tap,/^not ok /m);
    report.backendTests = Number(tap.match(/# tests (\d+)/)?.[1]);
    assert.ok(report.backendTests > 0); report.regressionFiles = files;
    report.checks.push('frozen-ae89c27-upgrade/pickle-rejection/user-content-preservation/headers/tickets/SSRF/private-0600/PHP-errors/CLI-v2-legacy-pty');

    // Startup errors must retain the exact corrupt input; use independent volumes.
    for (const relative of ['state.json','runtime/config/env.json']) {
        const bad = create(relative === 'state.json' ? 'bad-state' : 'bad-env'); await wait(bad);
        run(['stop',bad]);
        const file = '/app/data/'+relative;
        run(['run','--rm','--platform','linux/amd64','--cap-drop=ALL','--security-opt=no-new-privileges:true','-v',volumes.at(-1)+':/app/data','--entrypoint','node',image,'-e',`require('fs').writeFileSync(${JSON.stringify(file)},'{broken',{mode:0o600})`]);
        run(['start',bad]);
        for (let attempt=0;attempt<30;attempt++) { if(run(['inspect','--format','{{.State.Running}}',bad]).trim()==='false') break; await new Promise(resolve=>setTimeout(resolve,1000)); }
        assert.equal(run(['inspect','--format','{{.State.Running}}',bad]).trim(),'false');
        assert.notEqual(run(['inspect','--format','{{.State.ExitCode}}',bad]).trim(),'0');
        const content = run(['run','--rm','-v',volumes.at(-1)+':/app/data','--entrypoint','node',image,'-e',`process.stdout.write(require('fs').readFileSync(${JSON.stringify(file)}))`]);
        assert.equal(content,'{broken');
    }
    report.checks.push('corrupt-state-and-ENV-refuse-start-preserve-input');
    const owner = create('old-owner'); await wait(owner); run(['stop',owner]);
    const ownerVolume = volumes.at(-1);
    // Root is used only in a disposable helper to synthesize/fix historical ownership.
    run(['run','--rm','--user','0:0','-v',ownerVolume+':/app/data','--entrypoint','chown',image,'-R','0:0','/app/data']);
    run(['start',owner]);
    for (let attempt=0;attempt<30;attempt++) { if(run(['inspect','--format','{{.State.Running}}',owner]).trim()==='false') break; await new Promise(resolve=>setTimeout(resolve,1000)); }
    assert.equal(run(['inspect','--format','{{.State.Running}}',owner]).trim(),'false','旧 root 属主应要求修正');
    run(['run','--rm','--user','0:0','-v',ownerVolume+':/app/data','--entrypoint','chown',image,'-R','1000:1000','/app/data']);
    run(['start',owner]); await wait(owner); inject(owner);
    inside(owner,['node','scripts/container-smoke.mjs']); report.checks.push('old-root-owner-fails/README-chown-recovers');
    assert.equal(JSON.parse(run(['image','inspect',image]))[0].Id,report.imageId,'验收不得改变发行镜像');
    report.completed = true;
    console.log(JSON.stringify(report,null,2));
} catch (error) {
    await fs.writeFile(path.join(output,'failure.log'),error.output || error.message); throw error;
} finally {
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
    for (const name of names) {
        try { await fs.writeFile(path.join(output,name+'.log'),run(['logs',name])); } catch {}
        try { run(['rm','-f',name]); } catch {}
    }
    for (const volume of volumes) { try { run(['volume','rm',volume]); } catch {} }
}
