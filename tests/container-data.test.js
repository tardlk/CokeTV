import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
