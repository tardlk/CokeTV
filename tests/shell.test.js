import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createApp} from '../src/server.js';

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
