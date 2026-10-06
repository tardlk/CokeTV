import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createApp} from '../src/server.js';

// 真正签发媒体/分片票据并执行固定样本，验证 429 发生在引擎执行之前。
test('限流仅豁免 URL 匹配的代理票据；媒体票据驱动源代理仍消耗预算', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-rate-limit-'));
    const previous = process.env.RATE_LIMIT_PER_MINUTE;
    process.env.RATE_LIMIT_PER_MINUTE = '5';
    let app, upstream;
    try {
        upstream = http.createServer((request, response) => {
            if (request.headers.referer !== 'https://fixture.invalid/') {
                response.writeHead(403); response.end('missing referer'); return;
            }
            if (request.url === '/playlist.m3u8') {
                response.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                response.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:1,\nsegment.ts\n'); return;
            }
            if (request.headers.range) {
                response.writeHead(206, {'Content-Range': 'bytes 2-5/10'}); response.end('2345'); return;
            }
            response.setHeader('Content-Type', 'video/mp4'); response.end('0123456789');
        });
        await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
        const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
        app = await createApp({directory, seed: false});
        const {id} = await app.store.saveScript('js', '限流样本.js', `var rule={title:'限流样本',host:'https://fixture.invalid',play_parse:true,lazy:async function(flag,id){return {parse:0,url:id,header:{Referer:'https://fixture.invalid/'}}},proxy_rule:async function(params){return params.redirect?[200,'video/mp4','${upstreamUrl}/video.mp4',{Referer:'https://fixture.invalid/'},2]:[200,'text/plain',params.text]}};`);
        await app.listen({host: '127.0.0.1', port: 0});
        const play = await app.inject({method: 'POST', url: `/watch/sources/${id}/play`, payload: {play: `${upstreamUrl}/playlist.m3u8`}});
        assert.equal(play.statusCode, 200, play.body);
        const mediaTicket = play.json().url.split('/').at(-1);
        const playlist = await app.inject(play.json().url);
        assert.equal(playlist.statusCode, 200, playlist.body);
        const key = new URL(playlist.body.match(/URI="([^"]+)"/)[1]);
        const segment = new URL(playlist.body.split('\n').find(line => line.startsWith('http')));
        const before = app.runner.sequence;
        for (let index = 0; index < 3; index += 1) {
            const response = await app.inject(`/proxy/${id}/?text=part${index}&token=${mediaTicket}`);
            assert.equal(response.statusCode, 200, response.body);
            assert.equal(response.body, `part${index}`);
        }
        assert.equal(app.runner.sequence - before, 3);
        const exhausted = app.runner.sequence;
        for (let index = 0; index < 12; index += 1) {
            assert.equal((await app.inject(`/proxy/${id}/?text=extra${index}&token=${mediaTicket}`)).statusCode, 429);
        }
        assert.equal((await app.inject(`/proxy/${id}/`)).statusCode, 429);
        // 匹配路由判断也覆盖编码前缀和 absolute-form，避免原始路径绕过限流。
        assert.equal((await app.inject(`/%70roxy/${id}/?token=${mediaTicket}`)).statusCode, 429);
        assert.equal((await app.inject(`http://localhost/proxy/${id}/?token=${mediaTicket}`)).statusCode, 429);
        assert.equal(app.runner.sequence, exhausted, '超限请求不能执行源逻辑');

        // HLS 分片/key 高频请求仍能放行，包括 HEAD、Range 与旧的 base64 URL。
        for (let index = 0; index < 12; index += 1) {
            for (const url of [key, segment]) assert.equal((await app.inject(url.pathname + url.search)).statusCode, 200);
        }
        const proxyTicket = segment.searchParams.get('token');
        const target = segment.searchParams.get('url');
        for (const route of ['/mediaProxy', '/unified-proxy/proxy', '/file-proxy/proxy', '/m3u8-proxy/playlist', '/m3u8-proxy/ts', '/m3u8-proxy/proxy', `/req/${encodeURIComponent(target)}`]) {
            const url = `${route}?${new URLSearchParams({url: target, token: proxyTicket})}`;
            assert.equal((await app.inject({method: 'HEAD', url})).statusCode, 200, route);
            const ranged = await app.inject({url, headers: {range: 'bytes=2-5'}});
            assert.equal(ranged.statusCode, 206, route); assert.equal(ranged.body, '2345');
        }
        assert.equal((await app.inject(`/mediaProxy?${new URLSearchParams({url: Buffer.from(target).toString('base64'), token: proxyTicket})}`)).statusCode, 200);
        for (const url of [
            `/watch/sources?token=${proxyTicket}`,
            `/watch/sources/${id}?token=${proxyTicket}`,
            `/proxy/${id}/?token=${proxyTicket}`,
            `/mediaProxy?${new URLSearchParams({url: target, token: mediaTicket})}`,
            `/mediaProxy?${new URLSearchParams({url: `${upstreamUrl}/other`, token: proxyTicket})}`,
            `/mediaProxy?${new URLSearchParams({url: target, token: 'invalid'})}`,
        ]) assert.equal((await app.inject(url)).statusCode, 429, url);
        assert.equal(app.runner.sequence, exhausted);

        // 换 URL 的有效票据在未耗尽预算时仍被鉴权拒绝，而且消耗该 IP 的预算。
        const remoteAddress = '192.0.2.2';
        assert.equal((await app.inject({remoteAddress, url: `/mediaProxy?${new URLSearchParams({url: `${upstreamUrl}/other`, token: proxyTicket})}`})).statusCode, 403);
        for (let index = 0; index < 4; index += 1) assert.equal((await app.inject({remoteAddress, url: '/watch/sources'})).statusCode, 200);
        assert.equal((await app.inject({remoteAddress, url: '/watch/sources'})).statusCode, 429);

        // 源代理的 toBytes=2 重定向仍可签发 URL 绑定票据，匿名跟随不受已满预算影响。
        const redirected = await app.inject({remoteAddress: '192.0.2.3', url: `/proxy/${id}/?redirect=1&token=${mediaTicket}`});
        assert.equal(redirected.statusCode, 302, redirected.body);
        assert.equal((await app.inject(redirected.headers.location)).statusCode, 200);
    } finally {
        if (previous === undefined) delete process.env.RATE_LIMIT_PER_MINUTE;
        else process.env.RATE_LIMIT_PER_MINUTE = previous;
        await app?.close();
        if (upstream?.listening) await new Promise(resolve => upstream.close(resolve));
        await fs.rm(directory, {recursive: true, force: true});
    }
});
