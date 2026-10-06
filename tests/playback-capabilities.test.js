import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackSessions} from '../src/playback.js';

test('R2/R7 media 和 proxy 票据都是短随机引用，不能解码出 URL 或凭据', () => {
    const sessions = createPlaybackSessions();
    const url = `https://fixture.invalid/video.mp4?signature=${'s'.repeat(4000)}`;
    const headers = {Cookie: 'private-cookie-fixture', Authorization: 'Bearer private-auth-fixture'};
    for (const ticket of [sessions.create('source', url, headers), sessions.createProxy(url, headers)]) {
        assert.ok(ticket.length <= 64, `票据过长：${ticket.length}`);
        assert.match(ticket, /^[A-Za-z0-9_-]+$/);
        const decoded = Buffer.from(ticket, 'base64url').toString();
        for (const secret of [url, headers.Cookie, headers.Authorization]) assert.ok(!decoded.includes(secret));
        assert.equal(sessions.get(ticket).url, url);
        assert.deepEqual(sessions.get(ticket).headers, headers);
    }
    assert.notEqual(sessions.create('source', url, headers), sessions.create('source', url, headers));
});

test('R2 能力引用保持 kind/source/URL/headers/expiry，不能被篡改、跨进程或外部修改', () => {
    let now = 0;
    const sessions = createPlaybackSessions({now: () => now, ttl: 100});
    const headers = {Cookie: 'original'};
    const ticket = sessions.create('source', 'https://fixture.invalid/a', headers);
    headers.Cookie = 'changed';
    const payload = sessions.get(ticket);
    assert.deepEqual(payload, {kind: 'media', source: 'source', url: 'https://fixture.invalid/a', headers: {Cookie: 'original'}, exp: 100});
    payload.headers.Cookie = 'changed-again'; payload.url = 'https://fixture.invalid/b';
    assert.equal(sessions.get(ticket).headers.Cookie, 'original');
    assert.equal(sessions.get(ticket).url, 'https://fixture.invalid/a');
    assert.equal(sessions.get(`${ticket}!`), undefined);
    assert.equal(createPlaybackSessions().get(ticket), undefined);
    const request = {method: 'GET', routeOptions: {url: '/proxy/:module/*'}, query: {token: ticket}};
    assert.equal(sessions.allows(request, 'source'), true);
    assert.equal(sessions.allows(request, 'other'), false);
    assert.equal(sessions.allows({...request, method: 'POST'}, 'source'), false);
    assert.equal(sessions.allows({...request, routeOptions: {url: '/api/:module'}}, 'source'), false);
    const proxy = sessions.createProxy(payload.url, {Referer: 'fixture'});
    assert.equal(sessions.get(proxy).kind, 'proxy');
    assert.equal(sessions.allows({...request, query: {token: proxy}}, 'source'), false);
    now = 100;
    assert.equal(sessions.get(ticket), undefined);
    assert.equal(sessions.get(proxy), undefined);
});

test('R2 能力存储有条数/字节容量限制，过期和最旧票据会回收', () => {
    let now = 0;
    const sessions = createPlaybackSessions({now: () => now, ttl: 100, maxEntries: 2, maxBytes: 1024});
    const first = sessions.create('source', 'https://fixture.invalid/a', {});
    const second = sessions.createProxy('https://fixture.invalid/b', {});
    const third = sessions.createProxy('https://fixture.invalid/c', {});
    assert.equal(sessions.get(first), undefined);
    assert.ok(sessions.get(second)); assert.ok(sessions.get(third));
    now = 100;
    const fresh = sessions.create('source', 'https://fixture.invalid/d', {});
    assert.equal(sessions.get(second), undefined); assert.equal(sessions.get(third), undefined);
    assert.ok(sessions.get(fresh));
    const bytes = createPlaybackSessions({maxEntries: 100, maxBytes: 512});
    const old = bytes.createProxy('https://fixture.invalid/a', {Cookie: 'a'.repeat(250)});
    const latest = bytes.createProxy('https://fixture.invalid/b', {Cookie: 'b'.repeat(250)});
    assert.equal(bytes.get(old), undefined); assert.ok(bytes.get(latest));
    assert.throws(() => bytes.createProxy('https://fixture.invalid/large', {Cookie: 'c'.repeat(1024)}), {statusCode: 503});
    assert.ok(bytes.get(latest), '无法容纳的新票据不应清空已有票据');
});
