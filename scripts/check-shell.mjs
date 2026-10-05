import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ROOT, ENGINE_DIRS, EXTENSIONS} from '../src/paths.js';

export async function checkShell(root = path.join(ROOT, 'engine')) {
    for (const [engine, folder] of Object.entries(ENGINE_DIRS)) {
        for (const entry of await fs.readdir(path.join(root, 'spider', folder), {withFileTypes: true})) {
            if (!entry.isFile() || entry.name.startsWith('_') || !entry.name.endsWith(EXTENSIONS[engine])) continue;
            const file = path.join(root, 'spider', folder, entry.name);
            const code = await fs.readFile(file, 'utf8');
            const playable = ['js', 'dr2', 'cat'].includes(engine) || /class\s+Spider\b/.test(code);
            assert.equal(playable, false, `发行包不允许预置源：${file}`);
        }
    }
    for (const folder of ['json', 'jx', 'data']) {
        assert.deepEqual((await fs.readdir(path.join(root, folder))).filter(name => name !== '.gitkeep'), [], `发行包 ${folder} 必须为空`);
    }
    assert.equal((await fs.readFile(path.join(root, 'config/map.txt'), 'utf8')).trim(), '');
    assert.equal((await fs.readFile(path.join(root, 'config/parses.conf'), 'utf8')).trim(), '');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'config/player.json'), 'utf8')), {});
    console.log('空壳发行检查通过：零预置源、解析脚本和站点资源');
}
await checkShell();
