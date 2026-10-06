# CokeTV AI 接手文档

更新：2026-10-06。**这是本项目唯一的接手文档**：原有的《审查报告》《完善计划》《修复验收报告》《第二轮验收报告》四份过程文件已全部并入本文件并删除，不要再去找它们。

公开交接文件，不含凭据、本机绝对路径或私密地址。接手请按顺序读：

1. 根 `AGENTS.md`（硬性工作约定，优先于本文件）
2. 本文件
3. 需要改代码时再看 `README.md`、`docs/CONFIGURATION.md`、`docs/DEVELOPMENT.md`、`SECURITY.md`、`docs/THIRD_PARTY.md`

---

## 1. 发行约定

- 仓库 `https://github.com/tardlk/CokeTV`，默认分支 `main`。镜像 `ghcr.io/tardlk/coketv`，只发布 `linux/amd64`（x86-64）。
- 产品是空壳：发行源码和镜像零预置站点、解析脚本和站点资源。原 300 多源已移出当前发行树，不能通过默认下载/扫描重新恢复。
- 保留全部五种引擎：drpyS/JS、DR2、CatVod、HIPY/Python、PHP，以及兼容辅助依赖。不增加 Android JAR 运行器或 OmniBox SDK/Runner。
- 用户经管理界面新建、文件/ZIP 导入或 TVBox 配置链接导入自己的源。运行数据只存 `data/`；数据、工具、依赖、构建输出、截图和历史均忽略，不进入 Docker 上下文。
- 被 gitignore 的根 `HANDOFF.md` 只供本机阅读，可能含本地调试凭据，不能提交、不能引用。

## 2. 当前产品

- `/` 默认公开观影，兼容 `/watch`；浏览、搜索、详情、播放、历史和收藏无需管理密码。`/admin` 和 `/sources/<id>/edit` 需要密码。
- 全新部署第一次进入管理后台需要**一次性引导码**（启动日志打印，同时写入 `data/setup-code.txt`，0600，用后删除）再创建密码；无默认密码或账号系统。`ADMIN_PASSWORD` 环境变量可跳过引导。管理凭据在标签页 sessionStorage，退出清除。
- 源列表为选择框、名称、语言、状态、搜索、筛选、操作。JS/Python/PHP 徽章均绿色白字，JS 覆盖内部三种 JS 引擎。名称单击只重命名，操作是编辑和删除。
- 勾选后启用/停用/删除/取消选择。删除确认后移除实例和订阅引用，保留脚本、版本与 ENV 文件。不拿正式用户数据测试删除。
- 独立源编辑工作区：白底 Monaco、本源 ENV、扩展参数、接口验证、预览和日志。代码/参数/ENV 独立保存，未保存时禁用验证并提醒退出。
- 导入默认 TVBox 链接，另有本地文件/ZIP。预览只下载/识别/语法检查；所选项批量保存。JS 歧义手动选格式，JSON/XML 采集生成 CatVod 兼容脚本；JAR/远程 T4 和失败项列出原因。去重并保留已有脚本与订阅。
- 观影布局按用户 OmniBox 实测，ArtPlayer、HLS.js、mpegts.js 按需加载；线路/选集/前后集/续播。搜索下拉、本地记录、搜索按钮/回车；影视站点击打开选源。
- 采集首页无封面时补取 JSON `ac=detail` / XML `ac=videolist`，相对图片地址补全。公共逻辑修复进 engine helper，不改用户已导入脚本。
- 收藏、历史和续播只在 localStorage。订阅继续用独立 Token。
- 设置页含「代理与参数安全」分组：`allowPrivateTargets`、`jsonPublic` 两个开关 + `targetAllowlist` 白名单输入框（公网部署建议关内网、保持参数文件私有）。

## 3. 架构

| 文件 | 职责 |
| --- | --- |
| `src/server.js` | Fastify 管理/公开源接口、路由、订阅和代理；鉴权、限流、SSRF 守卫都在这层 |
| `src/store.js` | 原子状态、运行副本、扫描、脚本版本、批量导入回滚 |
| `src/auth.js` | 首装引导码、scrypt 加盐凭据（异步）、旧明文格式登录后迁移、Basic 鉴权 |
| `src/runner.js` / `src/worker.js` | 按需引擎子进程、64 项串行队列、超时回收、Python 守护进程存活探测与退避重启 |
| `src/tvbox-import.js` | 配置读取、分类、相对引用、依赖、预览/提交 |
| `src/playback.js` / `src/media.js` | 最长 12 小时的服务端随机媒体能力票据、请求头、Range/HLS 代理 |
| `src/runtime-files.js` | spider 框架保留路径清单，启动刷新与空壳检查共用 |
| `src/ssrf.js` | 按 IP 字节判定元数据、内网与白名单，只返回获准的连接地址 |
| `src/outbound.js` | 受检 DNS 地址绑定、宿主 HTTP 逐跳复核与兼容语义 |
| `engine/utils/tvbox-cms.js` | JSON/XML 采集、首页完整封面 |
| `web/App.vue` / `web/WatchApp.vue` | 管理与公开观影 |
| `web/SourceWorkspace.vue` / `web/CodeEditor.vue` | 编辑工作区和 Monaco |
| `web/SourceImport.vue` / `web/WebPlayer.vue` | 导入窗口和播放器 |
| `scripts/check-shell.mjs` | 发行树零预置源断言（spider 逐文件白名单 + 全 engine 内容判定） |
| `scripts/check-bridges.mjs` | `engine/spider/**` 的 ast.parse / php -l / node --check |
| `scripts/container-smoke.mjs` / `container-matrix.mjs` | 空容器检查与原生 amd64 完整矩阵（本轮待执行） |

`engine/spider/` 只保留辅助模块、HIPY core/base、PHP 桥接/lib 和 WASM。`engine/json/`、`engine/jx/`、`engine/data/` 为空，config 是空默认值。第一次准备空运行目录；升级保留已有 data，不添加原站点。

## 4. 验证

```sh
npm ci
npm run check     # 语法 + 桥接语法 + 空壳发行
npm run build     # 必须先 build，集成测试需要 dist/index.html
TEST_PYTHON=python3 TEST_PHP=php npm test
```

当前实测门禁（2026-10-06，macOS arm64 / Node 22 / Python 3.12.14 / PHP 8.4.23）：

- `npm run check`：`122 文件语法` + `143 桥接文件语法` + 空壳通过（spider 37 个文件全部已登记；engine 共 156 个文件无站点规则/清单）
- `npm test`：**169 测试 = 120 后端 + 49 UI**，全绿；全部使用临时数据目录
- `npm audit`：4 项 = 1 runtime `node-forge`（上游无修复版本）+ 3 dev-only（vitest/tinypool/@vitest/mocker），见 `SECURITY.md`
- `npm run build`：通过

注意事项：

- 干净克隆必须先 `npm run build` 再 `npm test`；不能依赖被忽略的本机 `dist/`。CI 已按此顺序。
- Python 新建模板必须接受 HIPY 守护进程的 `t4_api` 构造参数；创建模板测试除语法检查外实际执行首页，容器验收也覆盖这条路径。
- 本机没有 Docker，**不能声称做过本机容器验收**；本轮 GitHub 原生 amd64 候选验收已通过，证据见第 7.12 节。
- 未运行原 drpy-node-coder CLI，不宣称使用过。协议样本不代表所有第三方站点、解析器或编码可播。
- 测试数量与文件数以脚本实际输出为准；`docs/DEVELOPMENT.md` 已移除固定计数，并由回归用例防止重新写入。

## 5. 发布现状

**当前发行（2026-10-06，本轮已完成）**：PR #1 已合并，源码发布提交 `c2a1f21f9be005e1855bd78b00613033791c0dbb`。源码 [Verify 37458591153](https://github.com/tardlk/CokeTV/actions/runs/37458591153)、[主线构建/验收/发布 37458591100](https://github.com/tardlk/CokeTV/actions/runs/37458591100) 与 [匿名固定 digest 发布后复验 37459488105](https://github.com/tardlk/CokeTV/actions/runs/37459488105) 均 success。`ghcr.io/tardlk/coketv:sha-c2a1f21` 与 `:latest` 同 digest：`sha256:c269b482eddaff2668a43773b82fcd98f23c89b90bd48542eb4a2a6b95c8d1a2`。匿名 manifest/config 与容器实跑确认 linux/amd64、User=node/UID 1000、OCI revision 为该源码 SHA；R1–R10 和媒体头修复均已包含。详细身份/产物/测试证据见第 7.13 节。下列首次发布与旧同步记录保留为历史，不表示当前 latest。

- 2026-10-05 首次发布：功能提交 `3b17276`，源码 [Verify 37252776598](https://github.com/tardlk/CokeTV/actions/runs/37252776598) 与 [Docker amd64 37252776569](https://github.com/tardlk/CokeTV/actions/runs/37252776569) 均成功。
- 历史镜像 `:sha-3b17276`，当时同 digest 发布为 `:latest`：`sha256:8e733b3cc506be4682015e9df004ba9b3705f31c058d9da263e28dbfa049461c`（匿名读取 manifest/config 确认 `linux/amd64`）。独立拉取验收：[Verify published image 37253476492](https://github.com/tardlk/CokeTV/actions/runs/37253476492)。这个 digest 只代表旧发布，不能据此断言当前 latest 的版本。
- **2026-10-06 历史源码同步**：用户明确授权推送。GitHub `main` 的代码快照为 `984ccf0ff2ed2d0f63c96f2f5b7b2098cba023d3`，Git tree 与本地整理后的 `da3ce44` 完全相同（`eed21e5c7d44212cec56f80ee0b2ba08cc3f708c`）；包括此前 9 个未推送提交、本轮限流修复和接手审查记录。原始本地 11 个提交保留在 `handoff-local-20261006`，本地 main 已跟随远端。收尾文档补记使用 `[skip ci]`，不重复发布相同代码。
- **历史 CI / 镜像状态（当时已核对）**：[Verify 37429832617](https://github.com/tardlk/CokeTV/actions/runs/37429832617) 与 [Docker amd64 37429832738](https://github.com/tardlk/CokeTV/actions/runs/37429832738) 均成功；后者的源码检查、发布前空容器验收、镜像发布三个步骤分别为 success。已发布 `ghcr.io/tardlk/coketv:sha-984ccf0` 与 `:latest`，两者 digest 相同：`sha256:8329ad339a36d81e6bfc7771104f0a9d106a8e08a210c5bbbbad9e8e255488f0`。匿名读取 manifest/config 确认 `linux/amd64`、`User=node`、revision 为 `984ccf0ff2ed2d0f63c96f2f5b7b2098cba023d3`。
- 上述历史 984ccf0 发布没有本机 Docker 或发布后五引擎/重启拉取复验，也未修复 R1–R10。本轮 c2a1f21 已通过完整发布前/后矩阵；本机仍无 Docker，两次容器结果均来自 GitHub 原生 amd64。
- 发布链路：Verify 工作流跑语法/空壳/测试/构建；Docker amd64 工作流在 main/tag 发布事件上做源码验证 → 原生 amd64 单次构建 → 完整临时容器矩阵 → artifact 保存/身份校验 → GHCR 发布；PR 和默认手动 dry-run 只读验收，使用仓库 `GITHUB_TOKEN` 的 packages 权限，不提交发布密钥。`latest` 对应 main，`sha-*` 固定提交，`v*` 发布版本。
- `compose.yaml` 用 GHCR 镜像并挂载 `./data:/app/data`，容器以非 root `node` 运行；挂载旧版本（root 属主）数据目录需先 `chown -R 1000:1000 data`（README 有命令）。
- `.github/workflows/image-verify.yml` + `scripts/image-verify.mjs` 可手动验证已发布镜像（五引擎、重启持久化、非 root 断言）；只在临时容器创建样本，不能用于正式数据目录。

## 6. 安全修复历史（两轮，原用例已验证）

本节保留两轮修复的历史实现与原验证范围，**不代表这些防护已经完整闭环**。2026-10-06 全面接手复核新增 10 项已复现缺口，见第 7.3 节；尤其要区别全新临时目录与挂载旧数据升级。

### 第一轮：审查发现的严重/高危问题

审查共列出 24 项，处置如下（编号沿用审查时的编号）：

| 编号 | 问题 | 处置 |
| --- | --- | --- |
| C1（严重） | `/admin/*` 鉴权守卫用 `request.url` 前缀判断，被百分号编码前缀与 absolute-form 请求行绕过 → **未授权 RCE** | 改为基于匹配路由 `request.routeOptions.url`；`/admin`（SPA）与 `/admin/access/setup` 保持公开。实测编码前缀、`/./` 前缀、absolute-form socket 全部 401，写接口不改状态文件 |
| C2（严重） | 播放票据只验存在不验范围 → 匿名 SSRF/开放代理 | 改为无状态 HMAC 票据绑定 `(kind, source, url, headers, exp)`；删除导致漏洞的路由白名单；调用方头不再被信任。实测票据不能挪用、换 `url` 参数 403，HLS 正向仍可播 |
| C3（高） | 源脚本无沙箱（JS 可 `require`、py/php 可访文件系统），所有源共用一个 worker | **产品决策：按已知信任边界处理**——README「安全边界」与 `SECURITY.md` 显著声明；容器改非 root 收敛后果。根治（每源独立进程）见第 7 节 |
| H1（高） | `/json/` 静态目录匿名可读（可能含 Cookie/Token） | 去掉静态挂载，改按鉴权的 `GET /json/*`（管理员 ∨ 订阅 Token ∨ 内部 `x-drpy-runtime`）；`engine/libs_drpy/req-extend.js` 回环自请求补内部凭据；新增 `jsonPublic`（**默认 false**） |
| H2（高） | 首装密码可被匿名抢占 | 一次性引导码，`/admin/access/setup` 必须携带；前端加「初始化码」输入 |
| H3（高） | 「零预置源」检查空转（0 个文件进断言）且发行树带站点定义 | 检查重写（见下 H3 条目）；删除 14 个站点残留文件 |
| H4（高） | 选集/切线路整页重载、播放器重建、丢自动播放 | 两个 watcher 改用原始值拼键；切集只走 `resolvePlay(true)`；UI 用例断言 `ac=detail` 0 次、`/play` 1 次、`autoplay===true`、DOM 节点未变 |
| M1（中） | 管理密码明文落盘 | scrypt 加盐（`{version:2,salt,hash}`）；旧明文格式**登录成功后**原子迁移；`ADMIN_PASSWORD` 路径不落盘明文 |
| M2（中） | 依赖 13 项漏洞（11 high） | 升级 Fastify 4→5.12、`@fastify/static` 7→10、`@fastify/multipart` 8→9、`@fastify/formbody` 7→8、`basic-ftp` 5→6、`puppeteer-core` 24→25；13 → 4（余 `node-forge` 无修复 + 3 dev-only） |
| M3（中） | 容器 root 运行 | `USER node` + `chown /app/data`；compose 加 `cap_drop: [ALL]`、`no-new-privileges`；CI 断言镜像 `Config.User` 非空；`image-verify.mjs` 运行时断言非 root |
| M4（中） | 内核代理链路零 SSRF 防护（`verifyAuth`/`isInternalIp` 是死函数） | 新增 `src/ssrf.js`，`streamMedia` 入口与每次重定向后复核；内网由 `allowPrivateTargets`（默认 true）控制、`targetAllowlist` 可选收紧；`/webdav/*`、`/ftp/*` 不再接受调用方 `config`。元数据永久拒绝是设计目标，映射 IPv6、DNS 与 `/http` 重定向存在实测绕过（R3/R4/R6） |
| M5（中） | 按源 ENV 隔离可绕过；`env.json` 权限倒挂 | `hipy.js`/`php.js` 缓存键补 `sourceInstanceId`；引擎 ENV 写入加 0600 + `wx` 锁；脱敏改为按值（含 URL 编码/JSON 转义）；`engine/utils/file.js` 边界改 `path.relative`。宿主保存全局 ENV 仍为 0644（R8），PHP 参数泄露也未被现有脱敏覆盖（R5） |
| M6（中） | 空壳裁剪使 jx/parse 与带 ext 的源不可用；`hipy.js` 未导入 `ungzip` | `ungzip` 改为显式导入；`parses.conf`/`map.txt` 为空属产品取舍，已在文档说明 |
| M7（中） | PHP 桥接关闭 TLS 校验 | 默认开启校验 + `MAXREDIRS` + `curl_errno` 记 stderr |
| M8（中） | Python 守护进程用无鉴权 `pickle` 协议 | `t4_daemon.py` 只收 JSON；lite 与 CLI 桥一并去 pickle（见第二轮） |
| M9（中） | PHP `display_errors` 污染 JSON、`proxy`/`localProxy` 命名漂移、py/php 读不到每源 ENV | `display_errors=0` + `ob_start` 收口；方法名映射改候选（见第二轮 P0-1）；ENV 仍仅 JS 引擎支持，已从文档口径收窄 |
| M10（中） | Python 守护进程死了不重启；SIGTERM 死锁；超时/包上限不一致 | 命中缓存前校验存活 + 退避重启；SIGTERM 从独立线程 `shutdown`；包上限统一 32MB；`INIT_TIMEOUT ≤ REQUEST_TIMEOUT`；action 超时与 `BRIDGE_TIMEOUT` 对齐 |
| L1–L11（低） | 无速率限制/安全头、`/health` 泄露内部信息、19 个引擎死代码文件、版权头保留率低、上游许可标注矛盾、文档计数漂移、CI action 未钉 SHA、测试顺序耦合、`fServer` 无 WebSocket、桥接零星缺陷 | 已修：安全响应头、公开接口限流、`/health` 精简、`check-bridges.mjs` 覆盖 engine 中的 `.cjs`、`X_OK` 判定、`spider.py` 编码名拼写、`SECURITY.md`/`THIRD_PARTY.md`。未修见第 7 节 |

### 第二轮：修复第一轮引入/遗漏的问题

- **P0-1 PHP `localProxy|proxy` 兼容性回归（中）**：`BaseSpider` 自身声明了 `localProxy()`（默认 404），而 `_bridge.php` 取"第一个 `method_exists` 为真"的候选 → 只实现 `proxy()` 的老源永远命中继承来的实现，宿主 `/proxy/<id>/` 返回 404。改为用 `ReflectionMethod::getDeclaringClass()` 排除 `BaseSpider` 的默认实现，`BaseSpider::proxy()` 别名保留。原用例覆盖 proxy-only 老源、localProxy-only、非 BaseSpider、别名回退、"两者都不实现"改**带参数**断言真实默认 404；实现仍未计算完整继承距离，不能称为任意继承树的最派生选择（R9），且旧数据升级未同步桥接（R1）。
- **P0-2 `toBytes=2` 丢源返回的 Cookie/Authorization（中）**：302 分支把调用方专用的 `safeProxyHeaders`（屏蔽 cookie/authorization/host）误用到**源返回**的头上。新增 `sanitizeSourceHeaders`（与 `playbackHeaders` 同口径，只屏蔽 host/x-drpy-runtime/connection/content-length + CRLF），调用方头仍走 `safeProxyHeaders`。同时新增 `unwrapMediaProxyContent`：识别旧基类 `proxy_media_url` 生成的 `/mediaProxy?url=<b64>&form=base64&stream=1&header=<b64>`，解出真实目标与头并**补签能力票据**（源无法自签票据，旧形式浏览器直接请求必 403）。用例见 `tests/proxy-headers.test.js`。
- **P0-3 `scryptSync` 落在未鉴权路径（中·DoS）**：`matchesPassword` 每次 `/admin/*` 请求同步跑 `scryptSync(N=16384)`，且 `/admin/` 不在限流集合内。改**异步 scrypt**（libuv 线程池），`isAdmin`/`guard` 及 `src/server.js` 全部 6 处调用点改 await（`serveMedia`、`authorize`、`authorizeService`、`authorizeProxy`、`subscriptionHandler`、`/json/*`）；`/admin/*` 纳入限流 + 鉴权失败按 IP 单独计数（`ADMIN_AUTH_FAIL_PER_MINUTE`，默认 20，只计 401）。实测 20 次并发错误密码 335→103ms、事件循环最大延迟 17→2ms、`/health` 17→0ms。
- **H3 检查器加固**：`check-shell.mjs` 遍历范围从 `engine/spider/**` 扩到**整个 `engine/`**（156 文件），新增站点清单标记 `"sites":[...]`，判定前剔除整行注释（避免把 `utils/python.js` 注释里的 `class Spider` 误报）。反例用例：`libs_drpy/sites.js`、`utils/sites.js`、`controllers/sites.js`、`config/sites.json` + 干净最小树正向用例。
- **其余**：`SECURITY.md` 依赖表改为实测 4 项 + 新增「限流与反代前提」；设置页新增「代理与参数安全」分组；`.env.example` 同步引导码与限流变量；`Fastify({routerOptions:{maxParamLength:4096}})` 消除 `[FSTDEP022]`；`t4_daemon_lite.py` 与 `core/bridge.py` 去 `pickle.loads`（收发统一 JSON，响应方向的 pickle 解码仅存在于实际使用的 `t4_daemon.py` + `pickleparser`）。

## 7. 当前状态与下一步待办

接手时 `main` 领先 `origin/main` 9 个提交的描述是历史快照。本轮限流修复的本地提交是 `a0882c2`，其内容现已同步到 GitHub 代码快照 `984ccf0`；本地 main 已跟随远端，原本地提交保留在交接分支。源码同步/镜像结果见第 5 节与第 7.4 节。**R1–R10 已修复并发布**，见第 7.5–7.8 节；第 7.1 节第 3 项媒体头兼容也已本地修复（第 7.10 节），第 4 项管理员锁出行为保持原产品约定；原生候选验收、main 合并、正式镜像发布及匿名发布后完整复验已完成（第 7.12–7.13 节）。当前发行见第 5 节，原检查点/旧分支保留；管理员锁出和第 7.2 节长期工作仍不变。

### 7.1 建议尽快修（影响已加上的防护或文档正确性）

本次接手逐条核对：接手时四项原待办均存在；现已完成第 1、2、3 项（第 3 项本地验证见 7.10），第 4 项维持现状并单独作产品决策。编号保持不变，便于对照原接手要求。

1. **限流豁免范围过大（中，已修）**：修复前 `probe15` 在 `RATE_LIMIT_PER_MINUTE=5` 下复现 `/watch/sources` 4×200 后 429；带匿名媒体票据的 `/proxy/<id>/` 12×200、0×429，后续又驱动 30 次引擎执行。原因是任何有效票据都豁免，而媒体票据在 `/proxy/:module/*` 只绑定源、不绑定 URL。
   - 当前仅 GET/HEAD 媒体转发路由（`/mediaProxy`、`/req/*`、`/m3u8-proxy/{playlist,ts,proxy}`、`/unified-proxy/proxy`、`/file-proxy/proxy`）中，票据有效且 `kind === 'proxy'`、目标 URL 与票据一致时豁免。`/proxy/:module/*` 及其他公开接口照常计入原 IP 桶，默认 1200/min；不变更媒体票据的源代理兼容权限。
   - 限流按匹配路由判断，避免百分号编码路径与 absolute-form 形态跳过计数。`SECURITY.md` 与 `docs/CONFIGURATION.md` 已纠正票据范围和豁免说明。
   - 修复后同一 `probe15`：带媒体票据的 `/proxy/` 12×429、0×200，后续引擎执行数为 0。
   - `tests/rate-limit.test.js` 修复前实际失败（期望 429，实际 200），修复后通过：预算内源代理返回正常；预算耗尽后拒绝且不执行引擎；编码/absolute-form 不能绕过；HLS 分片/key 高频 GET、HEAD、Range 与 base64 目标保持可用；票据换目标/挪到其他路由不豁免；源代理 `toBytes=2` 302 补签仍可匿名跟随。
2. **`docs/DEVELOPMENT.md` 计数陈旧（低，已修）**：接手时仍写 `114 项测试（66 后端、48 UI）、117 个文件语法检查`。已删除固定计数，指向 `npm test` / `npm run check` 实际输出及本文件第 4 节的验证记录。`tests/documentation.test.js` 在原文上实际失败，修订后通过，防止“当前验证”重新维护固定测试/语法文件计数。
3. **`/mediaProxy` 与 `/proxy` 的头处理不一致（本地已修）**：以下保留原复核证据；当前实现与新增失败/通过回归见第 7.10 节。审查时 `/proxy` 已能解包旧基类 `header`+`form=base64` 并补签票据，而直接请求 `/mediaProxy?url=…&header=<b64>` 仍只认 `headers`（复数 JSON），且只有订阅 Token 路径读调用方头，`admin`/内部运行时拿到的头恒为 `{}`。若源在服务端自行拼 `mediaProxyUrl` 就会丢头。建议把 `unwrapMediaProxyContent` 的解包逻辑复用到 `/mediaProxy`。本次在临时目录和固定 HTTP 上游复核：订阅 Token + `headers` JSON 的 Referer 可透传；订阅 Token + `header` base64、管理员 + `headers` JSON、内部运行时 + `headers` JSON 均丢失 Referer（四条请求均为 200）。该审查阶段未修改此行为；后续本地修复已完成。
4. **管理员锁出边界（提示）**：失败预算按 IP 20/min，耗尽后**同一 IP 即使给正确密码也 429**（已测试、已文档化）。`TRUST_PROXY=1` 且前置代理不覆写 `X-Forwarded-For` 时，可被伪造 IP 用来把管理员锁在 `/admin` 外（每 60 秒窗口需重新打满 20 次）。可选改进：只对失败计数、成功凭据始终放行。本次核对守卫仍在校验密码前检查失败预算；完整测试中的 `P0-3` 用例再次确认预算耗尽后正确密码也 429。本次未修改此行为。

本次限流修复阶段的实际验证（2026-10-06，收尾推送前的历史记录）：

- 新增两条回归在修复前实际失败：限流用例期望 429、实际 200；单跑 `node --test tests/documentation.test.js` 检出陈旧计数。修复后 `node --test tests/rate-limit.test.js tests/documentation.test.js` 2/2 通过。
- `node ../coketv-audit/probe15-ratelimit-exempt.mjs`：修复前后均运行，结果见第 1 项。
- `npm run check && npm run build && TEST_PYTHON=python3 TEST_PHP=php npm test`：全部通过；118 个宿主/辅助文件语法、143 个桥接文件语法、空壳发行检查、生产构建；124 项测试（75 后端 + 49 UI），无失败或跳过。五种引擎固定样本均通过。构建仍有大于 500 kB 的 chunk 提示。
- 未做 Docker/容器验收、外部站点播放、原 drpy-node-coder CLI 或新的 `npm audit`；未修改用户 `data/`，未 push、未发布或重建镜像。

### 7.2 长期未做（第一轮审查后列出，需要产品决策或专项排期）

- **每源独立进程 + 沙箱最小化**（C3 的根治）：当前 `src/runner.js` 只 fork 一个 worker，所有源共享进程与 `cwd`；源脚本能读到 `DRPY_INTERNAL_KEY` 并用 `x-drpy-runtime` 让 `authorize()` 放行（已实测），也能读 `data/state.json` 与其他源 ENV。按 `AGENTS.md` 这属于**已知信任边界**，但若要支持"导入不可信源"，必须做进程隔离并删掉沙箱里的 `require`/`JSFile`/全量 `process.env`。
- **供应链**：`.github/workflows/*.yml` 的 `uses:` 全部是浮动 tag，未钉 commit SHA；`engine/spider/py/base/requirements.txt` 无版本约束与 hash；基础镜像 `node:22-trixie-slim` 未钉 digest。
- **发布门强度**：五引擎固定样本、订阅边界、重启持久化在**发布后**的手动 `image-verify.yml` 里跑，建议移入 `docker.yml` 的发布前门。2026-10-06 复核 `scripts/image-verify.mjs`：播放只断言返回媒体地址，未请求该地址，**没有容器 Range/HLS 验收**；目前 Range/HLS 仅由宿主固定上游测试覆盖，需另补容器真实转发。发布前 `container-smoke.mjs` 覆盖新建 JS/Python/PHP 模板执行，不能代替五引擎与旧数据升级矩阵。
- **引擎死代码**：约 19 个文件在任何模块说明符处零引用（`utils/` 下 `esm-loader.mjs`、`chunk.js`、`sourceVerify.js`、`rule-env.js`、`phpEnv.js`、`with-timeout.js`、`python.js`、`message_sender.js`、`imageManager.js`、`filePolicy.js`、`pathGuard.js`、`daemonManager.js`、`api_helper.js`、`api_validate.js`、`changelogParser.js`、`pluginMethodManager.js`、`marked.min.js`、`admin/logReader.js`，加 `libs/xbpq.js`）。注意 `with-timeout.js` 是 CokeTV 自己加的"Promise.race 输家 unhandledRejection"修复，但零调用，而 `libs/php.js` 的注释仍声称在用——**修复没接线**。每次启动这些文件都会被全量拷进 `data/runtime/`（`src/store.js`）。要么清理，要么在 `docs/THIRD_PARTY.md` 说明是"保留上游 API 面"。
- **`fServer` 兼容缺口**：`src/worker.js` 注入的 `fServer` 是只回 404 的裸 `http.createServer`，而 `src/server.js` 把 WebSocket upgrade 转发到同一端口；上游 drpy-node 里 `fServer` 是带 websocket 的 Fastify 实例。依赖弹幕 WS 的源不可用。
- **测试隔离与覆盖**：`tests/integration.test.js` 多用例共享同一 `app/store`，`tests/tvbox-import.test.js` 存在先后用例依赖；本轮未运行随机顺序或逐条隔离矩阵，不把“单跑必失败”作为新实测结论。仍需专项覆盖 `/parse/:jx` 的 parse type=2、`/ftp/*`、`/image/upload`、`/admin/subscriptions/:id/token`、ZIP 恶意包和 `state.json`/`env.json` 损坏拒绝覆盖。旧记录把 `/file-proxy` 与 `bytes===2` 重定向列为零覆盖已经过时：当前 `rate-limit.test.js` / `proxy-headers.test.js` 已覆盖对应固定样本。

### 7.3 全面接手复核（2026-10-06，新增发现与修复进度）

用户要求对照原始仓库判断其他 AI 修改是否正确。本次以 GitHub `tardlk/CokeTV` 的远端 `main`（只读 `git ls-remote` 确认为 `ae89c27570537c8931f0747a3c2185880a6b94e3`）为基线，核对本地 `HEAD=544a618` 之后的工作区及领先远端的 9 个提交。审阅管理/订阅/媒体鉴权、票据与限流、出口策略、Store 升级与私密配置、五种引擎桥接、导入、前端变更、Docker 和三个工作流，以及测试断言与旧版实现。

结论：管理鉴权改用匹配路由、异步 scrypt、票据防篡改和 URL 绑定、源返回头透传、Python JSON 协议、空壳检查的方向正确；**现有测试全绿不能证明升级兼容或安全修复全部完成**。以下编号 R1–R10 均有独立临时样本复现；既有新增回归，也有原问题或新增防护没有闭环，不能全部归因于本轮改动。表中问题定位与证据保留审查时快照；R1–R10 的本地修复状态与新增回归见最后一列及第 7.5–7.8 节；第 7.1 节保留项、长期工作及容器验收另计。

| 编号 / 优先级 | 问题与定位 | 实测证据 / 来源 | 修复与回归要求 |
| --- | --- | --- | --- |
| **R1 / P1（本地已修）** | 旧数据升级不会更新框架桥接：`src/store.js:30` 仅在目录不存在时复制 `runtime/spider`，但会刷新 `libs`；新版 PHP 调用 `localProxy\|proxy`，旧桥接不认识候选名，Python 安全更新也未落到运行副本 | `probe17`：全新目录 PHP 代理 200；放入远端旧桥接后重启当前宿主，代理 500，运行副本仍含 `pickle.loads(payload)`；实例状态、用户脚本和每源 ENV 保留。旧复制策略与新版协议组合形成升级回归 | 已按 `src/runtime-files.js` 的框架保留路径逐文件原子更新桥接/基类/辅助库。`tests/runtime-upgrade.test.js` 从 ae89c27 冻结桥接升级，PHP 代理 500→200，Python 接受 JSON 并拒绝无害 pickle 入站，五引擎执行和用户文件/状态保留通过 |
| **R2 / P1（本地已修）** | 匿名票据泄露上游凭据：`src/playback.js:33–36` 用 base64url 明文 JSON 加 HMAC，载荷包含源返回的 `headers` | `probe16`：匿名 `/play` 返回的票据可直接解码出源从 ENV 取得的 Cookie 和源返回的 Authorization。HMAC 保证完整性，不提供保密性；远端旧版随机票据没有该载荷，属于新增回归 | 已改为 256 位随机、43 字符的服务端能力引用，保留 kind/source/URL/headers/expiry 约束；最长 12 小时、50000 条/64 MiB 载荷容量，淘汰最旧记录。新增回归覆盖匿名播放与 HLS 票据不可解码凭据，实际上游 Cookie/Authorization 透传、范围、篡改、过期、容量回收 |
| **R3 / P1（本地已修）** | IPv4 映射 IPv6 绕过内网与元数据判定：`src/ssrf.js:19–24,58` 未把规范化的十六进制 IPv4 尾部转换成 IPv4；元数据仅按文本比对 | `probe16`：关闭内网时普通回环媒体 403，`[::ffff:127.0.0.1]` 媒体 200 并取得自建临时上游内容。映射元数据地址通过守卫，而普通元数据地址 403；**未向真实元数据服务发请求**。新增防护不完整 | 已按 IP 字节统一分类，将点分/十六进制映射 IPv6 归为 IPv4。回归覆盖直接地址、展开形式、DNS、白名单、本机 origin 豁免与重定向；内网关闭后的映射回环媒体 200→403，映射元数据永久拒绝，不访问真实元数据服务 |
| **R4 / P1（本地已修）** | DNS 检查与连接分离：`src/ssrf.js:55,65` 返回解析地址，`src/media.js:46,53` 丢弃结果并让 HTTP 客户端再解析 | `probe16`：受控模拟守卫解析返回公网地址、实际连接解析为回环，关闭内网后仍取得临时上游 200。**这是模拟两次 DNS 答案不同，并非真实外部 DNS rebinding 攻击测试**。新增防护不完整 | 已通过 `pinnedLookup` 将媒体与 `/http` 每跳的新连接绑定到受检地址，IP/CIDR 名单只返回匹配地址。受控两次 DNS 样本的未经检查回环连接数 1→0；实际 Host/TLS SNI、证书验证、IP+Host 虚拟主机、Range/HEAD/HLS 和环境代理对照通过 |
| **R5 / P1（本地已修）** | PHP 失败向匿名用户泄露源参数：`engine/libs/php.js:62–67,99–101` 原样抛出带完整命令参数的 execFile 错误，`src/server.js:48–50` 原样发送；现有 ENV 脱敏未覆盖 params | `probe18`：普通 PHP 首页抛异常，匿名首页返回 500，响应包含固定样本的私有 params 和 sourceEnvPath。远端已有该错误链，属于旧风险未闭环 | 已解析桥接 stdout 错误信封，不上抛/记录原始 execFile Error。接口固定 `PHP 源执行失败`；管理诊断保留原因/方法，遮蔽原始/JSON/URL 参数、嵌套/短值/数字 ENV 与私密路径。普通异常、初始化、解释器/非 JSON 失败、Warning、lastCheck 与后续正常源通过回归 |
| **R6 / P2（本地已修）** | `/http` 只检查首跳：`src/server.js:601–607` 之后由 axios 自动跟随重定向，无出口复核 | `probe19`：白名单只含临时上游的域名，直接请求未列入名单的回环 IP 403；域名 302 到同一上游的 IP 后 `/http` 返回 200，而 `/mediaProxy` 同类重定向 403。需管理、内部或订阅凭据，**并非匿名 `/http` 绕过**；实际 POST 携媒体票据仍为 403。新增防护不完整 | 已用 `guardedHttp` 手动逐跳检查/绑定 DNS，默认最多 21 次、允许设置 0–21，0 返回首跳；禁止环境代理重新解析。固定上游回归首跳域名允许、跳转 IP 被拒 200→403，同域 DNS 新元数据答案也在连接前拒绝；方法/请求体/头/参数/响应与原 Axios 语义对照通过 |
| **R7 / P2（本地已修）** | 长播放地址变成不可访问的媒体票据：`src/playback.js:35,51` 把整个 URL/headers 放入路径，`src/server.js:44` 路由参数最大 4096 | `probe16`：合法固定媒体 URL 仅附 4000 字符签名参数，播放解析 200，票据长度 5640，随后媒体请求 414；短地址对照 200。旧随机短票据不受此影响，属于新增回归 | 已与 R2 一并改为短引用，不截短 URL/头、不提高路由参数限制。新增回归实际跟随带 4000 字符签名参数的媒体 URL，Range 414→206，HEAD 200，完整上游 URL 保留 |
| **R8 / P2（本地已修）** | 全局 ENV 的 0600 没覆盖宿主保存：`src/store.js:56–59,72–74` 原子写入临时文件未指定权限 | `probe18`：当前机器 umask 下全新全局 ENV 为 0644；先设为 0600，再调用宿主 `syncEnvironment()` 又变回 0644。旧宿主写法仍在，历史 M5 仅覆盖引擎写入路径 | `Store.atomic` 支持创建模式；全局/每源 ENV、state、插件配置和管理凭据保存显式 0600，从临时文件创建起生效。首次、设置/导入、反复替换、重启及引擎全局/每源 ENV.set/delete 回归通过，旧全局 ENV 0644 在宿主同步后为 0600 |
| **R9 / P2（本地已修）** | PHP 方法选择并非完整的“最派生”：`engine/spider/php/_bridge.php:83–93` 仅排除 BaseSpider，遇到第一个非 BaseSpider 候选就停止 | `probe18`：中间父类声明 localProxy（404），Spider 自己重写 proxy（200）；当前选择父类并返回 404。远端直调 proxy 可命中子类，属于新增兼容回归 | 已比较完整继承链中声明类到 Spider 的距离，最近优先，同层按候选顺序。多层父类/子类、无 BaseSpider、trait、同层倒序、纯继承默认 404 与宿主源代理回归通过；原 404→200，显式单方法调用和既有别名行为保留 |
| **R10 / P2（本地已修）** | 哈希凭据升级后 CLI 验证失效：`scripts/verify.mjs:8–9` 仍读取 `admin.json.password`，v2 格式没有这个字段 | `probe20`：临时 GUI 设密后，按文档运行实际 verify CLI（无 ADMIN_PASSWORD）退出 1；同一 CLI 显式提供正确密码，首页/分类/详情通过。哈希迁移带来的新增兼容回归 | 已移除客户端读取 admin.json，支持隐藏终端输入、环境 ADMIN_PASSWORD 和优先的 --password-stdin。实际 CLI 在 GUI v2、无本地文件的远端访问、旧凭据迁移后均完成首页/分类/详情；无凭据/空输入先失败不发请求，错误密码被拒，真实终端不回显且取消后恢复模式 |

本轮审查阶段的验证事实与边界（收尾提交/推送前的历史记录）：

- 第 7.1 节第 1、2 项的修复与两条回归保留；第 3、4 项仍在，R1–R10 此轮只复现和登记，**未修复**。
- `probe16` 至 `probe20` 均实际执行；全部使用临时数据目录与固定脚本，本地网络只访问自建临时 HTTP 上游，没有使用正式用户 `data/`。
- 新执行 `npm audit --json`：仍为 4 个包（1 high / 1 moderate / 2 critical），runtime 仅 node-forge 且 fixAvailable=false，另外 3 包标记 dev；没有擅自升级依赖。
- 历史 `probe7` 是打印式探测，退出 0 不能作为所有检查通过的证据；其中标为“POST /http”的 helper 实际发 GET，404 不证明 POST 被拒，现已由 `probe19` 对实际 POST 验证。它的 example.invalid 媒体 403 也不能当正常媒体对照；HLS 实际分片 200 与篡改票据 403 的结果仍有效。
- 本轮重新执行 `npm run check && npm run build && TEST_PYTHON=python3 TEST_PHP=php npm test`，退出 0：118 个宿主/辅助文件语法、143 个桥接文件语法、空壳检查、生产构建通过；75 后端 + 49 UI = 124 项全部通过，0 跳过，五引擎固定样本通过。构建仍有大于 500 kB 的 chunk 提示。这批独立探测尚未成为仓库内回归，不增加测试计数，也没有删除、放宽或跳过既有断言。
- 本轮未做 Docker、真实站点播放、浏览器端真实音视频播放或原 drpy-node-coder CLI。未 commit、push、发布、重建镜像或修改远端；实际执行的是本仓库的 verify CLI，二者不能混称。

当前 R1–R10 已在本地修复。后续第 7.1 节第 3 项媒体请求头一致性已在本地完成，见第 7.10 节；第 4 项管理员锁出行为维持原约定。发布前另做容器旧数据升级、真实媒体转发与重启持久化验收，再执行发布门禁。后续仍先补能失败的回归再修，保留五引擎和源协议。

### 7.4 上次会话收尾与新对话入口（2026-10-06，历史记录）

- **用户最新要求**：整理仓库与文档、推送 GitHub，然后换对话；已明确授权推送，且已说明 main 推送会触发 Docker 工作流发布 latest。本轮没有扩大范围去修 R1–R10。
- **本轮实际改动**：本地提交 `a0882c2`（已包含于 GitHub `984ccf0`）收紧票据限流豁免，新增 `tests/rate-limit.test.js` / `tests/documentation.test.js`；README、配置、开发、安全策略同步真实边界和验证口径。本文件集中登记审查发现，未另建接手报告；`verify` 文档新增显式密码的临时用法，R10 的 CLI 实现仍待修。
- **收尾门禁**：再次运行 `npm run check && npm run build && TEST_PYTHON=python3 TEST_PHP=php npm test`，退出 0，118 宿主/辅助语法文件、143 桥接语法文件、空壳检查、生产构建通过；124 项 = 75 后端 + 49 UI，0 跳过。仅保留构建 chunk 大小提示。未做本机 Docker 或新增外部站点播放验证。
- **当前测试服务**：本机 `http://127.0.0.1:54058` 保持运行，首页、后台、健康接口实际返回 200；使用独立临时 DATA_DIR，未启动或改写仓库正式用户 data。测试数据保留，不要为清理仓库而删掉。仓库外 `../coketv-audit/preview-session.json` 记录 PID 与测试数据位置，不含密码或初始化码；换对话后先确认进程是否仍在，避免重复启动或覆盖测试数据。该记录与全部探测脚本都不提交。
- **提交/推送状态**：源码和接手文档已同步到 GitHub，本地 main 已与远端一致；原本地提交保留在 `handoff-local-20261006`。本机 Git HTTPS 没有登录凭据、也没有现成 SSH 身份，本次使用已登录且有仓库写权限的 GitHub 连接追加快照提交，未强推或覆盖原远端历史；以 Git tree 相等核对全部文件内容和权限。下一轮推送需使用该连接或先配置正常 Git 登录，不能因为认证失败强制改写远端。CI/镜像发布已成功并回填 digest，详见第 5 节；本次收尾纯文档补记标记 `[skip ci]`，这不用于跳过代码变更的验证。
- **新对话按顺序读**：AGENTS → 本文件 → 需要改代码时读正式开发/配置/安全文档。先读取第 7.1 节保留项及第 7.3 节 R1–R10，再结合第 8 节的本机探测脚本继续；当时建议优先 R1、R2/R7；本次已完成这组本地修复，当前状态见第 7.5 节。后续仍保持五引擎和原源协议，先建立能失败的回归再修。

### 7.5 第一组本地接手修复（2026-10-06，R1、R2/R7，保留验收记录）

- **接手基线**：干净克隆 `main`，HEAD 为 `75748f1`，按 AGENTS → 本文件 → 正式文档的顺序阅读。当前修改仅在本地工作区，未 commit、push、发布或重建镜像；第 5 节远端发布记录仍指向此前代码。
- **先失败再修复**：新增 7 条回归。修复前专项运行共 15 项，9 通过、6 失败、0 跳过；旧 PHP 桥接代理期望 200 实际 500，旧 Python 桥接接受 pickle，匿名票据可解码凭据，长播放媒体请求期望 206 实际 414，短引用/容量断言也失败。Python 初次尝试系统 3.9 不支持桥接类型注解，随后改用真实 Python 3.12 重跑并确认是协议断言失败。保留既有断言，没有放宽状态码或跳过测试。
- **R1 实现**：`src/runtime-files.js` 明确登记 spider 框架保留路径，`Store.init()` 每次启动逐文件原子更新；空壳检查共用同一清单。配置目录及清单以外的用户源、辅助文件、缓存、JSON、解析、每源 ENV、订阅与历史保留。`tests/fixtures/legacy-runtime/` 原样冻结 ae89c27 的 PHP/Python 桥接，不依赖网络或 Git 历史、不进入 Docker 上下文。
- **R1 验收**：旧目录升级后的 PHP proxy-only 代理返回 200；Python 实际运行副本的 `recv_packet` 接受 JSON、拒绝无害 pickle 字典。五引擎首页/参数化分类通过；用户源、辅助文件、ENV、状态、订阅 Token/顺序、配置、管理凭据与历史逐字节保留，再次重启仍保留。完整既有五引擎协议矩阵也通过。
- **R2/R7 实现**：媒体与代理票据都是 256 位随机、固定 43 字符的服务端引用，URL/头/范围/expiry 仅留在内存；输入与读取结果不影响已签发范围。最长 12 小时、最多 50000 条与 64 MiB 载荷；签发时清过期、容量不足时淘汰最旧，读取不续期，单条载荷超过总容量返回 503，不截短 URL/头。重启、过期或淘汰后需重新选择剧集。保留 `media` 的所属源代理权限、`proxy` 的 URL 约束，以及此前限流范围。
- **R2/R7 验收**：匿名响应、媒体与 HLS 分片/key 票据不能解码出源 ENV 的 Cookie/Authorization；实际媒体、分片和 key 上游仍收到原凭据。换 URL 被拒绝，篡改/过期/跨会话/跨源/跨路由均不扩大权限；条数及字节容量回收通过。带 4000 字符签名参数和 5000 字符请求头的媒体地址实际 Range 返回 206、HEAD 返回 200，完整目标地址和请求头保留。旧基类 `header` base64 解包、源代理 `toBytes=2/3` 和 HLS 限流兼容回归保持通过。
- **本机环境与完整门禁**：Node 22.23.3、Python 3.12.14、PHP 8.4.23，运行工具/虚拟环境均忽略。`npm run check`、`npm run build`、指定真实解释器的 `npm test` 全部退出 0：119 宿主/辅助语法文件、143 桥接语法文件、spider 37/engine 156 空壳检查；82 后端 + 49 UI = 131 项全部通过、0 跳过。专项修复后 15/15 通过；随后增强长请求头断言，临时还原原票据实现时仍实际复现凭据泄露和 414，再恢复修复并跑完整门禁。构建仍保留大于 500 kB 的 chunk 提示。
- **边界与下一步**：仅使用临时数据目录、自建 HTTP 上游和固定脚本，未改正式用户 data。未做 Docker、容器旧数据升级/媒体转发、真实站点播放、浏览器音视频或原 drpy-node-coder CLI；本次没有执行独立 `npm audit`（npm ci 输出仍为 4 项）。R3/R4/R5/R6/R8/R9/R10 及第 7.1 节第 3、4 项继续待修，下一组建议 R3/R4/R6。发布前仍需容器旧数据升级与真实媒体转发验收。

### 7.6 第二组本地修复（2026-10-06，R3/R4/R6，保留验收记录）

- **先失败再修复**：新增 `tests/ssrf.test.js` / `tests/outbound.test.js` 共 14 条，原实现上实际运行 1 通过、13 失败、0 跳过。关闭内网后映射回环媒体仍 200；映射元数据守卫未拒绝；媒体与 `/http` 的受控第二次 DNS 回环答案都被连接（上游收到 1 次）；允许域名跳转白名单外 IP 的 `/http` 返回 200。同域重定向的新 DNS 元数据答案与环境代理也有失败对照。所有样本使用临时目录和本地上游；模拟受检公网答案的实际拨号在测试中截断，不访问公网或真实元数据服务。
- **R3 实现**：`src/ssrf.js` 将合法 IP 转为字节，IPv4 映射 IPv6 统一按 IPv4 判定。IPv6 压缩/展开、十六进制尾部、DNS 回答、IPv4/IPv6 CIDR 与元数据归一判定；元数据检查在内网开关、白名单与本机 origin 豁免之前。空/无效 DNS 回答拒绝，关闭内网时混合答案整体拒绝；IP/CIDR 名单过滤返回地址，不能因某个答案匹配而连接另一个答案。
- **R4 实现**：新增 `src/outbound.js` 的 `pinnedLookup`，实现 Node lookup 的单地址与 all/双栈回调，连接不再重新解析。媒体每跳使用受检结果和新 socket，`/http` 每跳使用独立 Agent，保留 URL/Host/SNI/TLS 验证。TLS 回归覆盖真实临时证书成功和域名不匹配失败；另发现强制 SNI 会破坏 IP+Host 虚拟主机源（500），已增强断言并保留 Node 原有 SNI 推导，修复后 200，不关闭证书校验。
- **R6 实现**：宿主 `/http` 改为手动逐跳 await 守卫，再绑定地址请求，保留 Axios 参数序列化与响应解析、`{status, headers, data}` 返回格式。默认上限 21 次，`maxRedirects` 允许 0–21，0 返回首跳；整条请求使用同一超时预算。301/302 的 POST、303 的非 GET/HEAD 转为 GET 并移除请求体/相关头；307/308 保留方法与体。重定向移除自定义 Host、更换主机/降级移除 Cookie/Authorization 等，沿用原 Axios 同端口子域保留规则。宿主 `/http` 设置 proxy=false，不允许环境代理二次解析目标。
- **专项验收**：14/14 通过。映射回环媒体在关闭内网时 403；白名单外的映射重定向被拒；受控第二次 DNS 连接数为 0，仍保持 Host、Range、HEAD、HLS 分片/key。`/http` 允许域名跳转禁止 IP 返回 403，禁止目标没收到请求；同域新元数据答案连接前拒绝。无凭据或媒体票据的 `/http` 仍 403。方法/体/头/参数/JSON、text、arraybuffer、零次/超限跳转、跨域敏感头移除、同端口子域保留和环境代理对照通过。
- **完整门禁**：Node 22.23.3、Python 3.12.14、PHP 8.4.23；`npm run check`、`npm run build`、指定真实解释器的 `npm test` 全部退出 0：120 宿主/辅助语法文件、143 桥接文件、spider 37/engine 156 空壳检查；96 后端 + 49 UI = 145 项通过，0 跳过。五引擎、第一组升级/票据、源代理 `toBytes=2/3`、旧媒体头协议与限流回归保留；构建仍有大于 500 kB chunk 提示。
- **范围与下一步**：没有修改用户 data；未 commit、push、发布、重建镜像或做 Docker/真实站点/浏览器音视频/drpy-node-coder CLI 验收，未新跑 npm audit。源脚本仍同权限执行，宿主出口修复不改变该信任边界。当前 R5/R8/R9/R10 及第 7.1 节第 3、4 项待修；先做 R5/R8，再做 R9/R10，仍先失败回归再修。发布前仍需容器旧数据升级与媒体转发验收。

### 7.7 第三组本地修复（2026-10-06，R5/R8，保留验收记录）

- **先失败再修复**：新增 `tests/private-data.test.js` 六条，修改前实际六条全部失败、0 跳过：普通 PHP 首页匿名响应含 URL 编码的私有 params，诊断泄露原始参数，初始化异常含完整 execFile 命令；全局 ENV 首次/设置保存/引擎写后宿主同步的 mode 为 0644（420），期望 0600（384）。新增 `tests/source-env.test.js` 一条辅助回归，逐步检出 JSON 数字参数、被覆盖的全局值、短/数字 ENV、异常 Unicode 和固定提示被同名参数改写的问题，均先失败再修复。
- **R5 实现**：`engine/libs/php.js` 在 execFile exit(1) 时解析 stdout 的 `{error, traceback}`；不再日志/上抛包含 cmd/argv 的原始 Error，成功协议结果和超时预算保留。普通调用、初始化、缺失解释器和非 JSON 进程失败统一返回 `PHP 源执行失败`；诊断记录异常原因/方法、经脱敏的 stderr/trace。worker 对该固定错误保持常量，不因参数恰好包含“失败”等词改变公开提示。源模块加载日志只显示文件名。
- **R5 脱敏**：worker 源上下文增加 params 与私密路径；`redactSourceSecrets` 递归收集原始参数、JSON 子值/数字/布尔值、全局与本源 ENV（含嵌套、短值和被覆盖的全局值），遮蔽原文、JSON 转义与 URL 编码/表单空格形态；运行路径及 realpath 别名一并隐藏。两个 ENV 文件独立读取，损坏一个不禁用另一个的遮蔽；孤立 UTF-16 surrogate 不导致日志 URIError。诊断仍仅管理员可读，源主动返回的业务数据与同权限执行边界保持原约定。
- **R5 验收**：普通 PHP 首页抛错的匿名 500 仅含固定安全提示；原始/编码 params、ENV 值、sourceEnvPath、运行目录和解释器命令均不在响应与诊断中。Warning/异常诊断保留 `fixture business error` 和方法，私密部分显示 `[已隐藏]`。admin verify 的 lastCheck 只保存安全错误；未鉴权日志 401；异常后正常 PHP 源仍执行成功。初始化、缺失解释器、使用 Node 触发非 JSON 进程失败均返回固定提示。
- **R8 实现**：`Store.atomic(file, content, {mode})` 在创建随机临时文件时指定权限（wx），然后原子替换。全局/每源 ENV、state.json、插件配置和管理凭据的宿主保存均传 0600；普通框架/脚本写入仍用原默认权限。现有引擎全局/本源 ENV 的 0600 写入保留，宿主后续同步不再倒退为 0644；后置 chmod 的兼容调用仍保留，但实际保密权限不依赖它。
- **R8 验收**：在 umask 000/022 下观察替换前临时文件和目标，私密文件均 0600。覆盖首次创建、旧全局 ENV 人为改为 0644 后同步、反复保存与 Store 重启、GUI 设置/每源 ENV、配置导入、管理凭据保存；值保留。真实 JS 源本源 ENV.set/delete 和独立临时 runtime 中全局 ENV.set/delete 后，宿主同步/重启仍保持值和 0600，没有写发行 engine/config 或正式 data。
- **完整门禁**：专项 `private-data + source-env` 8/8 通过（7 条新增 + 1 条既有）。Node 22.23.3、Python 3.12.14、PHP 8.4.23；`npm run check`、`npm run build`、指定真实解释器的 `npm test` 全部退出 0：120 宿主/辅助语法、143 桥接语法、spider 37/engine 156 空壳检查；103 后端 + 49 UI = 152 项全部通过，0 跳过。五引擎和前两组升级/票据/出口回归保留，构建仍有大于 500 kB chunk 提示。
- **范围与下一步**：仅临时数据和固定脚本，未修改用户 data；未 commit、push、发布、重建镜像、做 Docker/外部站点/浏览器音视频/drpy-node-coder CLI 或新 npm audit。下一组仅剩 R9/R10；第 7.1 节第 3、4 项另计。发布前仍需容器旧数据升级与真实媒体/重启持久化验收。

### 7.8 第四组本地修复（2026-10-06，R9/R10）

- **先失败再修复**：`tests/bridge.test.js` 新增两条，`tests/verify-cli.test.js` 新增四条；正式修复前专项 10 项中既有四项通过、新增六项全部失败、0 跳过。PHP 多层继承返回父类 404，宿主代理期望 200 实际 404；GUI v2 的 stdin CLI 退出 1；stdin 未覆盖错误环境凭据；无非交互凭据时旧 CLI 自动使用本地明文（退出 0 并执行源）；旧格式迁移后第二次 CLI 失败。后续新增真实伪终端回归，临时还原原 verify 时没有密码提示、实际失败，再恢复修复；还检出在终端直接使用 --password-stdin 没有隐藏提示会挂起，修复后终端也使用隐藏输入。
- **R9 实现**：`engine/spider/php/_bridge.php` 遍历 Spider 完整父类链，比较候选方法声明类的继承距离；最近声明优先，相等时保持候选原顺序，删除只排除 BaseSpider 的特例。方法名/参数/自动 init 与返回协议不变，单方法调用保持直接调用。
- **R9 验收**：桥接矩阵覆盖祖先 localProxy/子类 proxy、无 BaseSpider 多层继承、父类 proxy/子类 localProxy、父类同层实现、纯继承 BaseSpider 默认 404、trait、同层候选倒序；宿主实际代理由 404 变为 200。既有 proxy-only/localProxy-only、别名、未实现方法与默认 404 回归保留，R1 启动更新桥接仍通过。
- **R10 实现**：verify CLI 不再读取 admin.json 或 DATA_DIR，不恢复/保存明文或逆推哈希。终端不回显输入；非交互支持 `ADMIN_PASSWORD` 或 `--password-stdin`（显式 stdin 优先）。管道 stdin 到 EOF，只移除一个尾部 LF/CRLF，首尾空格/Unicode/冒号保留；终端直接使用 --password-stdin 也走隐藏提示，交互可退格、Ctrl-C/Ctrl-D 取消并恢复终端模式，输入上限 4096 UTF-8 字节。缺少凭据/空密码在发送请求前失败。源 ID、可选服务地址、Basic 鉴权及首页/分类/详情诊断协议保留，增加 --help；正式开发/安全说明同步。
- **R10 验收**：实际执行仓库 verify CLI，GUI v2 哈希下 stdin 成功、凭据文件字节与 0600 保持；没有本地 admin.json 的服务访问成功；stdin 覆盖错误环境密码。无凭据不会使用诱饵明文文件，空输入不发请求；错误密码仅触发一次鉴权、未启动源。旧明文成功登录后服务端迁移 v2，再次 CLI 成功且不恢复明文。Python pty 驱动真实终端验证默认和 --password-stdin 两种模式的 Unicode/首尾空格/冒号/退格登录、不回显密码或 Basic 凭据、取消退出 130、不发 API 请求、ECHO/ICANON 恢复；只用临时目录与固定凭据。
- **完整门禁**：新增共七条回归，最终 `npm run check`、`npm run build`、指定真实 Python/PHP 的 `npm test` 全部退出 0；120 宿主/辅助语法、143 桥接语法、spider 37/engine 156 空壳检查；110 后端 + 49 UI = 159 项全部通过，0 跳过。五引擎及前三组回归保留；构建仍有大于 500 kB chunk 提示。测试环境仍为 Node 22.23.3、Python 3.12.14、PHP 8.4.23。
- **当前状态与范围**：R1–R10 全部在本地修复；没有修改用户 data，未 commit、push、发布或重建镜像；未做 Docker/真实站点/浏览器音视频/原 drpy-node-coder CLI，也未新跑 npm audit。第 7.1 节第 3、4 项和第 7.2 节长期工作保留；容器旧数据升级、真实媒体转发与重启持久化仍须验收，不能把本机源码全绿视为镜像验收完成。

### 7.9 后续执行计划（2026-10-06，阶段 0–4 已执行，记录见 7.10–7.13）

以下保留制定时的计划；实际执行状态见第 7.10 节，不能把配置准备当作容器验收完成。制定时基线为 R1–R10 本地修复、159 项测试通过，尚未 commit/push/发布。本机实际检查没有 Docker CLI，因此容器验收使用 GitHub 原生 linux/amd64 runner，不能以本机源码测试替代。顺序为保存基线 → 请求头兼容 → 候选镜像与发布前门禁 → 容器矩阵 → 审查提交与发布 → 发布后复验。

**阶段 0：保存和审查基线**

- 建立工作分支与可恢复的本地检查点，检查待提交清单及 gitignore/dockerignore。运行 data、工具/虚拟环境、日志、私密 HANDOFF 和手动探针均不进入提交或构建上下文。
- 保留已有失败/通过证据与正式交接；核对五引擎、空壳发行、公开/管理/订阅权限和源同权限信任边界。后续源码改动继续先失败回归再修。
- 完成标准：当前修复可恢复、差异可审查，工作清单与本地验证基线清楚。

**阶段 1：修媒体请求头协议一致性**

- 目标文件：src/server.js 的媒体参数解包、authorizeProxy、/mediaProxy、/proxy 和播放结果处理；优先复用一个纯解包函数。对照 tests/proxy-headers.test.js、playback.test.js、security.test.js、rate-limit.test.js 增加固定本地上游回归。
- 解析覆盖 headers 的 JSON、旧 header 的 base64 JSON、明文/base64 URL、UTF-8/URL 编码，以及两字段同时出现时的明确优先级（headers 优先）。非法 JSON/base64、数组/标量、换行和非法头名的处理必须明确，不静默丢掉合法头。
- 权限矩阵：订阅调用方继续使用受限头策略；管理员/内部运行时恢复显式媒体业务头，入站管理 Basic/内部密钥不自动传到外站；源返回/服务端票据绑定头保留源 Cookie/Authorization。票据路径只使用已绑定头，调用方参数不能覆盖它。
- 回归必须覆盖订阅、管理员、内部运行时、匿名能力票据的 GET/HEAD；上游实际检查 Referer/User-Agent 等，否则返回 403。额外检查 Range、HLS 分片/key、toBytes=2/3 与旧媒体 URL。
- 源直接返回旧 /mediaProxy URL 时，实际跟随 /play 的最终媒体地址；若失败，修在已执行源的结果解包/能力签发处，保留 URL/源/路由范围，不能靠放宽票据或管理鉴权修兼容。
- 完成标准：先在现有代码复现失败，再全部通过；实际收到的头与来源/权限矩阵一致；匿名请求、错误/挪用票据、SSRF、限流和源凭据保密回归仍通过。更新配置/安全/交接说明，执行完整源码门禁，数量以输出为准。

**阶段 2：构建可验收的候选镜像并补发布前门禁**

- 静态核对发现：Dockerfile 目前只复制 check-shell.mjs/container-smoke.mjs，未复制 package.json 中 verify 命令引用的 scripts/verify.mjs；把正式 CLI 纳入发行并在镜像内实测。测试脚本与固定样本只注入临时容器，不预置到发行源码的 engine 或最终镜像。
- 目标文件：Dockerfile、.github/workflows/docker.yml、image-verify.yml、scripts/container-smoke.mjs、image-verify.mjs，以及必要的测试专用升级/媒体/容器编排辅助。
- 五引擎、旧数据升级、真实媒体与重启持久化移到发布前。增加 PR/手动 dry-run：只构建并验证，不登录/写 GHCR；main/tag 的发布必须依赖完整验收成功。
- 可拆为只读验证任务和有 packages:write 的发布任务，后者只加载/推送前者已验证的同一 image artifact；记录 artifact 校验值、image ID 和源码 SHA，禁止验收后重新构建另一镜像发布。验收容器的写层/测试卷不能 commit 成发行镜像。
- 改造原 image-verify 的仅检查媒体地址行为，实际请求媒体；固定“8 个源”等断言以预期样本集合和升级前快照表达，不能删除既有行为断言或套用新目录数量验收旧数据。
- 完成标准：测试失败使发布任务不可运行，dry-run 没有 registry 写入；最终发行仍零预置源、linux/amd64、实际 UID 非 root、包含全部引擎与正式 CLI。

**阶段 3：原生 amd64 容器矩阵**

| 场景 | 样本与操作 | 必须通过的条件 |
| --- | --- | --- |
| 全新空数据 | 一次性临时卷，启用 compose 的非 root/权限约束 | 零源、空默认配置、公开观影可达、首装引导码生效；管理/订阅边界正确 |
| 五引擎协议 | JS、DR2、CatVod、HIPY、PHP 固定样本，真实解释器 | 首页/分类/搜索/详情/播放/源代理通过；实际跟随各引擎播放结果 |
| 旧数据升级 | ae89c27 冻结 PHP/Python 桥接、合成用户脚本/ENV/参数/订阅/历史/凭据 | 新桥接落入运行副本，PHP 代理与 Python JSON 入站可用、无害 pickle 入站拒绝；用户脚本/辅助/配置实质内容、ID、Token、顺序、ENV 与历史保留 |
| 真实媒体 | 临时容器中的固定 HTTP 上游，不访问外站 | GET/HEAD/Range 206、Content-Range 与字节内容正确；HLS 主/子列表、分片、AES key 实际请求成功，头按矩阵传递 |
| 票据与出口 | 长 URL/头、篡改/过期/换目标/重启旧票据、映射 IP 与重定向 | 保密、长度与范围要求保持；禁止目标未收到请求；既有元数据/内网/白名单策略落到连接 |
| 私密配置与异常 | 普通 PHP 异常、配置保存/导入/引擎写入 | 固定安全错误、日志脱敏；私密临时/目标文件 0600，无命令/参数/ENV 泄露 |
| 重启持久化 | 快照后重启同一卷，再执行五引擎和媒体 | 密码仍可登录，脚本/实例/设置/ENV/订阅/历史保留，空闲引擎按需启动，旧能力票据失效、新会话可播放 |
| CLI 与异常启动 | 镜像内正式 verify，另用合成损坏 state/ENV、旧属主数据 | v2 与旧凭据迁移诊断通过；损坏文件不被自动覆盖；旧属主场景按 README 修正测试卷属主后可升级，不触碰正式数据 |

- 每个数据场景使用独立容器/卷，不共享正式数据或来源不明的旧镜像数据。故障保留脱敏日志与失败用例，修复后重跑受影响项，再跑完整矩阵。
- 产物记录源码 SHA、平台、UID、镜像标识、实际 Node/Python/PHP 版本、检查清单和 CI 链接；不只记录“返回媒体地址”或构建成功。
- 完成标准：完整矩阵成功、失败不被忽略/跳过；测试卷和日志与发行产物分离；没有 Docker 实测结果时本阶段保持未完成。

**阶段 4：整理提交、最终审查与发布**

- 按升级、票据、出口、私密配置、PHP/CLI、头兼容、容器门禁等逻辑整理提交，每组保留回归；核对远端最新分支并处理必要冲突，不强推。维护唯一 AI_HANDOFF，保留已执行与未执行边界。
- 跑 npm run check、npm run build、真实解释器 npm test；重新 npm audit，区分运行时/开发依赖，复核已登记风险与是否出现可修复版本，不通过无关大升级掩盖本次验收。
- 在工作分支/PR 先跑只读候选镜像验收，检查发布步骤确实 skipped；必要时用可控故障验证门禁会阻止发布。
- main 推送会触发 latest 发布，因此容器结果与审查齐全后再进入 main/tag 发布；发布同一已验收镜像，记录 SHA 标签、digest、OCI revision、平台和 CI 结果。GitHub 写入使用已登录身份/正常 Git 凭据，不把密钥写进仓库或文档。
- 匿名拉取固定 SHA/digest，确认与验收镜像一致，再跑发布后五引擎、真实媒体和重启持久化复验；失败停止推广该版本，保留证据。镜像与数据结构兼容性未核实时，不能承诺旧镜像直接挂载新数据可回滚；回退使用部署前的数据备份副本。
- 完成标准：源码和发布产物可对应、发布前/后验收均有证据，发行仍为空壳，文档不再把未验收项写成完成。

**独立产品决策与长期工作**

- 管理员锁出行为单独讨论：维持当前文档化预算，或成功凭据绕过鉴权失败预算；后者须评估高并发 KDF 成本、IP/NAT/反代假头与总请求限流的关系，再配回归。本轮发布计划不自动改变这一行为。
- 每源进程隔离、供应链 SHA/hash 固定、fServer WebSocket、依赖专项升级与更广泛站点验收进入下一轮。源同权限执行和零预置源/五引擎约定持续有效。

### 7.10 本轮执行结果与发布准备（2026-10-06）

- **范围与授权**：接手现有工作区，先检查 git status，再读 AGENTS/本文件；未重新克隆、覆盖或清理已有改动。本次允许本地工作和发布准备，未推送 main/工作分支、创建 PR、触发远端工作流或发布。历史交接授权未当作本次发布指令。管理员锁出预算与行为未改；五引擎、原源协议、零预置源和源同权限信任边界保留。
- **阶段 0 已执行**：在 `work/media-release-gates-20261006` 保存全部既有 R1–R10 修复为本地检查点 `73b4aa3`；媒体修复为本地提交 `ab7148e`。审查待提交文件、差异及 gitignore/dockerignore，没有已跟踪的 data/工具/虚拟环境/私密 HANDOFF；正式用户 data 未改。重新跑接手基线门禁，159 项全过、0 跳过。只读 `git ls-remote origin refs/heads/main` 为 `75748f1601f8993b59feefd0cb295990edf12639`，未执行 fetch/reset 或远端写入。
- **阶段 1 先失败后通过**：`tests/proxy-headers.test.js` 新增六条固定 HTTP 上游回归，现有实现实际 4 通过/6 失败/0 跳过；随后用隔离的原 server 快照再确认同样的协议失败。修复后媒体/播放/安全/限流专项 37/37 通过。最后对照 Python 基类增加真实 `proxy_media_url` 的 base64 加号回归，修复前专项实际 1 失败（400），修复后媒体专项 11/11 通过、0 跳过；未删除或放宽原断言。
- **媒体实现**：`src/media-params.js` 统一明文/base64 URL、JSON/base64 UTF-8 headers/旧 header、额外一层 URL 编码；headers 按字段存在优先，不受 form 控制，不回退到另一字段掩盖错误。查询参数中的非法 JSON/base64、数组/标量、非字符串值、非法 HTTP 头名/值明确 400；不重复解码签名 URL。合法 HTTP token 头名保留。宿主兼容旧 Python 未转义的 base64 加号；`engine/spider/py/base/spider.py` 的新生成地址正确 URL 编码，经启动框架刷新进入运行副本。
- **媒体权限/兼容实测**：订阅 GET/HEAD 继续受限；管理员/内部显式 Cookie/Authorization、Referer/UA 可达实际上游，入站 Basic/内部密钥不自动外传。匿名能力票据只用已绑定头，调用方畸形/覆盖参数不改能力；更换目标拒绝。源直接返回本服务旧 `/mediaProxy` URL 时，实际跟随 `/play` 最终地址，GET/HEAD/Range、HLS 主/子列表、分片/key 与 toBytes=2/3 均成功，源凭据保密。匿名、票据范围/篡改、SSRF、限流、长媒体回归仍通过。
- **阶段 2/3 仅完成准备**：Dockerfile 纳入正式 `scripts/verify.mjs`，移除预置 smoke 脚本；固定源/冻结桥接/测试脚本只通过 docker cp 注入一次性容器。新增 `container-matrix.mjs`，强制原生 Linux x64 与 linux/amd64/non-root/UID 1000；配置空数据/首装、五引擎实际媒体/正式 CLI、同卷重启、独立临时目录的升级与安全回归、损坏 state/ENV 保留、旧 root 属主修正场景。报告记录源码/验证 SHA、镜像 ID、解释器/UID、清单与 TAP，初始化码脱敏；失败/跳过使验收失败。**尚未构建候选镜像、运行 Docker 或完整原生矩阵，本阶段完成标准未达到。**
- **发布门禁准备**：候选 job 只读，PR 与手动默认 dry-run 没有 GHCR 登录/写入；发布 job 依赖候选成功且只允许 main/v* 的发布事件。验收后 save 原镜像，通过 artifact 交接；发布前校验 tar SHA256、image ID、源码 SHA、OCI revision 和平台，不重建、不 commit 测试容器。发布后 image-verify 工作流匿名拉取指定镜像并复用完整矩阵。三条门禁回归对旧工作流/Dockerfile 实际全部失败，对新版本全部通过；这是本地配置/条件验证，**没有执行真实 PR/dry-run 故障注入 CI**。
- **已执行的脚本/配置验证**：本机临时服务上运行新 image-verify，真实 Node/Python/PHP 执行五引擎首页/分类/搜索/详情/代理/正式 CLI，并请求 GET/HEAD/Range/HLS 主子列表/分片/key；在同一临时目录重启服务后快照（脚本/实例/参数/配置/ENV/订阅/凭据/版本历史）、旧票据失效与媒体复验通过。这是 macOS 源码服务验证，不是容器/卷验收。actionlint 1.7.12 检查三个工作流通过（未使用独立 shellcheck/pyflakes），六个多行 run 块的 bash -n 通过；工具位于忽略目录，不进发行。
- **最终源码门禁**：按用户指定 PATH、TEST_PYTHON、TEST_PHP 执行 `npm run check && npm run build && npm test`，退出 0；122 宿主/辅助语法文件、143 桥接文件、spider 37/engine 156 空壳检查通过；120 后端 + 49 UI = **169 项全部通过、0 跳过**。Node 22.23.3、Python 3.12.14、PHP 8.4.23；保留构建 chunk 大于 500 kB 提示。`npm audit --json` 实际仍 4 项；`npm audit --omit=dev --json` 仅 node-forge high、无修复版本，未改依赖。
- **下一步明确待执行**：授权安排工作分支/PR 或手动只读候选 CI，在原生 amd64 上完成完整矩阵及发布步骤 skipped/故障阻断证据，修复实际容器失败并复跑；再另行安排 main/tag 推送发布同一验收镜像、记录 digest/标签/OCI revision/CI 链接与匿名发布后复验。本机仍无 Docker CLI，未做外站、浏览器真实音视频或原 drpy-node-coder CLI 验收。不能用历史镜像结果或本地全绿替代这些未执行项。

### 7.11 工作分支同步 GitHub（2026-10-06）

- 用户本次明确要求推送 GitHub；仅同步工作分支 `work/media-release-gates-20261006`，未合并/推送 main、创建 PR、手动触发容器工作流或发布镜像。main 仍为 `75748f1601f8993b59feefd0cb295990edf12639`。
- 本机 Git HTTPS 缺少登录凭据，直接 push 实际失败；改用已连接的 GitHub 账号创建对应树/提交/分支，没有强推。原本地提交保留于本地原工作分支；远端对应为 `73b4aa3 → 99a6172`、`ab7148e → 5a26dd3`、`5c496d5 → c9f2c34`。提交元数据不同，逐组 Git tree 完全相同；最终源码 tree 为 `5f78d1f72ae00e7518cf64676c3c5b523b40ad22`，fetch 后 git diff 也确认没有内容或权限差异。
- 源码 [Verify 37455466575](https://github.com/tardlk/CokeTV/actions/runs/37455466575) 已由工作分支 push 自动启动；本条记录时状态为 completed / failure。此次没有原生 Docker 结果，不能据此将第 7.9 阶段 2/3 标为完成。
- 本补记仅修改交接文档，使用 `[skip ci]` 避免重复运行同一源码。接下来使用本地 `github/media-release-gates-20261006` 跟踪远端工作分支继续开发；原 `work/media-release-gates-20261006` 保留原本地检查点历史。源码/容器门禁和 main 发布仍按第 7.9 节执行。

- **工作分支 CI 后续修正**：首轮 Verify 的 check/build 成功，后端 119/120 通过、0 跳过；失败仅为 `private-data.test.js` 把 CI 的 `TEST_PHP=php` 命令名当私密路径，误命中源文件 `.php` 后缀。先在本机用 PATH 命令形式实际复现同一失败，再通过真实解释器 `PHP_BINARY` 取得绝对路径并用于原样保密断言与桥接执行；没有删除/放宽断言、改变宿主错误或跳过测试。命令形式专项 6/6 通过，指定本机解释器的完整 check/build/test 再次退出 0：120 后端 + 49 UI = 169 全过、0 跳过。此修正已同步为远端源码提交 `2e108e91f37e41fca5cf1d017027609411e7a040`，新的 [Verify 37455860875](https://github.com/tardlk/CokeTV/actions/runs/37455860875) 已 success：源码检查、构建和 120 后端 + 49 UI = 169 项测试全过、0 跳过；这是 GitHub Linux 源码验证，原生容器矩阵仍未执行。本机修正检查点保留在 `local-ci-php-checkpoint-20261006`，跟踪分支在远端 tree 核对一致后对齐，文件内容保持不变。

### 7.12 原生 amd64 容器验收结果（2026-10-06）

- **授权与执行**：用户明确要求执行原生 amd64 容器验收。已建立 [PR #1](https://github.com/tardlk/CokeTV/pull/1)，保持 draft；只读候选工作流 [Docker amd64 37456713645](https://github.com/tardlk/CokeTV/actions/runs/37456713645) 在 GitHub 原生 Ubuntu 24.04 x64 runner 实际构建并运行容器，整体 success。candidate 的源码门禁、构建、完整容器矩阵、原镜像保存和 artifact 上传均 success；publish job 确认为 **skipped**，没有 GHCR 登录/推送、main 合并或正式 data 操作。本机仍无 Docker，不能将此描述为本机容器验收。
- **源码与镜像对应**：PR head 为 `510c5a2611a6ba3109a7160705cb16d06ca63469`；GitHub 实际 checkout/OCI revision 为 PR 合并候选 `5f58431d8058b413488e87a3c27d28db7d2e66e6`。fetch 该 merge ref 后确认两者 Git tree 同为 `3e93cbe0d2a4f0d766a9278afa70c487d291badd`，git diff 为零。镜像 ID 为 `sha256:2cb7005bdc866699f60aee8823ab2fe3a9f3a5de2cc970b5aaa1587ffb84900e`，平台 `linux/amd64`，实际 UID `1000`；Node `v22.23.3`、Python `3.13.5`、PHP `8.4.26`。这是候选 image ID，不是已发布 GHCR digest。
- **完整矩阵实际通过**：全新空数据/零源/空默认配置、首装引导码、管理/订阅边界、非 root 和正式 CLI；五引擎首页/分类/搜索/详情/代理/CLI 与实际 GET/HEAD/Range 206、Content-Range/字节、HLS 主子列表/分片/AES key；同卷 Docker 重启后脚本/实例/参数/ENV/配置/订阅/凭据/版本历史快照、旧票据失效及五引擎媒体复验。冻存 ae89c27 桥接升级、PHP 代理/Python JSON 入站及无害 pickle 拒绝、用户内容/ID/Token/顺序保留、私密 0600/异常脱敏、票据与出口/长媒体/头矩阵/CLI 等容器回归全部通过。独立坏 state/ENV 卷实际拒绝启动且保留原字节；旧 root 属主卷实际失败，按 README chown 1000:1000 后恢复并通过 smoke。所有场景仅一次性容器/卷或容器内独立临时目录。
- **测试与产物核对**：候选任务源码门禁 120 后端 + 49 UI = 169 全过、0 跳过；容器内 17 个回归文件的 TAP 为 **116/116，通过、0 失败、0 跳过**（不含只在源码 CI 检查的文档/工作流四条用例）。`report.json` 的 completed=true、六组检查清单与解释器/UID/镜像 ID 已核对；下载证据 ZIP 并实际校验 SHA256 与 GitHub artifact digest 一致，进一步核对其中 TAP，而非只看工作流 success。
- **候选产物**：[candidate artifact 11410585112](https://github.com/tardlk/CokeTV/actions/runs/37456713645/artifacts/11410585112)，ZIP SHA256 `b029f14b1009d01c613b26fef200742f2f7a1e3b2d897906ee37193ab41faf8b`，包含原 image.tar、tar 校验文件、image ID 与源码 SHA；[验收证据 artifact 11410385233](https://github.com/tardlk/CokeTV/actions/runs/37456713645/artifacts/11410385233)，ZIP SHA256 `01609e100174061cde4057811b5e10d2d4fccb2e6b828a457cc90f25b0de0731`，包含 report/TAP/脱敏容器日志。候选 artifact 2026-10-09 到期，证据 artifact 2026-10-13 到期；链接不代表长期保存或已发布镜像。测试写层/卷没有 commit 为发行镜像。
- **本轮收尾与剩余边界**：原生候选首次完整运行即通过，无容器失败需要掩盖或跳过；PR 的只读发布隔离已经实际验证。没有执行额外人工故障注入的失败候选 CI、真实外站/浏览器音视频或 drpy-node-coder CLI。本轮只回填实际验收证据，不改变源协议、管理员锁出或依赖。main/tag 合并与镜像发布仍须另行安排；发布时继续运行门禁并推送该工作流内同一验收 artifact，之后匿名固定 SHA/digest 拉取与完整发布后复验仍待执行。收尾文档提交仅文档，使用 `[skip ci]`，不能把它说成同一 SHA 的重新容器验收。

### 7.13 主线发布与匿名发布后复验（2026-10-06）

- **本次授权与最终审查**：用户明确要求按“最终审查 → 合并 main/自动发布 → 匿名固定 digest 拉取完整复验 → 回填记录”执行。复核 PR 的 42 个改动文件、发行忽略规则、五引擎/源同权限/管理与订阅边界、框架刷新、能力范围、每跳出口、PHP/私密配置/CLI 和 artifact 发布门禁。原生 PR 验收以后仅四份文档变更，没有运行代码变化；工作区干净、data/工具/虚拟环境/私密 HANDOFF 未跟踪。PR 转 ready 后以 expected head `5cd091cff7bad24388c2b75cb13d38d7897919de` 正常 merge，没有强推；[PR #1](https://github.com/tardlk/CokeTV/pull/1) 已 merged，main 发布提交 `c2a1f21f9be005e1855bd78b00613033791c0dbb`，tree `6340e71eaccf01fb496035c99ab21b2ae05807eb`，本机 main 已 fast-forward 同步。原工作分支和本地修复/验收检查点保留。
- **主线源码与发布前门禁**：[Verify 37458591153](https://github.com/tardlk/CokeTV/actions/runs/37458591153) success；[Docker amd64 37458591100](https://github.com/tardlk/CokeTV/actions/runs/37458591100) 的 candidate 与 publish 均 success。candidate 再次执行源码 check/build/test（169 全过、0 跳过）、原生 Ubuntu 24.04 x64 单次构建与完整容器矩阵，报告 completed=true、116/116 容器回归零失败/零跳过；六组场景同第 7.12 节全部通过。实际 runtime 为 Node 22.23.3 / Python 3.13.5 / PHP 8.4.26，linux/amd64、UID 1000。没有拿 PR 旧镜像绕过本次 main 门禁。
- **同一验收镜像发布**：candidate image ID `sha256:5f6a5b194bd4a76e9714c154f38e3e4054466572d639a59a03282e66594d46a2`。原镜像 save 后的 tar SHA256 为 `eca7bc7f9afe4238277901d4f2f1a30b367c6a87a190237892946b4e45e451d3`；[candidate artifact 11411132610](https://github.com/tardlk/CokeTV/actions/runs/37458591100/artifacts/11411132610) ZIP digest `sha256:e4bb5dc0864121f905305d4b138925ef4ce4c9767469c1314301419739cfdc9a`。publish 实际下载该 artifact，登录前完成 tar 校验（image.tar: OK）、image ID/源码 SHA/platform/OCI revision 核对，load 同一镜像后再登录/push；没有验收后重建或 commit 测试容器。
- **发行身份与匿名元数据实测**：已发布 `ghcr.io/tardlk/coketv:sha-c2a1f21` 与 `:latest`，两者 registry digest 都是 `sha256:c269b482eddaff2668a43773b82fcd98f23c89b90bd48542eb4a2a6b95c8d1a2`。未使用 GitHub/registry 登录凭据的匿名 manifest/config 读取，对响应字节计算 SHA256 并比对 Docker-Content-Digest；确认单一 linux/amd64 manifest、User=node、OCI revision `c2a1f21f9be005e1855bd78b00613033791c0dbb`。config digest 等于上述 candidate image ID，不把 config ID、artifact hash 与 registry digest 混为同一个值。
- **发布后实际复验**：通过已登录 GitHub 页面在 main 触发 `image-verify.yml`，输入固定 `ghcr.io/tardlk/coketv@sha256:c269b482eddaff2668a43773b82fcd98f23c89b90bd48542eb4a2a6b95c8d1a2`；[Verify published image 37459488105](https://github.com/tardlk/CokeTV/actions/runs/37459488105) success。其 docker pull 实际匿名拉取该 digest，随后复用完整原生矩阵：五引擎实际媒体/CLI、空壳/访问边界、旧框架升级/用户保留、同卷 Docker 重启/旧票据失效/媒体复验、私密配置/异常/出口/票据和损坏配置/旧属主恢复均通过；116/116、0 失败/0 跳过。报告的 image ID、source/verification SHA、平台、UID、解释器与发布前完全相同。
- **证据核对与保存**：[发布前证据 11410967699](https://github.com/tardlk/CokeTV/actions/runs/37458591100/artifacts/11410967699) ZIP digest `sha256:01a4310bbe89850c6df7baae8630433dec483f9b1984ca44fc8baccaa7a86a51`；[发布后证据 11410424356](https://github.com/tardlk/CokeTV/actions/runs/37459488105/artifacts/11410424356) ZIP digest `sha256:75e1ba7852019495626e0e14339552d8c654656300062d0c1ab0f121652c95fc`。两份 ZIP 均实际下载、校验 hash 并读取 report/TAP，116 全过零跳过及镜像身份已核对。candidate 产物 2026-10-09 到期，前后证据 2026-10-13 到期；不得当作永久镜像备份。日志初始化码已脱敏，正式 data 未读写。
- **收尾与边界**：本轮阶段 0–4 的既定发布/复验流程已完成。收尾再次 npm audit，仍为已登记四项（runtime node-forge high 无修复版本、其余三个 dev-only），不改依赖。管理员锁出、源同权限边界、五引擎与零预置源约定保持；本机仍没有 Docker，未运行外站/浏览器真实音视频或 drpy-node-coder CLI，也未额外执行故障注入 CI。最后仅正式文档补记，使用 `[skip ci]`，不重复发布相同运行代码；新文档 HEAD 可不同于上述 OCI revision，发行追踪以固定源码 SHA/digest 为准。

## 8. 验证证据与探测脚本

两轮修复都用**攻击探测**独立验证过（不是只看代码）：管理鉴权绕过矩阵（编码前缀、`/./` 前缀、absolute-form 原始 socket）、票据挪用、请求头注入、HLS 正向对照、`/json/` 策略、scrypt 事件循环阻塞、`toBytes=2` 头透传、空壳检查绕过尝试。

探测脚本在**与仓库同级的 `coketv-audit/` 目录**（未纳入仓库，内含本机绝对路径，不要提交），用 `node <脚本>` 运行，各自使用临时数据目录、不改动仓库：

| 脚本 | 用途 |
| --- | --- |
| `probe1-auth.mjs`、`probe2-rce.mjs`、`probe3-variants.mjs`、`probe3b-absolute.mjs`、`probe4-chain.mjs` | C1 鉴权绕过与未授权 RCE 链的原始复现（修复后应全部被拒） |
| `probe5-json.mjs` | `/json/` 匿名读取的原始复现 |
| `probe6-internalkey.mjs` | 源脚本读取 `DRPY_INTERNAL_KEY`（**已知信任边界**，不是待修 bug） |
| `probe7-verify-fixes.mjs` | 打印式历史验收：C1 矩阵、absolute-form socket、C2 票据范围、HLS 正向对照、`/json/` 策略、`/health` 形状；部分标签/对照有局限，见第 7.3 节，不以退出 0 断言全部通过 |
| `probe8-localproxy.mjs`、`probe9-e2e-php.mjs` | PHP `localProxy\|proxy` 最派生解析（桥接层 + 宿主端到端） |
| `probe10-scrypt-dos.mjs`、`probe11-dos2.mjs` | scrypt 阻塞与事件循环延迟测量 |
| `probe12-proxy-headers.mjs`、`probe12b.mjs`、`probe14-redirect-real.mjs` | `toBytes=2/3` 源头透传（14 为真实匿名跟随 302 路径） |
| `probe13-final.mjs` | `/admin/health` 鉴权、`/json` 穿越、安全响应头、限流 |
| `probe15-ratelimit-exempt.mjs` | **第 7.1 节第 1 项的复现**（限流豁免覆盖 `/proxy/`） |
| `probe16-takeover-security.mjs` | R2/R3/R4/R7：票据可解码凭据、映射 IPv6 守卫、受控两次 DNS 答案、长媒体票据 414；不访问真实元数据 |
| `probe17-takeover-upgrade.mjs` | R1：远端旧桥接运行副本升级，PHP 500 / Python 保留旧 pickle，检查用户状态/脚本/ENV 保留 |
| `probe18-takeover-bridges.mjs` | R5/R8/R9：PHP 异常公开 params、宿主 ENV 文件权限、多层继承方法选择 |
| `probe19-takeover-http.mjs` | R6：实际 POST `/http` 的重定向白名单绕过，与直接请求/媒体重定向/票据挪用拒绝作对照 |
| `probe20-takeover-verify-cli.mjs` | R10：GUI 设置 v2 哈希凭据后实际 verify CLI 失败，与显式 ADMIN_PASSWORD 成功作对照 |

空壳检查的绕过尝试（`_` 前缀、子目录、`.mjs`、非 spider 目录、`config/sites.json` 等 11 种）已固化为 `tests/shell.test.js` 的自测用例，无需额外脚本。

## 9. 接手边界与方法约定

- 继续以用户的新要求为准。不要清空、重建用户数据；不要恢复标签、状态筛选、列表验证按钮或依赖工具栏；不要把空壳理解成删除源引擎。
- 改代码前先读 `AGENTS.md`；源执行接口、代理返回语义、原模块名路径必须保持兼容。
- 改完必须跑 `npm run check && npm run build && TEST_PYTHON=python3 TEST_PHP=php npm test`；新增修复必须配一条**能失败**的用例（先复现再修）。
- 不要用删断言、放宽状态码集合、跳过用例的方式让测试变绿。
- 本文件记录最终实现与验证事实：只写实际跑过的命令与结果，没跑过的（Docker、外部站点、drpy-node-coder CLI）明确写"未做"。更新本文件时不要放凭据、本机绝对路径或私密地址。
