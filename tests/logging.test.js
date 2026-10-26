import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createLogSink, redactLogMessage} from '../src/logging.js';

test('日志脱敏隐藏查询令牌、授权头与 Cookie，普通 URL 不受影响', () => {
    const text = redactLogMessage('GET https://cdn.test/a.m3u8?token=abc123&pg=2 Authorization: Bearer secret-value cookie: sid=private');
    assert.ok(!text.includes('abc123'));
    assert.ok(!text.includes('secret-value'));
    assert.ok(!text.includes('private'));
    assert.ok(text.includes('https://cdn.test/a.m3u8?token=[redacted]&pg=2'));
    assert.equal(redactLogMessage('GET https://cdn.test/list.m3u8'), 'GET https://cdn.test/list.m3u8');
    for (const secret of [
        '{"token":"json-token"}',
        '{ "password": "json-password" }',
        "{ token: 'single-token' }",
        '{"cookie":"UID=1; CID=2; SEID=3"}',
        '{"authorization":"Basic dXNlcjpwYXNz"}',
    ]) {
        const redacted = redactLogMessage(secret);
        assert.ok(!/json-token|json-password|single-token|UID=1|dXNlcjpwYXNz/.test(redacted), redacted);
        assert.ok(redacted.includes('[redacted]'), redacted);
    }
    assert.equal(redactLogMessage('{"tokenized":"keep-me"}'), '{"tokenized":"keep-me"}');
    assert.ok(redactLogMessage('x'.repeat(9000)).length <= 8192);
});

test('日志同时写入 stdout 与 0600 文件，并按大小轮转', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-logs-'));
    const lines = [];
    const sink = createLogSink({directory, maxBytes: 300, keep: 2, stdout: true, stream: {write: line => lines.push(line)}});
    try {
        for (let index = 0; index < 12; index += 1) sink.write({level: 'info', source: 'test', message: `第 ${index} 条日志，token=secret-${index}`});
        await sink.flush();
        assert.equal(lines.length, 12);
        assert.ok(lines.every(line => JSON.parse(line).level === 'info'));
        assert.ok(lines.every(line => !line.includes('secret-')));
        const target = path.join(directory, 'logs/coketv.log');
        const rotated = path.join(directory, 'logs/coketv.log.1');
        const content = await fs.readFile(target, 'utf8');
        assert.ok(content.trim().split('\n').every(line => JSON.parse(line).source === 'test'));
        assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
        assert.equal((await fs.stat(rotated)).mode & 0o777, 0o600);
        assert.equal((await fs.stat(path.dirname(target))).mode & 0o777, 0o700);
        const names = await fs.readdir(path.dirname(target));
        assert.ok(names.includes('coketv.log.1'));
        assert.ok(!names.includes('coketv.log.3'));
    } finally {
        await sink.close();
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('显式关闭 stdout 时不写流，文件日志仍可用', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-logs-quiet-'));
    const lines = [];
    const sink = createLogSink({directory, file: false, stdout: false, stream: {write: line => lines.push(line)}});
    try {
        sink.write({message: '不应出现'});
        await sink.flush();
        assert.deepEqual(lines, []);
    } finally {
        await sink.close();
        await fs.rm(directory, {recursive: true, force: true});
    }
});

test('关闭文件日志时只输出 stdout，不创建日志目录', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-logs-off-'));
    const lines = [];
    const sink = createLogSink({directory, file: false, stdout: true, stream: {write: line => lines.push(line)}});
    try {
        sink.write({message: '仅 stdout'});
        await sink.flush();
        assert.equal(lines.length, 1);
        await assert.rejects(fs.access(path.join(directory, 'logs')), {code: 'ENOENT'});
    } finally {
        await sink.close();
        await fs.rm(directory, {recursive: true, force: true});
    }
});
