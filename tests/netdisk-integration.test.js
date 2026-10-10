import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createApp} from '../src/server.js';

test('网盘账号只在后台管理；源详情自动展开，网页/TVBox/猫影视共用且保持实例与订阅范围', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-netdisk-integration-'));
    let app, upstream;
    const secret = 'UID=123; CID=fixture; SEID=private-netdisk-cookie';
    try {
        upstream = http.createServer((req, res) => {
            assert.equal(req.headers.cookie, undefined);
            if (req.url === '/list.m3u8') { res.setHeader('Content-Type', 'application/vnd.apple.mpegurl'); res.end('#EXTM3U\n#EXTINF:1,\npart.ts\n'); return; }
            if (req.headers.range) { res.writeHead(206, {'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-3/10'}); res.end('0123'); }
            else { res.setHeader('Content-Type', 'video/mp4'); res.end('0123456789'); }
        });
        await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
        const mediaURL = `http://127.0.0.1:${upstream.address().port}/video.mp4`;
        app = await createApp({directory, seed: false, netdiskRequest: async options => {
            assert.equal(options.headers.Cookie, secret);
            return {status: 200, headers: {}, data: JSON.stringify({state: true, data: options.url.includes('/snap') ? {count: 2, list: [
                {fc: '1', fid: '2', n: '第2集.mp4'}, {fc: '1', fid: '1', n: '第1集.mp4'}
            ]} : {url: {url: options.params.file_id === '2' ? mediaURL.replace('video.mp4', 'list.m3u8') : mediaURL}}})};
        }});

        await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'test-netdisk', confirmPassword: 'test-netdisk'}});
        const authorization = 'Basic ' + Buffer.from(':test-netdisk').toString('base64');
        assert.equal((await app.inject('/admin/netdisk')).statusCode, 401);
        assert.equal((await app.inject('/%61dmin/netdisk')).statusCode, 401);
        assert.equal((await app.inject({method: 'POST', url: '/admin/netdisk/115/account', headers: {authorization, origin: 'https://foreign.invalid'}, payload: {cookie: secret, device: 'web'}})).statusCode, 403);
        const connected = await app.inject({method: 'POST', url: '/admin/netdisk/115/account', headers: {authorization}, payload: {cookie: secret, device: 'alipaymini'}});
        assert.equal(connected.statusCode, 200, connected.body);
        assert.equal(connected.body.includes('private-netdisk-cookie'), false);
        const sourceCode = `var rule={title:'网盘测试',host:'https://fixture.invalid',二级:async function(){return {vod_id:this.orId,vod_name:'样本',vod_play_from:'115$$$普通线路',vod_play_url:'分享$push://https%3A%2F%2F115.com%2Fs%2Ffixture%3Fpassword%3DAB12$$$普通$${mediaURL}'}},play_parse:true,lazy:async function(flag,id){if(id.startsWith('coketv-netdisk:'))throw Error('不应交回源');return {parse:0,url:id}}};`;
        const script = await app.store.saveScript('js', '网盘测试.js', sourceCode);
        const source = app.store.state.instances.find(item => item.scriptId === script.id).id;
        const otherScript = await app.store.saveScript('js', '另一源.js', sourceCode);
        const other = app.store.state.instances.find(item => item.scriptId === otherScript.id).id;
        app.store.state.subscriptions.push({id: 'netdisk-sub', name: '网盘订阅', token: 'netdisk-token', enabled: true, instances: [source]});
        const before = JSON.stringify(app.store.state);
        const detail = await app.inject(`/watch/sources/${source}?ac=detail&ids=one`);
        assert.equal(detail.statusCode, 200, detail.body);
        assert.equal(detail.body.includes('private-netdisk-cookie'), false);
        const vod = detail.json().list[0], episodes = vod.vod_play_url.split('$$$')[0].split('#');
        assert.equal(episodes.length, 2); assert.ok(episodes[0].startsWith('第1集.mp4$'));
        assert.equal(vod.vod_play_url.split('$$$')[1], '普通$' + mediaURL);
        const ref = episodes[0].split('$')[1];
        assert.ok(ref.startsWith('coketv-netdisk:115:'));
        const play = await app.inject({method: 'POST', url: `/watch/sources/${source}/play`, payload: {play: ref}});
        assert.equal(play.statusCode, 200, play.body);
        const media = await app.inject({url: play.json().url, headers: {range: 'bytes=0-3'}});
        assert.equal(media.statusCode, 206); assert.equal(media.body, '0123');
        assert.equal((await app.inject({method: 'POST', url: `/watch/sources/${other}/play`, payload: {play: ref}})).statusCode, 403);
        const tvbox = await app.inject(`/api/${source}?token=netdisk-token&play=${encodeURIComponent(ref)}`);
        assert.equal(tvbox.statusCode, 200, tvbox.body); assert.equal(tvbox.json().url, mediaURL);
        const catBase = `/cat/netdisk-sub/netdisk-token/api/${source}`;
        const catDetail = await app.inject({method: 'POST', url: catBase + '/detail', payload: {id: ['one']}});
        assert.equal(catDetail.statusCode, 200, catDetail.body);
        const catRef = catDetail.json().list[0].vod_play_url.split('$$$')[0].split('#')[0].split('$')[1];
        const catPlay = await app.inject({method: 'POST', url: catBase + '/play', payload: {id: catRef, flag: '115'}});
        assert.equal(catPlay.statusCode, 200, catPlay.body);
        const catURL = new URL(catPlay.json().url), catMedia = await app.inject({url: catURL.pathname, headers: {range: 'bytes=0-3'}});
        assert.equal(catMedia.statusCode, 206, catMedia.body);
        assert.equal((await app.inject({method: 'POST', url: `/cat/netdisk-sub/netdisk-token/api/${other}/play`, payload: {id: ref}})).statusCode, 403);
        const secondRef = episodes[1].split('$')[1];
        const hls = await app.inject({method: 'POST', url: `/watch/sources/${source}/play`, payload: {play: secondRef}});
        const list = await app.inject(hls.json().url);
        assert.equal(list.statusCode, 200, list.body);
        const child = new URL(list.body.split('\n').find(line => line.startsWith('http')));
        assert.equal((await app.inject(child.pathname + child.search)).statusCode, 200);
        app.store.state.instances.find(item => item.id === source).enabled = false;
        assert.equal((await app.inject(child.pathname + child.search)).statusCode, 403, '源停用后网盘 HLS 子票据失效');
        app.store.state.instances.find(item => item.id === source).enabled = true;
        assert.equal(JSON.stringify(app.store.state), before, '观影不能改源、订阅或设置');
        const exported = await app.inject({url: '/admin/export', headers: {authorization}});
        assert.equal(exported.body.includes('private-netdisk-cookie'), false);
        await app.inject({method: 'POST', url: '/admin/netdisk/115/account', headers: {authorization}, payload: {cookie: secret, device: 'web'}});
        assert.equal((await app.inject(play.json().url)).statusCode, 403, '更新账号后旧网页媒体失效');
        assert.equal((await app.inject(catURL.pathname)).statusCode, 403, '更新账号后旧猫影视媒体失效');
        assert.equal((await app.inject(child.pathname + child.search)).statusCode, 403, '更新账号后旧 HLS 子票据失效');
    } finally {
        await app?.close(); if (upstream) await new Promise(resolve => upstream.close(resolve));
        await fs.rm(directory, {recursive: true, force: true});
    }
});
