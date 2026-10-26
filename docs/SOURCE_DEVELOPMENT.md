# 源开发指南

CokeTV 只有 drpy3 一个源执行引擎。这里说的“源”是一个导出 `default` 对象的本地 JavaScript 文件，不是 OmniBox 的 `spider_runner` / `omnibox_sdk` 脚本，也不支持 Python。

发行是空壳，仓库不提供任何站点示例；下面用虚构 API 演示契约。请只为自己有权访问的站点编写和导入脚本。

## 快速开始

1. 启动 CokeTV，打开 `/admin`。
2. 在“源管理”新建源，或点“导入脚本”选择 `.js` / ZIP。
3. 在编辑器里写 `meta`、`rule` 和需要的方法，先保存，再点“执行验证”。
4. 验证首页 → 分类 → 搜索 → 详情 → 播放；通过后把源加入订阅。
5. 用网页 `/watch?source=<源ID>`、TVBox `/tvbox/<Token>` 或 Emby 实际播放确认。

编辑器只验证**已保存**版本；有未保存修改时会阻止验证。新建/导入脚本会自动创建对应源，不需要再手工建实例。

## 一个最小源

```js
const HOST = 'https://example.com';

export default {
    meta: {title: '示例站', lang: 'dr3'},
    rule: {
        host: HOST,
        class_name: '电影&剧集',
        class_url: 'movie&tv',
        searchable: 1,
        filterable: 0,
    },
};
```

`meta.title` 是显示名，`lang` 固定 `dr3`。`rule.host` 是站点根地址；`class_name` / `class_url` 用 `&` 分隔多个分类；`searchable: 1` 才允许搜索。

## 方法契约

按需实现；常规影视源通常全部实现。

| 方法 | 推荐签名 | 返回 |
|---|---|---|
| `init` | `init(ctx, extend)` | 初始化；`extend` 是源扩展参数 |
| `home` | `home(ctx, filter)` | `{class: [{type_id, type_name}], list?, banner?, filters?}` |
| `homeVod` | `homeVod(ctx)` | `{list: Vod[]}` 或数组 |
| `category` | `category(ctx, tid, pg, filter, extend)` | `{page, pagecount, total?, list}` |
| `search` | `search(ctx, wd, quick, pg)` | `{page, pagecount, total?, list}` |
| `detail` | `detail(ctx, id)` | `{list: [Vod]}`，必须含线路和剧集 |
| `play` | `play(ctx, flag, id, flags)` | `{parse: 0, url, header}` 或 `urls` |
| `proxy` | `proxy(ctx, params)` | 可选，源自己的代理规则 |
| `action` | `action(ctx, name, value)` | 可选，源自定义动作 |

`ctx` 由宿主传入。常用能力：

- `ctx.req(url, options)`：异步 HTTP 请求，返回 `{content, headers}`。`options` 支持 `method`、`headers`、`data`、`timeout`、`redirect` 等。
- `ctx.syncReq(...)`：同步请求版本，仅在确实需要同步语义时使用。
- `ctx.pdfh(html, rule, base?)` / `ctx.pdfa(html, rule)` / `ctx.pd(...)` / `ctx.pdfl(...)`：按 jsoup 规则解析 HTML。
- `ctx.store.get(key, fallback)` / `ctx.store.set(key, value)` / `ctx.store.delete(key)`：按源实例持久化的 KV，worker 重启后保留，删除脚本时清理。
- `ctx.loadAsset('lib/file.wasm')`：读取随源 ZIP 提供的资产。
- `ctx.log(...)` 或 `console.log(...)`：写入调试日志；日志会脱敏，但不要主动打印 Cookie。
- `ctx.rule`、`ctx.meta`、`ctx.key`：当前源信息。

ENV 是全局对象：`ENV.get('cookie')`、`ENV.set(...)`、`ENV.delete(...)`。在源编辑页的“本源环境变量”里配置，未定义时回退全局默认值。

## 完整示例（JSON API）

```js
const HOST = 'https://example.com';

const toVod = item => ({
    vod_id: String(item.id),
    vod_name: item.title || '',
    vod_pic: item.pic || '',
    vod_remarks: item.remark || '',
    vod_year: item.year || '',
});

export default {
    meta: {title: '示例站', lang: 'dr3'},
    rule: {host: HOST, class_name: '电影&剧集', class_url: 'movie&tv', searchable: 1, filterable: 0},

    async home(ctx) {
        return {
            class: [
                {type_id: 'movie', type_name: '电影'},
                {type_id: 'tv', type_name: '剧集'},
            ],
        };
    },

    async homeVod(ctx) {
        const res = await ctx.req(`${HOST}/api/home`, {timeout: 15000});
        const data = JSON.parse(res.content);
        return {list: (data.items || []).map(toVod)};
    },

    async category(ctx, tid, pg) {
        const res = await ctx.req(`${HOST}/api/list?type=${encodeURIComponent(tid)}&page=${pg}`);
        const data = JSON.parse(res.content);
        return {page: pg, pagecount: data.pages || 1, total: data.total || 0, list: (data.items || []).map(toVod)};
    },

    async search(ctx, wd, quick, pg) {
        if (!wd) return {page: 1, pagecount: 0, total: 0, list: []};
        const res = await ctx.req(`${HOST}/api/search?wd=${encodeURIComponent(wd)}&page=${pg}`);
        const data = JSON.parse(res.content);
        return {page: pg, pagecount: data.pages || 1, total: data.total || 0, list: (data.items || []).map(toVod)};
    },

    async detail(ctx, id) {
        const data = JSON.parse((await ctx.req(`${HOST}/api/detail?id=${encodeURIComponent(id)}`)).content);
        const episodes = data.episodes || [];
        return {list: [{
            ...toVod(data),
            vod_content: data.desc || '',
            vod_play_from: '线路A',
            vod_play_url: episodes.map((ep, i) => `第${i + 1}集$${ep.id}`).join('#'),
        }]};
    },

    async play(ctx, flag, id) {
        const data = JSON.parse((await ctx.req(`${HOST}/api/play?id=${encodeURIComponent(id)}`)).content);
        return {parse: 0, url: data.url, header: data.header || {}};
    },
};
```

## 返回字段

列表/首页条目通常是：

```js
{
    vod_id: '稳定ID',
    vod_name: '名称',
    vod_pic: 'https://...',
    vod_remarks: '更新到第 10 集',
    vod_year: '2024',
}
```

详情在列表字段之外增加：

```js
{
    vod_content: '简介',
    vod_actor: '演员',
    vod_director: '导演',
    vod_area: '地区',
    vod_play_from: '线路A$$$线路B',
    vod_play_url: '第1集$id1#第2集$id2$$$第1集$alt1',
}
```

分隔规则：

- `vod_play_from`：线路之间用 `$$$`。
- `vod_play_url`：`名称$播放ID`，集之间用 `#`，线路之间用 `$$$`。
- 两条线路的集数可以不同，但线路数量必须与 `vod_play_from` 对齐。
- 播放 ID 里不要随意出现 `$`、`#`、`$$$`；有特殊字符时先编码或换稳定 ID。

`play` 最简单返回：

```js
return {parse: 0, url: 'https://cdn.example.com/a.m3u8', header: {Referer: HOST + '/'}};
```

`parse: 1` 表示需要解析；网页端只有在配置了解析器时才比较可用。优先返回直链 m3u8/mp4。多清晰度可以返回 `urls` 数组，CokeTV 会保留并取第一个给共享网页/Emby 播放。

## 导航源

导航源不负责搜索或播放，只展示热播/分类；用户点击条目时，CokeTV 用 `vod_name` 对全部启用且可搜索的源发起聚合搜索。

```js
export default {
    meta: {title: '豆瓣热播', lang: 'dr3', navigation: true},
    rule: {host: 'https://example.com', searchable: 0},
    async home() { return {class: []}; },
    async homeVod() {
        return {list: [
            {vod_id: 'hot-1', vod_name: '热播片名'},
        ]};
    },
};
```

- `meta.navigation: true` 会被保存时解析，管理列表显示“导航”，网页端自动启用全源搜索。
- 导航源本身不会进入聚合搜索；只查询其他已启用、`searchable` 的源。
- 导航源不要求实现 `detail`/`play`；点击条目不进入它自己的详情页。
- 聚合搜索由 `/watch/search?wd=<片名>` 提供，结果按源分组；单次最多 12 个源、单源 6 秒超时，失败/超时返回部分结果。
- 网页端点击结果会切到结果所属源并打开播放；TVBox/猫影视/Emby 没有这套跨源交互，仍依赖各自客户端。
- 如果所有可搜索源都没有结果，页面会显示空结果；可返回导航源继续浏览。

## HTML 站点

```js
async category(ctx, tid, pg) {
    const html = (await ctx.req(`${HOST}/list/${tid}/${pg}.html`)).content;
    const items = ctx.pdfa(html, 'div.item');
    return {
        page: pg,
        pagecount: 1,
        list: items.map(item => ({
            vod_id: ctx.pdfh(item, 'a&&href'),
            vod_name: ctx.pdfh(item, 'h3&&Text'),
            vod_pic: new URL(ctx.pdfh(item, 'img&&src'), HOST).href,
        })),
    };
}
```

jsoup 规则写法以编辑器实际验证结果为准；相对图片/播放地址要补成绝对 URL。

## 调试与验收

- 编辑器右侧“调试终端”显示 `console.log` 和错误；验证结果可切 JSON 看原始返回。
- 普通操作 30 秒超时，`action` 60 秒；慢接口自行缩短 `ctx.req` 的 timeout，避免整个请求被回收。
- 页面结构或接口变化时，先验证首页和详情，再验证播放。
- 可选的命令行诊断：

```sh
npm run verify -- <源实例ID> [服务地址] --password-stdin
```

它会从 stdin 或 `ADMIN_PASSWORD` 读取管理密码，不读取本地明文凭据。

## 导入与多文件

单文件入口用 `.js`；ZIP 支持：

```text
spider/js_dr3/源.js
spider/js_dr3/lib/helper.mjs
spider/js_dr3/lib/module.wasm
json/参数.json
jx/解析.js
```

- 顶层 `_` 前缀文件是辅助模块，不会自动注册为源。
- 支持相对 ESM/CJS 和 `?bytes` 资产导入。
- ZIP 拒绝越界、隐藏路径和符号链接；文件数和大小有限制。
- 不支持远程依赖下载、`@dependencies` 自动安装或 OmniBox SDK。

## 发布与使用

保存后源自动启用。到“订阅管理”把源加入订阅：

- 网页：`/watch?source=<源ID>`
- TVBox：`/tvbox/<Token>`
- 猫影视：`/cat/<Token>/index.js.md5`
- Emby：服务根地址 + 用户名 `coke` + 该订阅 Token

一个脚本通常对应一个源；需要多套站点配置时，复制脚本后改 `meta`/`HOST`/参数，或在源 ENV 中区分。

## 常见问题

| 现象 | 先检查 |
|---|---|
| 首页有分类但没影片 | 是否实现 `homeVod`，或 `home` 是否返回 `list` |
| 搜索不可用 | `rule.searchable` 是否为 `1`，`search` 是否处理空关键词 |
| 详情没有线路 | `vod_play_from` / `vod_play_url` 是否都返回且线路数一致 |
| 播放 403/404 | 补 `Referer`/`User-Agent`/Cookie；确认地址是绝对 URL；检查是否必须由服务器代理 |
| 播放地址是网页 | 先找直链；`parse: 1` 需要解析器，不能指望所有客户端 |
| 请求超时 | 接口慢或分页过大；缩短 timeout、加缓存、减少并发 |
| 中文乱码 | 让 `ctx.req` 使用正确编码；HTML 站点先确认响应头 |
| 详情 ID 不稳定 | 用站点内稳定 ID，不要用会变的展示序号 |
| 导航源点击没反应 | 确认 `meta.navigation: true`，且条目有 `vod_name`；同时至少有一个启用的可搜索源 |

## 与 OmniBox 的差异

CokeTV 不兼容 OmniBox 的脚本运行方式：

- 不运行 `omnibox_sdk` / `spider_runner`，不支持 Python。
- 方法签名是 `(ctx, ...)` + TVBox 字段，不是 `(params, context)`。
- 不提供自动依赖安装、远程脚本更新、`sniffVideo`、ffprobe 媒体信息或网盘账号直连 SDK。
- 源与宿主同权限执行，只导入可信脚本；账号 Cookie 放 ENV，不要写死或打印。

## 安全边界

源脚本可以导入 Node 模块、访问文件系统和网络，**不是沙箱**。只运行自己编写或确认可信的脚本；不要把管理密码、Cookie 或 Token 提交到仓库、贴到日志或发给不可信的人。

---

更多运行/配置细节见 [README](../README.md)；网盘分享源的宿主契约见 [接手记录](AI_HANDOFF.md#网盘开发契约)。
