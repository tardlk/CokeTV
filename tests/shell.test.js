import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../src/server.js';
import {checkShell} from '../scripts/check-shell.mjs';

test('空壳检查器：递归 + 白名单，构造的未登记文件必须抛错', async () => {
    for (const relative of ['spider/js/_X.js', 'spider/js/sub/X.js', 'spider/js/X.mjs', 'spider/php/crawler.py', 'spider/py/core/kill_t4_daemon.sh']) {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-shell-bad-'));
        try {
            const file = path.join(root, relative);
            await fs.mkdir(path.dirname(file), {recursive: true});
            await fs.writeFile(file, 'export default 1;');
            await assert.rejects(checkShell(root), new RegExp(relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        } finally { await fs.rm(root, {recursive: true, force: true}); }
    }
});
test('空壳检查器：已登记路径也做内容判定，含规则声明仍须抛错', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-shell-rule-'));
    try {
        const file = path.join(root, 'spider/js/_lib.action.js');
        await fs.mkdir(path.dirname(file), {recursive: true});
        await fs.writeFile(file, "var rule = {title:'站点',host:'https://example.invalid/'};");
        await assert.rejects(checkShell(root), /站点规则/);
    } finally { await fs.rm(root, {recursive: true, force: true}); }
});
test('空壳检查器：engine 全域内容判定，spider 之外的站点定义也必须抛错', async () => {
    const cases = [
        ['libs_drpy/sites.js', "var rule={title:'站点',host:'https://example.invalid/'};"],
        ['utils/sites.js', "var rule={title:'站点',host:'https://example.invalid/'};"],
        ['controllers/sites.js', "var rule={title:'站点',host:'https://example.invalid/'};"],
        ['config/sites.json', JSON.stringify({sites: [{key: 'demo', name: '站点', api: 'https://example.invalid/api', type: 1}]})],
    ];
    for (const [relative, code] of cases) {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-shell-engine-'));
        try {
            const file = path.join(root, relative);
            await fs.mkdir(path.dirname(file), {recursive: true});
            await fs.writeFile(file, code);
            await assert.rejects(checkShell(root), /站点规则\/站点清单定义/, relative);
        } finally { await fs.rm(root, {recursive: true, force: true}); }
    }
});
test('空壳检查器：干净的最小发行树通过（不误报普通代码）', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-shell-clean-'));
    try {
        for (const folder of ['spider', 'json', 'jx', 'data', 'config', 'utils']) await fs.mkdir(path.join(root, folder), {recursive: true});
        await fs.writeFile(path.join(root, 'config/map.txt'), '');
        await fs.writeFile(path.join(root, 'config/parses.conf'), '');
        await fs.writeFile(path.join(root, 'config/player.json'), '{}');
        await fs.writeFile(path.join(root, 'utils/sites.js'), 'export const helper = value => value;');
        await checkShell(root);
    } finally { await fs.rm(root, {recursive: true, force: true}); }
});
test('空壳检查器：真实发行树通过（白名单与实际文件一一对应）', async () => {
    await checkShell();
});

test('默认首次部署零预置源，扫描仍为空，保留五种引擎与管理首次设置', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-shell-'));
    let app;
    try {
        app = await createApp({directory});
        assert.deepEqual(app.store.state.scripts, []); assert.deepEqual(app.store.state.instances, []);
        assert.deepEqual(app.store.state.subscriptions[0].instances, []);
        assert.equal(await app.store.scan(), 0);
        assert.deepEqual((await app.inject('/watch/sources')).json(), []);
        assert.equal((await app.inject('/access/status')).json().requiresSetup, true);
        assert.equal((await app.inject('/admin/state')).statusCode, 428);
        assert.equal(app.runner.status().started, false);
        const settings = app.store.state.settings;
        for (const field of ['parses', 'lives', 'plugins']) assert.deepEqual(settings[field], []);
        assert.deepEqual(settings.env, {});
        for (const directory of ['js', 'js_dr2', 'catvod', 'py', 'php']) await fs.access(path.join(app.store.runtime, 'spider', directory));
    } finally { await app?.close(); await fs.rm(directory, {recursive: true, force: true}); }
});
