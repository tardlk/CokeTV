# CokeTV AI 接手文档

更新：2026-10-05。公开交接文件，不含本机密码、用户源或私密运行配置。接手先读根 `AGENTS.md` 和本文件。

## 发行约定

- 仓库 `https://github.com/tardlk/CokeTV`，默认分支 `main`。镜像 `ghcr.io/tardlk/coketv`，只发布 `linux/amd64`（x86-64）。
- 产品是空壳：发行源码和镜像零预置站点、解析脚本和站点资源。原300多源已移出当前发行树，不能通过默认下载/扫描重新恢复。
- 保留全部五种引擎：drpyS/JS、DR2、CatVod、HIPY/Python、PHP，以及兼容辅助依赖。不增加 Android JAR 运行器或 OmniBox SDK/Runner。
- 用户经管理界面新建、文件/ZIP导入或TVBox配置链接导入自己的源。运行数据只存 `data/`；数据、工具、依赖、构建输出、截图和历史均忽略，不进入Docker上下文。
- 忽略的根 `HANDOFF.md` 只供本机阅读，可能含本地调试凭据，不能提交。公开交接维护本文件。

## 当前产品

- `/` 默认公开观影，兼容 `/watch`；浏览、搜索、详情、播放、历史和收藏无需管理密码。`/admin` 和 `/sources/<id>/edit` 需要密码。
- 全新部署第一次进入管理后台创建密码，无默认密码或账号系统。管理凭据在标签页sessionStorage，退出清除；匿名接口不返回参数、ENV、脚本、订阅Token。
- 源列表为选择框、名称、语言、状态、搜索、筛选、操作。JS/Python/PHP徽章均绿色白字，JS覆盖内部三种JS引擎。名称单击只重命名，操作是编辑和删除。
- 勾选后启用/停用/删除/取消选择。删除确认后移除实例和订阅引用，保留脚本、版本与ENV文件。不拿正式用户数据测试删除。
- 独立源编辑工作区：白底Monaco、本源ENV、扩展参数、接口验证、预览和日志。代码/参数/ENV独立保存，未保存时禁用验证并提醒退出。
- 导入默认TVBox链接，另有本地文件/ZIP。预览只下载/识别/语法检查；所选项批量保存。JS歧义手动选格式，JSON/XML采集生成CatVod兼容脚本；JAR/远程T4和失败项列出原因。去重并保留已有脚本与订阅。
- 观影布局按用户OmniBox实测，ArtPlayer、HLS.js、mpegts.js按需加载；线路/选集/前后集/续播。搜索下拉、本地记录、搜索按钮/回车；影视站点击打开选源。
- 采集首页无封面时补取JSON `ac=detail` / XML `ac=videolist`，相对图片地址补全。公共逻辑修复进engine helper，不改用户已导入脚本。
- 收藏、历史和续播只在localStorage。订阅继续用独立Token；媒体短期凭证不能访问管理/API/订阅。

## 架构

| 文件 | 职责 |
| --- | --- |
| `src/server.js` | Fastify管理/公开源接口、路由、订阅和代理 |
| `src/store.js` | 原子状态、运行副本、扫描、脚本版本、批量导入回滚 |
| `src/auth.js` | 首次管理密码与Basic鉴权 |
| `src/runner.js` / `src/worker.js` | 按需引擎子进程、64项串行队列、超时回收 |
| `src/tvbox-import.js` | 配置读取、分类、相对引用、依赖、预览/提交 |
| `src/playback.js` / `src/media.js` | 12小时媒体凭证、请求头、Range/HLS代理 |
| `engine/utils/tvbox-cms.js` | JSON/XML采集、首页完整封面 |
| `web/App.vue` / `web/WatchApp.vue` | 管理与公开观影 |
| `web/SourceWorkspace.vue` / `web/CodeEditor.vue` | 编辑工作区和Monaco |
| `web/SourceImport.vue` / `web/WebPlayer.vue` | 导入窗口和播放器 |
| `scripts/check-shell.mjs` | 发行树零预置源断言 |
| `scripts/container-smoke.mjs` | x86空容器与JS/Python/PHP真实执行验收 |

`engine/spider/` 只保留辅助模块、HIPY core/base、PHP桥接/lib和WASM。`engine/json/`、`engine/jx/`、`engine/data/` 为空，config是空默认值。第一次准备空运行目录；升级保留已有data，不添加原站点。

## 验证

```sh
npm ci
npm run check
npm run build
npm test
```

Node22，Python/PHP真实解释器可用 `TEST_PYTHON` / `TEST_PHP` 指定。当前源码89测试（42后端+47UI）、115文件语法、空壳检查和构建通过。全部测试使用临时数据。

干净克隆后先build再test：页面路由集成测试需要dist/index.html。不能依赖本机忽略的dist，让GitHub工作流先构建。

Python新建模板必须接受HIPY守护进程的 `t4_api` 构造参数；创建模板测试除语法检查外实际执行首页，容器验收也覆盖这条路径。

未运行原drpy-node-coder CLI，不宣称使用过。协议样本不代表所有第三方站点、解析器或编码可播。

## 发布

- 2026-10-05首次发布已完成：功能提交 `3b17276`，源码 [Verify 37252776598](https://github.com/tardlk/CokeTV/actions/runs/37252776598) 和 [Docker amd64 37252776569](https://github.com/tardlk/CokeTV/actions/runs/37252776569) 均成功。真实Linux x86容器验收通过零源、首次管理密码和JS/Python/PHP实际执行。
- 已发布 `ghcr.io/tardlk/coketv:latest` 与 `ghcr.io/tardlk/coketv:sha-3b17276`，digest为 `sha256:8e733b3cc506be4682015e9df004ba9b3705f31c058d9da263e28dbfa049461c`；匿名读取镜像manifest/config成功，确认 `linux/amd64`。
- 前两次工作流发现并修复了干净克隆先build再test、新建HIPY模板缺少t4_api的问题。这些修正已进入功能提交；失败镜像没有发布。
- Verify工作流：语法、空壳、测试、构建。
- Docker amd64工作流：main/tag/manual→源码验证→原生amd64构建→临时空容器验收→GHCR发布。使用仓库GITHUB_TOKEN的packages权限，不提交任何发布密钥。
- `latest` 对应main，`sha-*`用于固定提交；`v*`标签发布版本。
- Compose使用GHCR镜像，挂载 `./data:/app/data`。镜像不能包含本机数据；可用 `INSTALL_BROWSER=1` 自建浏览器版。
- 每次发布状态、运行ID、镜像digest从Actions/GHCR实时查询。失败应修复重试，不能把旧结果写成新一次通过。

## 接手边界

继续以用户的新要求为准。不要清空、重建用户数据；不要恢复标签、状态筛选、列表验证按钮或依赖工具栏。不要把空壳理解成删除源引擎。更新本文件记录最终实现和验证事实，不放凭据、本机绝对路径或私密地址。
