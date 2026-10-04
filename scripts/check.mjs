import fs from 'fs';
import path from 'path';
import {execFileSync} from 'child_process';
const roots = ['src', 'scripts', 'engine/libs', 'engine/utils', 'engine/controllers', 'engine/libs_drpy'];
const files = [];
function walk(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '_dist') walk(file); }
        else if (/\.(js|mjs)$/.test(file) && !file.endsWith('.min.js')) files.push(file);
    }
}
for (const root of roots) walk(root);
for (const file of files) execFileSync(process.execPath, ['--check', file], {stdio: 'pipe'});
console.log(`语法检查通过：${files.length} 个文件`);
