import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {ROOT} from '../src/paths.js';
export async function checkEngine(root=ROOT){
    const manifest=JSON.parse(await fs.readFile(path.join(root,'engine/UPSTREAM.json'),'utf8'));
    for(const [file,entry]of Object.entries(manifest.files)){
        const hash=crypto.createHash('sha256').update(await fs.readFile(path.join(root,'engine',file))).digest('hex');
        assert.equal(hash,entry.sha256,`drpy3运行库漂移：${file}`);assert.equal(hash,entry.upstreamSha256);
    }
    for(const [file,entry]of Object.entries(manifest.hostFiles||{})){
        const hash=crypto.createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
        assert.equal(hash,entry.sha256,`宿主辅助库漂移：${file}`);assert.ok(entry.reason);
    }
    assert.equal(Object.keys(manifest.files).length,4);
    console.log(`drpy3 ${manifest.version} 运行库及宿主辅助库来源检查通过`);return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await checkEngine();
