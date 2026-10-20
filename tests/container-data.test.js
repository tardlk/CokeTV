import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {prepareContainerData, containerIdentity} from '../scripts/prepare-container-data.mjs';

const owner = {uid: process.getuid(), gid: process.getgid()};
test('container identity defaults independently and accepts numeric NAS IDs', () => {
    assert.deepEqual(containerIdentity({}), {uid:1000,gid:1000});
    assert.deepEqual(containerIdentity({PUID:'1000',PGID:'10'}), {uid:1000,gid:10});
    assert.deepEqual(containerIdentity({PGID:'10'}), {uid:1000,gid:10});
    assert.deepEqual(containerIdentity({PUID:'1201'}), {uid:1201,gid:1000});
    assert.deepEqual(containerIdentity({PUID:'001201',PGID:'00010'}), {uid:1201,gid:10});
    assert.deepEqual(containerIdentity({PUID:'2147483647',PGID:'2147483647'}), {uid:2147483647,gid:2147483647});
});

test('container identity rejects root, empty, names, signs, fractions and overflow', () => {
    for (const name of ['PUID','PGID']) for (const value of ['', '0','000','-1','1.5','+10',' 10','10 ','10\n','1e3','node','0x10','2147483648','4294967295','999999999999999999999']) {
        assert.throws(() => containerIdentity({[name]:value}), new RegExp(name+' 必须是'));
    }
});

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-permissions-'));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    return directory;
}

test('container preparation preserves private contents/modes and is idempotent', async t => {
    const directory = await fixture(t), data = path.join(directory, 'data');
    await fs.mkdir(data);
    const file = path.join(data, 'admin.json');
    await fs.writeFile(file, 'private-fixture', {mode: 0o600});
    await fs.chmod(data, 0o500);
    assert.ok(await prepareContainerData(data, owner) > 0);
    assert.equal(await fs.readFile(file, 'utf8'), 'private-fixture');
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(data)).mode & 0o777, 0o700);
    assert.equal(await prepareContainerData(data, owner), 0);
});

test('container preparation tightens pre-created world-writable data and legacy private files', async t => {
    const directory = await fixture(t), data = path.join(directory, 'data');
    const directories = [data, path.join(data, 'runtime'), path.join(data, 'runtime/config'), path.join(data, 'netdisk')];
    for (const folder of directories) { await fs.mkdir(folder); await fs.chmod(folder, 0o777); }
    const files = ['admin.json', 'state.json', 'runtime/config/env.json', 'netdisk/115.json'];
    for (const [index, relative] of files.entries()) {
        const file = path.join(data, relative);
        await fs.writeFile(file, `private-fixture-${index}`);
        await fs.chmod(file, [0o777, 0o666, 0o644, 0o600][index]);
    }
    assert.ok(await prepareContainerData(data, owner) > 0);
    for (const folder of directories) assert.equal((await fs.stat(folder)).mode & 0o7777, 0o700, folder);
    for (const [index, relative] of files.entries()) {
        const file = path.join(data, relative), stat = await fs.stat(file);
        assert.equal(stat.mode & 0o7777, 0o600, relative);
        assert.equal(stat.uid, owner.uid); assert.equal(stat.gid, owner.gid);
        assert.equal(await fs.readFile(file, 'utf8'), `private-fixture-${index}`);
    }
    assert.equal(await prepareContainerData(data, owner), 0);
});

test('container preparation protects newly created data even under a permissive umask', async t => {
    const directory = await fixture(t), data = path.join(directory, 'data');
    const previous = process.umask(0);
    try {
        await prepareContainerData(data, owner);
        assert.equal((await fs.stat(data)).mode & 0o7777, 0o700);
    } finally { process.umask(previous); }
});

test('container preparation retains owner execution for runtime helpers but never for private configuration', async t => {
    const directory = await fixture(t), data = path.join(directory, 'data');
    const helper = path.join(data, 'runtime/plugins/example/helper');
    await fs.mkdir(path.dirname(helper), {recursive: true});
    await fs.writeFile(helper, '#!/bin/sh\nprintf compatible');
    await fs.chmod(helper, 0o775);
    const privateFiles = ['admin.json', 'state.json', 'runtime/.plugins.js', 'runtime/config/source-env/example.json', 'runtime/json/parameters.json'];
    for (const relative of privateFiles) {
        const file = path.join(data, relative);
        await fs.mkdir(path.dirname(file), {recursive: true});
        await fs.writeFile(file, '{}'); await fs.chmod(file, 0o777);
    }
    await prepareContainerData(data, owner);
    assert.equal((await fs.stat(helper)).mode & 0o7777, 0o700);
    assert.equal(execFileSync(helper, {encoding: 'utf8'}), 'compatible');
    for (const relative of privateFiles) assert.equal((await fs.stat(path.join(data, relative))).mode & 0o7777, 0o600, relative);
    assert.equal(await prepareContainerData(data, owner), 0);
});

test('container preparation skips outside symlinks and rejects linked data root', async t => {
    const directory = await fixture(t), data = path.join(directory, 'data'), outside = path.join(directory, 'outside');
    await fs.mkdir(data); await fs.mkdir(outside, {mode: 0o500});
    await fs.symlink(outside, path.join(data, 'node_modules'));
    await prepareContainerData(data, owner);
    assert.equal((await fs.stat(outside)).mode & 0o777, 0o500);
    await fs.symlink(data, path.join(directory, 'linked'));
    await assert.rejects(prepareContainerData(path.join(directory, 'linked'), owner), /符号链接/);
});

test('container preparation rejects hardlinks and broad system paths', async t => {
    const directory = await fixture(t), data = path.join(directory, 'data'), outside = path.join(directory, 'outside');
    await fs.mkdir(data); await fs.writeFile(outside, 'unchanged', {mode: 0o400});
    await fs.link(outside, path.join(data, 'hardlink'));
    await assert.rejects(prepareContainerData(data, owner), /硬链接/);
    assert.equal((await fs.stat(outside)).mode & 0o777, 0o400);
    assert.equal(await fs.readFile(outside, 'utf8'), 'unchanged');
    for (const name of ['/', '/app', '/app/engine', '/etc', '/etc/coketv', '/tmp']) await assert.rejects(prepareContainerData(name, owner), /专用数据目录/);
});
