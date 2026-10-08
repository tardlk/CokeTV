import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createNetdiskVerifier} from '../scripts/netdisk-verify.mjs';
import {assertTargetAllowed} from '../src/ssrf.js';

const password = 'verification-password', authorization = 'Basic ' + Buffer.from(':' + password).toString('base64');
const cookie = 'UID=123; CID=fixture; SEID=private-account-secret';
test('独立验证入口鉴权、跨站拒绝、媒体范围和重启凭据持久化', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-netdisk-http-'));
    let app, restarted, server;
    const seen = [];
    try {
        server = http.createServer((req, res) => {
            seen.push({url: req.url, headers: req.headers});
            if (req.url === '/master.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:1,\npart.ts\n'); }
            else if (req.headers.range) { res.writeHead(206, {'Content-Range': 'bytes 2-5/10', 'Content-Type': 'video/mp4'}); res.end('2345'); }
            else { res.setHeader('Content-Type', 'video/mp4'); res.end('0123456789'); }
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const upstream = `http://127.0.0.1:${server.address().port}`;
        const request = async options => ({status: 200, headers: {}, data: JSON.stringify({state: true, data: options.url.includes('/snap') ? {count: 2, list: [
            {fc: '1', fid: '1', n: '第1集.mp4'}, {fc: '1', fid: '2', n: '第2集.mp4'}
        ]} : {url: {url: upstream + (options.params.file_id === '2' ? '/master.m3u8' : '/file.mp4')}}})});
        const options = {directory, password, request, mediaGuard: url => assertTargetAllowed(url)};
        app = await createNetdiskVerifier(options);
        assert.equal((await app.inject('/api/status')).statusCode, 401);
        assert.equal((await app.inject('/%61pi/status')).statusCode, 401);
        assert.equal((await app.inject('/')).body.includes(cookie), false);
        assert.equal((await app.inject({method: 'POST', url: '/api/login/start', headers: {authorization, origin: 'https://foreign.invalid'}, payload: {}})).statusCode, 403);
        await app.accounts.save115(cookie, 'alipaymini');
        const state = await app.inject({url: '/api/status', headers: {authorization}});
        assert.equal(state.statusCode, 200); assert.equal(state.body.includes('private-account-secret'), false);
        const share = await app.inject({method: 'POST', url: '/api/share', headers: {authorization}, payload: {url: 'https://115.com/s/abc?password=AB12'}});
        assert.equal(share.statusCode, 200, share.body);
        assert.equal(share.body.includes('receiveCode'), false);
        const id = share.json().id;
        assert.equal((await app.inject({method: 'POST', url: '/api/play', headers: {authorization}, payload: {share: id, index: 99, url: 'http://127.0.0.1'}})).statusCode, 400);
        const play = await app.inject({method: 'POST', url: '/api/play', headers: {authorization}, payload: {share: id, index: 0}});
        assert.equal(play.statusCode, 200, play.body); assert.equal(play.body.includes(upstream), false);
        const media = await app.inject({url: play.json().url, headers: {range: 'bytes=2-5', cookie: 'caller-cookie', authorization: 'caller-auth'}});
        assert.equal(media.statusCode, 206, media.body); assert.equal(media.body, '2345');
        assert.equal(seen.at(-1).headers.cookie, undefined); assert.equal(seen.at(-1).headers.authorization, undefined);
        assert.equal((await app.inject({url: play.json().url, method: 'HEAD'})).statusCode, 200);
        const hls = await app.inject({method: 'POST', url: '/api/play', headers: {authorization}, payload: {share: id, index: 1}});
        const list = await app.inject({url: hls.json().url, headers: {range: 'bytes=500-'}});
        assert.equal(list.statusCode, 200, list.body);
        assert.equal(seen.at(-1).headers.range, undefined);
        assert.ok(list.body.includes('/media/')); assert.equal(list.body.includes(upstream), false);
        const keyURL = new URL(list.body.match(/URI="([^"]+)"/)[1]);
        assert.equal((await app.inject(keyURL.pathname)).statusCode, 200);
        await app.accounts.save115(cookie, 'web');
        assert.equal((await app.inject(play.json().url)).statusCode, 403, '换账号后旧播放引用拒绝');
        assert.equal((await app.inject({method: 'POST', url: '/api/play', headers: {authorization}, payload: {share: id, index: 0}})).statusCode, 410);
        const persisted = app.accounts.status();
        await app.close(); app = null;
        restarted = await createNetdiskVerifier(options);
        assert.deepEqual(restarted.accounts.status(), persisted);
        assert.equal((await restarted.inject({url: '/api/status', headers: {authorization}})).statusCode, 200);
        assert.equal((await restarted.inject(play.json().url)).statusCode, 403);
    } finally {
        await app?.close(); await restarted?.close();
        if (server) await new Promise(resolve => server.close(resolve));
        await fs.rm(directory, {recursive: true, force: true});
    }
});
