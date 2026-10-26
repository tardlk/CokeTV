import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApp} from '../src/server.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlNwAAAAASUVORK5CYII=';

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-hardening-'));
    const app = await createApp({directory});
    t.after(async () => { await app.close(); await fs.rm(directory, {recursive: true, force: true}); });
    const setup = await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'hardening-password', confirmPassword: 'hardening-password'}});
    assert.equal(setup.statusCode, 200, setup.body);
    return {
        app, directory,
        admin: `Basic ${Buffer.from(':hardening-password').toString('base64')}`,
        subscription: app.store.state.subscriptions.find(sub => sub.enabled).token,
    };
}

test('图片上传只允许管理员/源内部，拒绝 SVG 并校验栅格魔数', async t => {
    const {app, admin, subscription} = await fixture(t);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>`;
    const svgData = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

    const bySubscription = await app.inject({method: 'POST', url: `/image/upload?token=${subscription}`, payload: {imageId: 'sub-svg', base64Data: svgData}});
    assert.equal(bySubscription.statusCode, 403, bySubscription.body);

    const adminSvg = await app.inject({method: 'POST', url: '/image/upload', headers: {authorization: admin}, payload: {imageId: 'svg', base64Data: svgData}});
    assert.equal(adminSvg.statusCode, 400, adminSvg.body);

    const fakePng = await app.inject({method: 'POST', url: '/image/upload', headers: {authorization: admin}, payload: {imageId: 'fake', base64Data: 'data:image/png;base64,aGVsbG8='}});
    assert.equal(fakePng.statusCode, 400, fakePng.body);

    const uploaded = await app.inject({method: 'POST', url: '/image/upload', headers: {authorization: admin}, payload: {imageId: 'png', base64Data: `data:image/png;base64,${PNG}`}});
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const image = await app.inject({method: 'GET', url: '/image/png'});
    assert.equal(image.statusCode, 200);
    assert.match(image.headers['content-type'], /^image\/png/);
    assert.match(image.headers['content-security-policy'], /default-src 'none'/);
    assert.equal(image.rawPayload.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('订阅 Token 不能通过 WebDAV/FTP 配置接口访问内网目标', async t => {
    const {app, subscription} = await fixture(t);
    let hits = 0;
    const upstream = http.createServer((request, response) => { hits += 1; response.writeHead(501); response.end(); });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => upstream.close(resolve)));
    const target = `http://127.0.0.1:${upstream.address().port}`;
    for (const url of [`/webdav/config?token=${subscription}`, `/webdav/%63onfig?token=${subscription}`, `/ftp/config?token=${subscription}`]) {
        const response = await app.inject({method: 'POST', url, payload: {baseURL: target, host: '127.0.0.1', port: 21, username: 'u', password: 'p'}});
        assert.equal(response.statusCode, 403, `${url}: ${response.body}`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(hits, 0, '被拒绝的配置请求不能在宿主侧发起连接');
});
