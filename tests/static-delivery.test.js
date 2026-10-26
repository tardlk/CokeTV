import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.js';
import {ROOT} from '../src/paths.js';

test('已构建前端：HTML 需回源校验，带指纹资源长缓存并支持压缩', async t => {
    const assets = path.join(ROOT, 'dist/assets');
    const assetNames = await fs.readdir(assets).catch(() => null);
    if (!assetNames) { t.skip('需要先运行 npm run build'); return; }
    const asset = assetNames.find(name => /^index-.*\.js$/.test(name));
    if (!asset) { t.skip('缺少构建产物 index-*.js'); return; }
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-static-'));
    let app;
    try {
        app = await createApp({directory});
        const html = await app.inject({method: 'GET', url: '/'});
        assert.equal(html.statusCode, 200);
        assert.equal(html.headers['cache-control'], 'no-cache');

        const hashed = await app.inject({method: 'GET', url: `/assets/${asset}`, headers: {'accept-encoding': 'gzip'}});
        assert.equal(hashed.statusCode, 200);
        assert.match(hashed.headers['cache-control'], /max-age=31536000/);
        assert.match(hashed.headers['cache-control'], /immutable/);
        assert.equal(hashed.headers['content-encoding'], 'gzip');

        const watch = await app.inject({method: 'GET', url: '/watch'});
        assert.equal(watch.headers['cache-control'], 'no-cache');
    } finally {
        await app?.close();
        await fs.rm(directory, {recursive: true, force: true});
    }
});
