import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {Backups} from '../src/backups.js';

async function fixture() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-backup-'));
    await fs.mkdir(path.join(directory, 'runtime/spider/js_dr3'), {recursive: true});
    await fs.mkdir(path.join(directory, 'runtime/config/source-env'), {recursive: true});
    await fs.mkdir(path.join(directory, 'runtime/data/drpy3'), {recursive: true});
    await fs.mkdir(path.join(directory, 'netdisk'), {recursive: true});
    await fs.writeFile(path.join(directory, 'state.json'), '{"version":2}');
    await fs.writeFile(path.join(directory, 'admin.json'), '{"version":2}');
    await fs.writeFile(path.join(directory, 'runtime/spider/js_dr3/样本.js'), 'var rule={};');
    await fs.writeFile(path.join(directory, 'runtime/config/source-env/a.json'), '{"token":"x"}');
    await fs.writeFile(path.join(directory, 'runtime/data/drpy3/kv.json'), '{"k":1}');
    await fs.writeFile(path.join(directory, 'netdisk/115.json'), '{"version":1}');
    await fs.writeFile(path.join(directory, 'netdisk/guangya.json'), '{"version":1}');
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-outside-'));
    await fs.writeFile(path.join(outside, 'secret.txt'), 'not in snapshot');
    await fs.symlink(outside, path.join(directory, 'runtime/node_modules'), 'junction');
    return {directory, outside};
}

test('快照包含状态、脚本、ENV、KV 与网盘凭据，跳过符号链接，权限为 0600', async () => {
    const {directory, outside} = await fixture();
    const backups = new Backups(directory, {now: () => Date.parse('2026-10-26T02:00:00Z')});
    try {
        const item = await backups.create();
        assert.match(item.name, /^coketv-\d{8}-\d{6}-[a-f0-9]{6}\.zip$/);
        const file = path.join(directory, 'backups', item.name);
        assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
        const entries = new AdmZip(file).getEntries().map(entry => entry.entryName).sort();
        assert.deepEqual(entries, ['admin.json', 'netdisk/115.json', 'netdisk/guangya.json', 'runtime/config/source-env/a.json', 'runtime/data/drpy3/kv.json', 'runtime/spider/js_dr3/样本.js', 'state.json']);
        assert.ok(!entries.some(entry => entry.includes('node_modules')));
        assert.ok(!entries.some(entry => entry.includes('secret.txt')));
        const status = await backups.status();
        assert.equal(status.items.length, 1);
        assert.deepEqual(status.last, item);
    } finally {
        await backups.close();
        await fs.rm(directory, {recursive: true, force: true});
        await fs.rm(outside, {recursive: true, force: true});
    }
});

test('调用方提供的一致副本（Emby VACUUM INTO）可并入快照', async () => {
    const {directory, outside} = await fixture();
    const backups = new Backups(directory, {extraFiles: async () => [{name: 'emby/emby.sqlite', bytes: Buffer.from('consistent-sqlite-copy')}]});
    try {
        const item = await backups.create();
        const zip = new AdmZip(path.join(directory, 'backups', item.name));
        const entry = zip.getEntry('emby/emby.sqlite');
        assert.ok(entry);
        assert.equal(entry.getData().toString(), 'consistent-sqlite-copy');
        await backups.setExtraFiles(null);
        const second = await backups.create();
        assert.equal(new AdmZip(path.join(directory, 'backups', second.name)).getEntry('emby/emby.sqlite'), null);
    } finally {
        await backups.close();
        await fs.rm(directory, {recursive: true, force: true});
        await fs.rm(outside, {recursive: true, force: true});
    }
});

test('自动快照按间隔触发并只保留最近 N 份', async () => {
    const {directory, outside} = await fixture();
    let clock = Date.now();
    const backups = new Backups(directory, {keep: 2, intervalMs: 3600000, now: () => clock});
    try {
        const first = await backups.create();
        clock += 3600000;
        const second = await backups.create();
        clock += 3600000;
        const third = await backups.create();
        const items = await backups.list();
        assert.equal(items.length, 2);
        assert.deepEqual(items.map(item => item.name), [third.name, second.name]);
        await assert.rejects(fs.access(path.join(directory, 'backups', first.name)), {code: 'ENOENT'});
        // 最新快照仍新于间隔：不重复创建；超过间隔后再补一份。
        const before = (await backups.list()).length;
        await backups.checkDue();
        assert.equal((await backups.list()).length, before);
        clock += 2 * 3600000;
        await backups.checkDue();
        assert.equal((await backups.list()).length, 2);
        assert.notEqual((await backups.list())[0].name, third.name);
    } finally {
        await backups.close();
        await fs.rm(directory, {recursive: true, force: true});
        await fs.rm(outside, {recursive: true, force: true});
    }
});

test('快照文件名只接受本服务生成的格式，拒绝目录穿越', async () => {
    const {directory, outside} = await fixture();
    const backups = new Backups(directory);
    try {
        assert.throws(() => backups.locate('../state.json'), {statusCode: 400});
        assert.throws(() => backups.locate('coketv-20261026-020000-abcdef.zip/../../state.json'), {statusCode: 400});
        assert.match(backups.locate('coketv-20261026-020000-abcdef.zip'), /backups/);
    } finally {
        await backups.close();
        await fs.rm(directory, {recursive: true, force: true});
        await fs.rm(outside, {recursive: true, force: true});
    }
});
