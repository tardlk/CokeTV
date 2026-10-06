import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT} from '../src/paths.js';

const exec = promisify(execFile);
const PYTHON = process.env.TEST_PYTHON || 'python3';
const PHP = process.env.TEST_PHP || 'php';

async function walk(directory) {
    const found = [];
    for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
        if (entry.name === '__pycache__') continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) found.push(...await walk(full));
        else if (entry.isFile()) found.push(full);
    }
    return found;
}

// engine/spider 下的 Python/PHP/JS 桥接与辅助库此前完全不过语法检查（check.mjs 只扫 src/scripts/web）。
// 这里逐文件做 ast.parse / php -l / node --check；Python 用 ast.parse 而非 py_compile，避免产生 __pycache__。
export async function checkBridges(root = path.join(ROOT, 'engine')) {
    const files = await walk(root);
    let count = 0;
    for (const file of files) {
        const extension = path.extname(file).toLowerCase();
        try {
            if (extension === '.py') { await exec(PYTHON, ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())', file]); count++; }
            else if (extension === '.php') { await exec(PHP, ['-l', file]); count++; }
            else if (['.js', '.cjs', '.mjs'].includes(extension)) { await exec(process.execPath, ['--check', file]); count++; }
        } catch (error) {
            throw new Error(`桥接语法检查失败：${path.relative(ROOT, file)}\n${error.stderr || error.message}`);
        }
    }
    console.log(`桥接语法检查通过：${count} 个文件`);
    return count;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await checkBridges();
