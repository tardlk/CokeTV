// 站点脚本回归测试：只覆盖 data 运行目录里的两个真实源脚本。
// 发行版是空壳（脚本在 .gitignore 的 data 目录），找不到脚本时整组跳过。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {pathToFileURL} from 'node:url';

const dataDir = process.env.DATA_DIR || 'data';
const FILES = {
    jf: path.join(dataDir, 'runtime/spider/js_dr3/教父影视.js'),
    y2: path.join(dataDir, 'runtime/spider/js_dr3/爱电影.js'),
};
const present = {};
for (const [kind, file] of Object.entries(FILES)) present[kind] = await fs.access(file).then(() => true, () => false);
const skip = kind => (present[kind] ? false : `缺少站点脚本 ${FILES[kind]}（发行版不含站点脚本）`);

globalThis.ENV = {
    get: (key, fallback) => ({
        cookie: 'fixture-login',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
        netdisk: 'off',
    })[key] ?? fallback,
};

let seq = 0;
async function load(kind) {
    const url = pathToFileURL(path.resolve(FILES[kind]));
    url.searchParams.set('siteTest', String(++seq));
    return (await import(url.href)).default;
}

const reply = (content, status = 200, headers = {}) => ({
    headers: {status: `HTTP/1.1 ${status}`, ...headers},
    content: typeof content === 'string' ? content : JSON.stringify(content),
});
const html = (body, status = 200) => reply(body, status, {'content-type': 'text/html'});
const json = (body, status = 200) => reply(body, status, {'content-type': 'application/json'});

function context(responder, {verified = true} = {}) {
    return {
        req: async (url, options) => responder(String(url), options || {}),
        store: {
            get: (key, fallback) => (key === 'browserVerified' && verified ? {value: 'fixture-proof', at: Date.now() + 3600000} : fallback),
            set: () => {},
        },
        getProxyUrl: async () => 'http://127.0.0.1:54058/proxy/fixture/',
    };
}

// ── 网络桩：DNS 与 http.request，用来验证“不连接未受检目标” ────────────────
const realLookup = dns.promises.lookup;
const realRequest = http.request;
function dnsStub(table) {
    dns.promises.lookup = async hostname => {
        const value = table[hostname];
        if (!value) throw Object.assign(new Error('ENOTFOUND'), {code: 'ENOTFOUND'});
        return (Array.isArray(value) ? value : [value]).map(address => ({address, family: address.includes(':') ? 6 : 4}));
    };
    return () => { dns.promises.lookup = realLookup; };
}
function httpStub(handler) {
    const calls = [];
    http.request = (options, callback) => {
        calls.push(options);
        const request = new EventEmitter();
        request.setTimeout = () => request;
        request.destroy = error => request.emit('error', error);
        request.end = () => {
            const result = handler(options, calls.length);
            if (!result) { setImmediate(() => request.emit('error', new Error('unexpected media request'))); return; }
            const response = new EventEmitter();
            response.statusCode = result.status || 200;
            response.headers = result.headers || {};
            setImmediate(() => {
                callback(response);
                if (result.body !== undefined) response.emit('data', Buffer.from(result.body));
                response.emit('end');
            });
        };
        return request;
    };
    return {calls, restore: () => { http.request = realRequest; }};
}
async function withStubs({dns: table, http: handler}, fn) {
    const restoreDns = table ? dnsStub(table) : () => {};
    const stub = handler ? httpStub(handler) : {calls: [], restore: () => {}};
    try { return await fn(stub); }
    finally { restoreDns(); stub.restore(); }
}

async function playAndProxy(kind, media, extra = {}) {
    const source = await load(kind);
    const ctx = context(async url => {
        const pathname = new URL(url).pathname;
        if (kind === 'jf' && pathname.startsWith('/res/py/')) return json({code: 200, url: media});
        if (kind === 'y2' && pathname.includes('/episode/url')) return json({code: 200, data: {list: [{url: media, resolution: 1080, resolutionName: '蓝光'}]}});
        throw new Error('unexpected control request: ' + pathname);
    }, extra);
    const played = await source.play(ctx, '', kind === 'jf' ? 'jiaofu:abc1:1' : 'y2:1:2');
    const params = Object.fromEntries(new URL(played.url).searchParams);
    return {ctx, source, params};
}

// ── 教父固定样本（内嵌 _obj 结构）────────────────────────────────────────
const JF_HOME = '_obj.header={q:"",t:"",p:"",l:"home"};\n'
    + '_obj.banner={"t":["推荐片"],"n":["A"],"i":["Ow0LY"],"y":["mv"],"j":["简介"],"d":["美国"],"c":["电影"],"l":[["剧情"]]};\n'
    + '_obj.inlist=[{"ty":"mv","t":["首页片一","首页片二"],"i":["Abc12","Def34"],"a":[[2026,1,3],[2025]],"q":[["4K"],[]],"d":[8,7.5],"im":[7.5,7],"g":["全6集",""]}];';
const JF_CATEGORY = '_obj.inlist={"ty":"mv","t":["分类片"],"i":["CdE34"],"a":[[2025]],"q":[[]],"d":[7],"im":[7],"g":[""]};_obj.page={"pages":50,"curr":1};';
const JF_SEARCH = '_obj.search={"q":"x","l":{"title":["搜索结果"],"d":["mv"],"i":["FgH56"],"year":[2024],"info":["大陆 / 剧情"],"pf":{"db":{"s":[7.1]}}}};_obj.page={"pages":8,"curr":1};';
const JF_DETAIL = '_obj.d={"title":"详情片","year":2026,"dir":"mv","dname":"电影","daoyan":["某导演"],"zhuyan":["某演员"],"diqu":["中国"],"yuyan":["国语"],"leixing":["剧情"],"summary":"简介","pf":{"db":{"s":"7.8"}}};_obj.cblist={"t":[],"u":[]};';
const JF_RESOURCES = {code: 200, playlist: [{i: 'line1', t: '线路(1)', list: [[['第', '集'], [1, 2]]]}], panlist: {id: []}};

function jfResponder(routes) {
    return async url => {
        const {pathname, search} = new URL(url);
        if (pathname === '/res/pow') return routes.pow ? routes.pow() : json({N: '11', x: '2', t: 1});
        if (pathname.startsWith('/res/downurl/')) return json(JF_RESOURCES);
        if (pathname === '/res/search_suggest') return json([{id: 'Ow0LY', dir: 'mv', title: '搜索建议片'}]);
        if (pathname === '/') return routes.home ? routes.home() : html(JF_HOME);
        if (pathname === '/mv' && !search.includes('page=2')) return html(JF_CATEGORY);
        if (pathname === '/search') return routes.search ? routes.search() : html(JF_SEARCH);
        if (pathname === '/mv/Ow0LY') return html(JF_DETAIL);
        throw new Error('unexpected fixture route: ' + pathname + search);
    };
}

test('教父：首页、分类、搜索、详情正常路径', {skip: skip('jf')}, async () => {
    const source = await load('jf');
    const ctx = context(jfResponder({}));
    assert.equal((await source.home(ctx)).class.length, 3);
    assert.equal((await source.homeVod(ctx)).list.length, 3);
    const category = await source.category(ctx, 'mv', 1);
    assert.equal(category.list.length, 1);
    assert.equal(category.pagecount, 50);
    const search = await source.search(ctx, '庆余年', false, 1);
    assert.equal(search.pagecount, 8);
    const detail = (await source.detail(ctx, 'mv/Ow0LY')).list[0];
    assert.equal(detail.vod_name, '详情片');
    assert.equal(detail.vod_play_from, '线路');
    assert.equal(detail.vod_play_url.split('#').length, 2);
});

test('教父：首页失败不再阻断分类和搜索（homeVod 返回空推荐）', {skip: skip('jf')}, async () => {
    const source = await load('jf');
    const ctx = context(jfResponder({home: () => html('homepage failure', 503)}));
    const home = await source.home(ctx);
    assert.equal(home.class.length, 3);
    assert.match(home.notice, /首页暂时读取失败/);
    assert.deepEqual(await source.homeVod(ctx), {list: []});
    const category = await source.category(ctx, 'mv', 1);
    assert.equal(category.list.length, 1);
    const search = await source.search(ctx, '庆余年', false, 1);
    assert.equal(search.list[0].vod_name, '搜索结果');
});

test('教父：验证 POST 失败后搜索降级到建议接口', {skip: skip('jf')}, async () => {
    const source = await load('jf');
    const calls = [];
    const ctx = context(jfResponder({
        pow: () => { calls.push('/res/pow'); return calls.length === 1 ? json({N: '11', x: '2', t: 1}, 200, {'set-cookie': 'browser_pow=fixture; Path=/'}) : json({success: false}, 403); },
        search: () => { calls.push('/search'); return html('no', 503); },
    }), {verified: false});
    const result = await source.search(ctx, '希望', false, 1);
    assert.equal(calls.filter(item => item === '/res/pow').length, 2);
    assert.equal(result.total, 1);
    assert.equal(result.list[0].vod_name, '搜索建议片');
    assert.match(result.notice, /搜索建议/);
});

test('教父：验证 POST 失败后详情降级到免验证资源接口', {skip: skip('jf')}, async () => {
    const source = await load('jf');
    const calls = [];
    const ctx = context(async url => {
        const {pathname} = new URL(url);
        if (pathname === '/res/pow') { calls.push(pathname); return calls.filter(item => item === pathname).length === 1 ? json({N: '11', x: '2', t: 1}, 200, {'set-cookie': 'browser_pow=fixture; Path=/'}) : json({success: false}, 403); }
        if (pathname === '/mv/Ow0LY') { calls.push('detail-page'); return html('blocked', 503); }
        if (pathname.startsWith('/res/downurl/')) { calls.push('downurl'); return json(JF_RESOURCES); }
        throw new Error('unexpected route ' + pathname);
    }, {verified: false});
    const detail = (await source.detail(ctx, 'mv/Ow0LY')).list[0];
    assert.ok(calls.includes('downurl'));
    assert.equal(detail.vod_play_from, '线路');
    assert.equal(detail.vod_play_url.split('#').length, 2);
});

test('教父：媒体域名解析到内网时拒绝，且不发起连接', {skip: skip('jf')}, async () => {
    const media = 'http://cdn.media-fixture.net/media.m3u8';
    const {ctx, source, params} = await playAndProxy('jf', media);
    await withStubs({dns: {'cdn.media-fixture.net': '127.0.0.1'}, http: () => ({status: 200, body: 'REVIEW-ONLY-MARKER'})}, async stub => {
        const result = await source.proxy(ctx, params);
        assert.equal(result[0], 403);
        assert.equal(stub.calls.length, 0);
    });
});

test('爱电影：媒体域名解析到内网时拒绝，且不发起连接', {skip: skip('y2')}, async () => {
    const media = 'http://cdn.media-fixture.net/media.m3u8?whip=203.0.113.9';
    const {ctx, source, params} = await playAndProxy('y2', media);
    await withStubs({dns: {'cdn.media-fixture.net': '127.0.0.1'}, http: () => ({status: 200, body: 'REVIEW-ONLY-MARKER'})}, async stub => {
        const result = await source.proxy(ctx, params);
        assert.equal(result[0], 403);
        assert.equal(stub.calls.length, 0);
    });
});

test('爱电影：302 跳转到回环地址会被逐跳拦截', {skip: skip('y2')}, async () => {
    const media = 'http://cdn.media-fixture.net/index.m3u8?whip=203.0.113.9';
    const {ctx, source, params} = await playAndProxy('y2', media);
    await withStubs({
        dns: {'cdn.media-fixture.net': '203.0.113.9'},
        http: () => ({status: 302, headers: {location: 'http://127.0.0.1:9/review-only'}}),
    }, async stub => {
        const result = await source.proxy(ctx, params);
        assert.equal(result[0], 403);
        assert.equal(stub.calls.length, 1, '第二跳不应发起连接');
    });
});

test('教父：302 跳转到内网同样被拦截', {skip: skip('jf')}, async () => {
    const media = 'http://cdn.media-fixture.net/index.m3u8';
    const {ctx, source, params} = await playAndProxy('jf', media);
    await withStubs({
        dns: {'cdn.media-fixture.net': '203.0.113.9', 'internal.media-fixture.net': '10.0.0.7'},
        http: () => ({status: 302, headers: {location: 'http://internal.media-fixture.net/secret'}}),
    }, async stub => {
        const result = await source.proxy(ctx, params);
        assert.equal(result[0], 403);
        assert.equal(stub.calls.length, 1, '第二跳不应发起连接');
    });
});

test('媒体代理：连接使用已校验的解析地址，正常回包', {skip: skip('jf')}, async () => {
    const media = 'http://cdn.media-fixture.net/media.m3u8';
    const {ctx, source, params} = await playAndProxy('jf', media);
    const payload = Buffer.from([0x47, 0x40, 0x11, 0x10]);
    await withStubs({
        dns: {'cdn.media-fixture.net': '203.0.113.9'},
        http: () => ({status: 200, headers: {'content-type': 'video/mp2t'}, body: payload}),
    }, async stub => {
        const result = await source.proxy(ctx, params);
        assert.equal(result[0], 200);
        assert.deepEqual(Buffer.from(result[2], 'base64'), payload);
        const pinned = [];
        stub.calls[0].lookup('cdn.media-fixture.net', {all: true}, (error, address) => pinned.push(address));
        assert.equal(pinned[0][0].address, '203.0.113.9');
    });
});

// ── 爱电影固定样本（签名接口桩）──────────────────────────────────────────
const Y2_HOME = {code: 200, data: {homeNewMoviePageData: {list: [{vodId: 11, vodName: '电影甲'}, {vodId: 12, vodName: '电影乙'}]}, newestTvPageData: {list: [{vodId: 13, vodName: '剧集丙'}]}}};
const Y2_LIST = {code: 200, data: {totalCount: 45, pageNum: 1, pageSize: 30, totalPage: 2, list: [{vodId: 21, vodName: '分类片'}]}};
const Y2_SEARCH = {code: 200, data: {totalCount: 1, pageNum: 1, pageSize: 30, totalPage: 1, list: [{vodId: 31, vodName: '搜索结果'}]}};
const Y2_DETAIL = {code: 200, data: {vodId: 31, vodName: '详情片', typeName: '电影', vodYear: '2026', vodTotal: 2, vodRemarks: '(2全)', episodeList: [{nid: 41, name: '1'}, {nid: 42, name: '2'}]}};
const Y2_EPISODE = {code: 200, data: {list: [
    {url: 'http://cdn.media-fixture.net/hd.m3u8?whip=203.0.113.9', resolution: 1080, resolutionName: '蓝光'},
    {url: 'http://cdn.media-fixture.net/sd.m3u8?whip=203.0.113.9', resolution: 480, resolutionName: '标清'},
]}};

test('爱电影：首页、分类、搜索、详情与清晰度线路', {skip: skip('y2')}, async () => {
    const source = await load('y2');
    const seen = [];
    const ctx = context(async url => {
        const {pathname} = new URL(url);
        seen.push(pathname);
        if (pathname.endsWith('/v1/home/all/list')) return json(Y2_HOME);
        if (pathname.endsWith('/video/list')) return json(Y2_LIST);
        if (pathname.endsWith('/searchByWordPageable')) return json(Y2_SEARCH);
        if (pathname.endsWith('/video/detail')) return json(Y2_DETAIL);
        if (pathname.includes('/episode/url')) return json(Y2_EPISODE);
        throw new Error('unexpected route ' + pathname);
    });
    assert.equal((await source.home(ctx)).class.length, 5);
    assert.equal((await source.homeVod(ctx)).list.length, 3);
    const category = await source.category(ctx, '1', 1);
    assert.equal(category.pagecount, 2);
    assert.equal(category.total, 45);
    assert.equal((await source.search(ctx, '庆余年', false, 1)).list[0].vod_name, '搜索结果');
    const detail = (await source.detail(ctx, '31')).list[0];
    assert.equal(detail.vod_name, '详情片');
    assert.deepEqual(detail.vod_play_from.split('$$$'), ['蓝光', '标清']);
    assert.equal(detail.vod_play_url.split('$$$')[0].split('#').length, 2);
    assert.ok(seen.some(item => item.includes('/episode/url')));
});

test('爱电影：首页接口失败时 homeVod 返回空列表，分类仍可用', {skip: skip('y2')}, async () => {
    const source = await load('y2');
    const ctx = context(async url => {
        const {pathname} = new URL(url);
        if (pathname.endsWith('/v1/home/all/list')) return json({code: 500, msg: 'boom'});
        if (pathname.endsWith('/video/list')) return json(Y2_LIST);
        throw new Error('unexpected route ' + pathname);
    });
    assert.deepEqual(await source.homeVod(ctx), {list: []});
    assert.equal((await source.category(ctx, '1', 1)).list.length, 1);
});
