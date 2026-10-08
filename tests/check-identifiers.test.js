import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {undefinedIdentifiers} from '../scripts/check-identifiers.mjs';

test('变量检查能发现被注释的日志导入和 Vue 脚本变量缺失，接受合法局部作用域', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-identifiers-'));
    try {
        const bad = path.join(directory, 'bad.js'), vue = path.join(directory, 'bad.vue'), good = path.join(directory, 'good.js');
        await fs.writeFile(bad, '/** import {missingLog} from "./logger.js"; */\nmissingLog("fixture");');
        await fs.writeFile(vue, '<script setup>const message = unknownSource();</script><template>{{message}}</template>');
        await fs.writeFile(good, 'export function read(value) { const local = value + 1; return local; }');
        const errors = undefinedIdentifiers([bad, vue, good]);
        assert.ok(errors.some(error => error.file === bad && error.message.includes('missingLog')));
        assert.ok(errors.some(error => error.file === vue && error.message.includes('unknownSource')));
        assert.ok(!errors.some(error => error.file === good));
    } finally { await fs.rm(directory, {recursive: true, force: true}); }
});
