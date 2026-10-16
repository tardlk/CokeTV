import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.js';

// Fastify 的 inject 默认入口是 host: localhost:80 + http；URL 归一化后同源 origin 是 http://localhost。
const PASSWORD = 'origin-check-password';
const AUTHORIZATION = `Basic ${Buffer.from(`:${PASSWORD}`).toString('base64')}`;
const FOREIGN_ORIGIN = 'https://evil.example';
const SAME_ORIGIN = 'http://localhost';
const PUBLIC_URL = 'https://tv.example.com';
const SCRIPT = name => ({engine: 'js', name, code: 'var rule = {title:"origin-probe"};'});

async function boot({publicUrl, setup = true} = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-origin-'));
    const app = await createApp({directory, seed: false});
    if (publicUrl !== undefined) app.store.state.settings.publicUrl = publicUrl;
    if (setup) {
        const response = await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: PASSWORD, confirmPassword: PASSWORD}});
        assert.equal(response.statusCode, 200, `首次设密应成功：${response.body}`);
    }
    return {app, directory, close: async () => { await app.close(); await fs.rm(directory, {recursive: true, force: true}); }};
}
const scriptsOf = app => app.store.state.scripts.length;

test('跨站 Origin 的管理写请求一律 403，且在进入业务 handler 之前就被拦截', async () => {
    const {app, close} = await boot();
    try {
        const headers = {authorization: AUTHORIZATION, origin: FOREIGN_ORIGIN};
        // 若来源校验缺失，这三个请求都会命中业务逻辑（返回 200 或业务 4xx）。
        assert.equal((await app.inject({method: 'POST', url: '/admin/scripts', headers, payload: SCRIPT('cross-site.js')})).statusCode, 403);
        assert.equal((await app.inject({method: 'POST', url: '/admin/instances', headers, payload: {name: 'cross', scriptId: 'nope', params: '', enabled: true}})).statusCode, 403);
        assert.equal((await app.inject({method: 'PUT', url: '/admin/settings', headers, payload: {}})).statusCode, 403);
        assert.equal((await app.inject({method: 'POST', url: '/admin/scan', headers})).statusCode, 403);
        // 跨站写入必须没有任何副作用。
        assert.equal(scriptsOf(app), 0);
        assert.equal(app.store.state.instances.length, 0);
    } finally { await close(); }
});

test('无 Origin 的 CLI / 自动化写请求保持可用（不强制要求 Origin）', async () => {
    const {app, close} = await boot();
    try {
        const response = await app.inject({method: 'POST', url: '/admin/scripts', headers: {authorization: AUTHORIZATION}, payload: SCRIPT('cli-compatible.js')});
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(scriptsOf(app), 1);
    } finally { await close(); }
});

test('同源 Origin 与 publicUrl 配置的 Origin 都能通过', async () => {
    const {app, close} = await boot({publicUrl: PUBLIC_URL});
    try {
        assert.equal((await app.inject({method: 'POST', url: '/admin/scripts', headers: {authorization: AUTHORIZATION, origin: SAME_ORIGIN}, payload: SCRIPT('same-origin.js')})).statusCode, 200);
        // 显式写出默认端口与省略端口属于同一 origin，两侧归一化后必须相等。
        assert.equal((await app.inject({method: 'POST', url: '/admin/scripts', headers: {authorization: AUTHORIZATION, origin: 'http://localhost:80'}, payload: SCRIPT('same-origin-port.js')})).statusCode, 200);
        assert.equal((await app.inject({method: 'POST', url: '/admin/scripts', headers: {authorization: AUTHORIZATION, origin: PUBLIC_URL}, payload: SCRIPT('public-url.js')})).statusCode, 200);
        // 配了 publicUrl 之后，其他 origin 仍然被拒。
        assert.equal((await app.inject({method: 'POST', url: '/admin/scripts', headers: {authorization: AUTHORIZATION, origin: FOREIGN_ORIGIN}, payload: SCRIPT('still-foreign.js')})).statusCode, 403);
        assert.equal(scriptsOf(app), 3);
    } finally { await close(); }
});

test('Sec-Fetch-Site: cross-site 即使不带 Origin 也拒绝', async () => {
    const {app, close} = await boot();
    try {
        const headers = {authorization: AUTHORIZATION, 'sec-fetch-site': 'cross-site'};
        assert.equal((await app.inject({method: 'PUT', url: '/admin/settings', headers, payload: {}})).statusCode, 403);
        assert.equal((await app.inject({method: 'POST', url: '/admin/scripts', headers, payload: SCRIPT('fetch-site.js')})).statusCode, 403);
        assert.equal(scriptsOf(app), 0);
    } finally { await close(); }
});

test('安全方法（GET/HEAD）不受写保护影响', async () => {
    const {app, close} = await boot();
    try {
        assert.equal((await app.inject({url: '/admin/state', headers: {authorization: AUTHORIZATION, origin: FOREIGN_ORIGIN}})).statusCode, 200);
        assert.equal((await app.inject({method: 'HEAD', url: '/admin/state', headers: {authorization: AUTHORIZATION, origin: FOREIGN_ORIGIN}})).statusCode, 200);
    } finally { await close(); }
});

test('首次 setup 也受跨站保护；同源与无 Origin 仍可完成初始化', async () => {
    const rejected = await boot({setup: false});
    try {
        const response = await rejected.app.inject({method: 'POST', url: '/admin/access/setup', headers: {origin: FOREIGN_ORIGIN}, payload: {password: PASSWORD, confirmPassword: PASSWORD}});
        assert.equal(response.statusCode, 403);
        assert.equal(rejected.app.store && (await rejected.app.inject('/access/status')).json().requiresSetup, true);
    } finally { await rejected.close(); }

    const sameOrigin = await boot({setup: false});
    try {
        const response = await sameOrigin.app.inject({method: 'POST', url: '/admin/access/setup', headers: {origin: SAME_ORIGIN}, payload: {password: PASSWORD, confirmPassword: PASSWORD}});
        assert.equal(response.statusCode, 200, response.body);
    } finally { await sameOrigin.close(); }

    const noOrigin = await boot({setup: false});
    try {
        // 无 Origin 的自动化/CLI 仍可完成首次初始化（first-writer 模型不变）。
        const response = await noOrigin.app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: PASSWORD, confirmPassword: PASSWORD}});
        assert.equal(response.statusCode, 200, response.body);
    } finally { await noOrigin.close(); }
});

test('不同 content-type 不改变跨站判定：form / multipart / json 一律 403', async () => {
    const {app, close} = await boot();
    const boundary = '----coketvoriginboundary';
    const multipart = `--${boundary}\r\nContent-Disposition: form-data; name="engine"\r\n\r\njs\r\n--${boundary}--\r\n`;
    try {
        const foreign = {authorization: AUTHORIZATION, origin: FOREIGN_ORIGIN};
        const json = await app.inject({method: 'POST', url: '/admin/scripts', headers: foreign, payload: SCRIPT('json.js')});
        assert.equal(json.statusCode, 403);
        const form = await app.inject({method: 'POST', url: '/admin/scripts', headers: {...foreign, 'content-type': 'application/x-www-form-urlencoded'}, payload: 'engine=js&name=form.js&code=var%20rule%3D%7B%7D'});
        assert.equal(form.statusCode, 403);
        const multi = await app.inject({method: 'POST', url: '/admin/upload', headers: {...foreign, 'content-type': `multipart/form-data; boundary=${boundary}`}, payload: multipart});
        assert.equal(multi.statusCode, 403);
        assert.equal(scriptsOf(app), 0);
    } finally { await close(); }
});

test('/admin/emby* 走同一套全局来源保护', async () => {
    const {app, close} = await boot();
    try {
        const foreign = {authorization: AUTHORIZATION, origin: FOREIGN_ORIGIN};
        assert.equal((await app.inject({method: 'POST', url: '/admin/emby/libraries', headers: foreign, payload: {}})).statusCode, 403);
        assert.equal((await app.inject({method: 'POST', url: '/admin/emby/libraries', headers: {authorization: AUTHORIZATION}, payload: {}})).statusCode, 400);
    } finally { await close(); }
});

test('公开的 /emby/* 写路由仍单独校验来源（未被全局 hook 覆盖的那部分）', async () => {
    const {app, close} = await boot();
    try {
        const crossSite = await app.inject({method: 'POST', url: '/emby/Users/AuthenticateByName', headers: {'sec-fetch-site': 'cross-site'}, payload: {Username: 'coke', Pw: 'x'}});
        assert.equal(crossSite.statusCode, 403);
        const foreignOrigin = await app.inject({method: 'POST', url: '/emby/Users/AuthenticateByName', headers: {origin: FOREIGN_ORIGIN}, payload: {Username: 'coke', Pw: 'x'}});
        assert.equal(foreignOrigin.statusCode, 403);
        // 无 Origin 时来源校验放行，落到业务鉴权（凭据错误 → 401），证明来源检查没有误伤 CLI。
        const noOrigin = await app.inject({method: 'POST', url: '/emby/Users/AuthenticateByName', payload: {Username: 'coke', Pw: 'x'}});
        assert.equal(noOrigin.statusCode, 401);
    } finally { await close(); }
});
