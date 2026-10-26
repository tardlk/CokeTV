import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {ROOT} from '../src/paths.js';
export async function checkShell(root = path.join(ROOT, 'engine')) {
    const expected = ['LICENSE','UPSTREAM.json','libs/drpy3/drpy3.js','libs/drpy3/drpy3-peer.js','libs/drpy3/drpy3-globals-capture.js','libs/drpy3/drpy-core-lite.min.js'];
    const found = [];
    const walk = async directory => {
        for (const entry of await fs.readdir(directory, {withFileTypes:true})) {
            const file = path.join(directory,entry.name);
            if (entry.isDirectory()) await walk(file);
            else {assert.ok(entry.isFile(),'发行内核只能包含普通文件');found.push(path.relative(root,file).split(path.sep).join('/'));}
        }
    };
    await walk(root);
    assert.deepEqual(found.sort(),expected.sort(),'发行树只允许登记的 drpy3 运行库，不得包含预置源或旧引擎');
    console.log('空壳发行检查通过：唯一 drpy3 引擎，零预置源');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await checkShell();
