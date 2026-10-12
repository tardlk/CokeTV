import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {ROOT} from '../src/paths.js';

export async function checkEngine(root=ROOT){
    const baseline=JSON.parse(await fs.readFile(path.join(root,'engine/UPSTREAM.json'),'utf8'));
    const found=[];
    async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){
        if(e.name==='__pycache__'||e.name.endsWith('.pyc'))continue;
        const file=path.join(dir,e.name);
        if(e.isDirectory())await walk(file);
        else {assert.ok(e.isFile(),`内核文件必须是普通文件：${file}`);found.push(path.relative(path.join(root,'engine'),file).split(path.sep).join('/'));}
    }}
    await walk(path.join(root,'engine'));
    assert.deepEqual(found.filter(f=>f!=='UPSTREAM.json').sort(),Object.keys(baseline.files).sort(),'内核文件必须登记版本来源与本地补丁');
    for(const [file,entry]of Object.entries(baseline.files)){
        const hash=crypto.createHash('sha256').update(await fs.readFile(path.join(root,'engine',file))).digest('hex');
        assert.equal(hash,entry.sha256,`内核文件已漂移，须核对原版并更新补丁记录：${file}`);
        if(entry.kind!=='upstream')assert.ok(entry.reason?.trim(),`缺少本地补丁说明：${file}`);
        if(entry.kind==='upstream')assert.equal(entry.sha256,entry.upstreamSha256);
    }
    const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
    for(const [name,entry]of Object.entries(baseline.dependencies))assert.equal(pkg.dependencies?.[name]||pkg.optionalDependencies?.[name],entry.range,`执行依赖变更须重新验收：${name}`);
    for(const [file,key]of [['cases.mjs','casesSha256'],['original-2.0.6.json','snapshotSha256']]){
        const hash=crypto.createHash('sha256').update(await fs.readFile(path.join(root,'tests/fixtures/source-parity',file))).digest('hex');
        assert.equal(hash,baseline.contract[key],`原版对照样本变更须重新验证来源：${file}`);
    }
    console.log(`内核基线检查通过：drpy-node ${baseline.version}，${found.length-1}个文件及${Object.keys(baseline.dependencies).length}项执行依赖已登记`);
    return baseline;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await checkEngine();
