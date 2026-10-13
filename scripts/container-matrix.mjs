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
// 兼容旧版镜像的历史日志脱敏；当前源码不再输出初始化码。
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
assert.equal(inspected.Config.User, 'root', 'root 只用于入口权限初始化');
assert.deepEqual(inspected.Config.Entrypoint, ['/usr/local/bin/coketv-entrypoint']);
const id = randomBytes(6).toString('hex');
const names = [], volumes = [];
const identities = new Map();
const report = {sourceSha:inspected.Config.Labels?.['org.opencontainers.image.revision'] || 'unlabelled',verificationSha:process.env.GITHUB_SHA || 'local-unpublished',imageId:inspected.Id,platform:'linux/amd64',checks:[],completed:false};
const run = args => docker(args);
const startupSecurity = ['--cap-drop=ALL', ...['CHOWN','DAC_OVERRIDE','FOWNER','SETUID','SETGID','SETPCAP'].flatMap(cap => ['--cap-add',cap]), '--security-opt=no-new-privileges:true'];
const create = (scenario, extra = [], security = startupSecurity) => {
    const name = `coketv-${scenario}-${id}`, volume = `${name}-data`;
    const environment = extra.filter((value,index) => extra[index-1] === '-e');
    identities.set(name, {uid:Number(environment.find(value=>value.startsWith('PUID='))?.slice(5) || 1000),gid:Number(environment.find(value=>value.startsWith('PGID='))?.slice(5) || 1000)});
    names.push(name); volumes.push(volume);
    run(['volume','create',volume]);
    run(['run','-d','--name',name,'--platform','linux/amd64',...security,'-v',volume+':/app/data',...extra,image]);
    return name;
};
const inside = (name,args) => {
    const {uid,gid} = identities.get(name) || {uid:1000,gid:1000};
    return run(['exec','--user',`${uid}:${gid}`,name,...args]);
};
const assertServiceIdentity = name => {
    const {uid,gid} = identities.get(name) || {uid:1000,gid:1000};
    const status = inside(name,['cat','/proc/1/status']);
    assert.match(status, new RegExp(`^Uid:\\s+${uid}\\s+${uid}\\s+${uid}\\s+${uid}$`, 'm'));
    assert.match(status, new RegExp(`^Gid:\\s+${gid}\\s+${gid}\\s+${gid}\\s+${gid}$`, 'm'));
    assert.match(status, /^Groups:\s*$/m);
    for (const key of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']) assert.match(status,new RegExp('^'+key+':\\s+0+$','m'));
    assert.match(status, /^NoNewPrivs:\s+1$/m);
};
const wait = async name => {
    for (let attempt=0;attempt<60;attempt++) {
        try { inside(name,['node','-e',"fetch('http://127.0.0.1:54058/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]); return; } catch {}
        await new Promise(resolve => setTimeout(resolve,1000));
    }
    throw new Error('临时容器启动超时：'+name);
};
const inject = name => {
    run(['cp',path.join(root,'tests'),name+':/app/tests']);
    for (const script of ['container-smoke.mjs','image-verify.mjs','source-parity-probe.mjs']) run(['cp',path.join(root,'scripts',script),name+':/app/scripts/'+script]);
};
try {
    const clean = create('clean'); await wait(clean);
    assertServiceIdentity(clean);
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
    const files = ['container-data','runtime-parity','dr2-delivery','source-compatibility','emby','emby-engines','emby-storage','core','access','subscription-tokens','integration','tvbox-import','cat-subscriptions','cat-client','netdisk-115','netdisk-cipher','netdisk-integration','netdisk-direct','netdisk-guangya','review-regressions','shell','runtime-upgrade','bridge','private-data','source-env','playback-capabilities','playback','outbound','ssrf','proxy-headers','rate-limit','security','verify-cli'];
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
        run(['run','--rm','--user','1000:1000','--platform','linux/amd64','--cap-drop=ALL','--security-opt=no-new-privileges:true','-v',volumes.at(-1)+':/app/data','--entrypoint','node',image,'-e',`require('fs').writeFileSync(${JSON.stringify(file)},'{broken',{mode:0o600})`]);
        run(['start',bad]);
        for (let attempt=0;attempt<30;attempt++) { if(run(['inspect','--format','{{.State.Running}}',bad]).trim()==='false') break; await new Promise(resolve=>setTimeout(resolve,1000)); }
        assert.equal(run(['inspect','--format','{{.State.Running}}',bad]).trim(),'false');
        assert.notEqual(run(['inspect','--format','{{.State.ExitCode}}',bad]).trim(),'0');
        const content = run(['run','--rm','-v',volumes.at(-1)+':/app/data','--entrypoint','node',image,'-e',`process.stdout.write(require('fs').readFileSync(${JSON.stringify(file)}))`]);
        assert.equal(content,'{broken');
    }
    report.checks.push('corrupt-state-and-ENV-refuse-start-preserve-input');
    const owner = create('old-owner'); await wait(owner);
    const ownerVolume = volumes.at(-1);
    const originalState = inside(owner,['cat','/app/data/state.json']);
    run(['stop',owner]);
    // Synthesize historical ownership; the normal entrypoint must fix it itself.
    run(['run','--rm','--user','0:0','-v',ownerVolume+':/app/data','--entrypoint','chown',image,'-R','0:0','/app/data']);
    run(['start',owner]);
    await wait(owner); assertServiceIdentity(owner);
    assert.equal(inside(owner,['cat','/app/data/state.json']),originalState);
    inject(owner); inside(owner,['node','scripts/container-smoke.mjs']);
    report.checks.push('old-root-owner-auto-repair/state-preserved/service-1000/no-capabilities/no-new-privileges');

    // A NAS bind mount starts as a root-owned directory, unlike a new named volume.
    const bindDirectory = await fs.mkdtemp(path.join(os.tmpdir(),'coketv-nas-bind-'));
    try {
        run(['run','--rm','--user','0:0','-v',bindDirectory+':/app/data','--entrypoint','sh',image,'-c','chown 0:0 /app/data && chmod 755 /app/data && printf preserved > /app/data/user-fixture && chmod 400 /app/data/user-fixture && ln -s /etc /app/data/outside']);
        // Reproduce the reported EACCES with the old direct non-root startup.
        const before = `coketv-bind-before-${id}`; names.push(before);
        run(['run','-d','--name',before,'--user','1000:1000','--cap-drop=ALL','--security-opt=no-new-privileges:true','-v',bindDirectory+':/app/data','--entrypoint','node',image,'src/server.js']);
        run(['wait',before]);
        assert.notEqual(run(['inspect','--format','{{.State.ExitCode}}',before]).trim(),'0');
        assert.match(run(['logs',before]),/EACCES/);
        assert.match(run(['logs',before]),/mkdir '\/app\/data\/runtime'/);
        run(['rm','-f',before]);
        const bind = `coketv-bind-${id}`; names.push(bind);
        run(['run','-d','--name',bind,'--platform','linux/amd64',...startupSecurity,'-v',bindDirectory+':/app/data',image]);
        await wait(bind); assertServiceIdentity(bind);
        assert.equal(inside(bind,['cat','/app/data/user-fixture']),'preserved');
        assert.equal(inside(bind,['stat','-c','%u:%g %a','/app/data/user-fixture']).trim(),'1000:1000 600');
        assert.equal(inside(bind,['stat','-c','%u:%g','/etc']).trim(),'0:0');
        run(['restart',bind]); await wait(bind); assertServiceIdentity(bind);
        assert.equal(inside(bind,['cat','/app/data/user-fixture']),'preserved');
        run(['rm','-f',bind]);
        run(['run','--rm','--user','0:0','-v',bindDirectory+':/app/data','--entrypoint','chown',image,'0:0','/app/data']);
        const readonly = `coketv-readonly-${id}`; names.push(readonly);
        run(['run','-d','--name',readonly,...startupSecurity,'-v',bindDirectory+':/app/data:ro',image]);
        run(['wait',readonly]);
        assert.notEqual(run(['inspect','--format','{{.State.ExitCode}}',readonly]).trim(),'0');
        assert.match(run(['logs',readonly]),/权限初始化失败/);
        run(['rm','-f',readonly]);
        report.checks.push('NAS-bind-old-startup-EACCES/new-startup-auto-repair/private-content-preserved/outside-symlink-skipped/restart');
        report.checks.push('read-only-data-fails-initialization/no-root-service-fallback');
    } finally {
        run(['run','--rm','--user','0:0','-v',bindDirectory+':/app/data','--entrypoint','chown',image,'-R',`${process.getuid()}:${process.getgid()}`,'/app/data']);
        await fs.rm(bindDirectory,{recursive:true,force:true});
    }
    const explicit = create('explicit-user', ['--user','1000:1000'], ['--cap-drop=ALL','--security-opt=no-new-privileges:true']); await wait(explicit);
    // Explicit-user deployments skip initialization; use cap_drop=ALL without cap_add.
    const explicitStatus = inside(explicit,['cat','/proc/1/status']);
    assert.match(explicitStatus, /^Uid:\s+1000\s+1000\s+1000\s+1000$/m);
    assert.match(explicitStatus, /^CapBnd:\s+0+$/m);
    report.checks.push('explicit-user-writable-volume-skips-root-initialization');

    for (const [uid,gid] of [[1000,10],[1201,1202]]) {
        const custom = create(`custom-${uid}-${gid}`, ['-e',`PUID=${uid}`,'-e',`PGID=${gid}`]);
        await wait(custom); assertServiceIdentity(custom);
        assert.equal(inside(custom,['stat','-c','%u:%g','/app/data']).trim(),`${uid}:${gid}`);
        inside(custom,['node','-e',"require('fs').writeFileSync('/app/data/private-fixture','preserved',{mode:0o600})"]);
        inject(custom); inside(custom,['node','scripts/container-smoke.mjs']);
        inside(custom,['node','scripts/image-verify.mjs']);
        run(['restart',custom]); await wait(custom); assertServiceIdentity(custom);
        assert.equal(inside(custom,['cat','/app/data/private-fixture']),'preserved');
        assert.equal(inside(custom,['stat','-c','%u:%g %a','/app/data/private-fixture']).trim(),`${uid}:${gid} 600`);
        inside(custom,['node','scripts/image-verify.mjs','--persistence']);
        // Changing IDs on the same volume must retain credentials, ENV and scripts.
        run(['stop',custom]);
        const moved = `coketv-moved-${uid}-${id}`; names.push(moved);
        identities.set(moved,{uid:1301,gid:13});
        run(['run','-d','--name',moved,...startupSecurity,'-e','PUID=1301','-e','PGID=13','-v',volumes.at(-1)+':/app/data',image]);
        await wait(moved); assertServiceIdentity(moved); inject(moved);
        assert.equal(inside(moved,['stat','-c','%u:%g %a','/app/data/private-fixture']).trim(),'1301:13 600');
        assert.equal(inside(moved,['cat','/app/data/private-fixture']),'preserved');
        // The old container's expected snapshot lives in its disposable /tmp layer.
        run(['cp',custom+':/tmp/coketv-expected-state.json',path.join(output,`expected-${uid}.json`)]);
        run(['cp',path.join(output,`expected-${uid}.json`),moved+':/tmp/coketv-expected-state.json']);
        run(['exec','--user','0:0',moved,'chown','1301:13','/tmp/coketv-expected-state.json']);
        inside(moved,['node','scripts/image-verify.mjs','--persistence']);
        await fs.rm(path.join(output,`expected-${uid}.json`));
    }
    report.checks.push('PUID-PGID-1000-10-and-1201-1202/media/CLI/restart/change-IDs-preserves-private-data');
    for (const [key,value] of [['PUID','0'],['PGID','0'],['PUID',''],['PGID','-1'],['PUID','2147483648']]) {
        const invalid = `coketv-invalid-${names.length}-${id}`; names.push(invalid);
        const identityVolume = volumes.at(-1);
        const snapshot = run(['run','--rm','-v',identityVolume+':/app/data','--entrypoint','node',image,'-e',"const fs=require('fs');console.log(JSON.stringify(['','/state.json','/admin.json','/private-fixture'].map(p=>{const s=fs.statSync('/app/data'+p);return [p,s.uid,s.gid,s.mode,s.isFile()?fs.readFileSync('/app/data'+p,'base64'):null]})))"]);
        run(['run','-d','--name',invalid,...startupSecurity,'-e',`${key}=${value}`,'-v',identityVolume+':/app/data',image]);
        run(['wait',invalid]);
        assert.notEqual(run(['inspect','--format','{{.State.ExitCode}}',invalid]).trim(),'0');
        assert.match(run(['logs',invalid]),new RegExp(key+' 必须是'));
        const after = run(['run','--rm','-v',identityVolume+':/app/data','--entrypoint','node',image,'-e',"const fs=require('fs');console.log(JSON.stringify(['','/state.json','/admin.json','/private-fixture'].map(p=>{const s=fs.statSync('/app/data'+p);return [p,s.uid,s.gid,s.mode,s.isFile()?fs.readFileSync('/app/data'+p,'base64'):null]})))"]);
        assert.equal(after,snapshot,'非法 ID 必须在修改 data 前退出');
    }
    report.checks.push('invalid-root-empty-negative-overflow-IDs-rejected-before-data-mutation');
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
