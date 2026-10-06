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
| `src/playback.js` / `src/media.js` | 12 小时 HMAC 签名媒体票据、请求头、Range/HLS 代理 |
| `src/ssrf.js` | 代理出口 SSRF 判定（元数据、内网与白名单策略；接手复核发现绕过，见第 7.3 节） |
| `engine/utils/tvbox-cms.js` | JSON/XML 采集、首页完整封面 |
| `web/App.vue` / `web/WatchApp.vue` | 管理与公开观影 |
| `web/SourceWorkspace.vue` / `web/CodeEditor.vue` | 编辑工作区和 Monaco |
| `web/SourceImport.vue` / `web/WebPlayer.vue` | 导入窗口和播放器 |
| `scripts/check-shell.mjs` | 发行树零预置源断言（spider 逐文件白名单 + 全 engine 内容判定） |
| `scripts/check-bridges.mjs` | `engine/spider/**` 的 ast.parse / php -l / node --check |
| `scripts/container-smoke.mjs` | x86 空容器与 JS/Python/PHP 真实执行验收 |

`engine/spider/` 只保留辅助模块、HIPY core/base、PHP 桥接/lib 和 WASM。`engine/json/`、`engine/jx/`、`engine/data/` 为空，config 是空默认值。第一次准备空运行目录；升级保留已有 data，不添加原站点。

## 4. 验证

```sh
npm ci
npm run check     # 语法 + 桥接语法 + 空壳发行
npm run build     # 必须先 build，集成测试需要 dist/index.html
TEST_PYTHON=python3 TEST_PHP=php npm test
```

当前实测门禁（2026-10-06，macOS arm64 / Node 22 / Python 3.12 / PHP 8.x）：

- `npm run check`：`118 文件语法` + `143 桥接文件语法` + 空壳通过（spider 37 个文件全部已登记；engine 共 156 个文件无站点规则/清单）
- `npm test`：**124 测试 = 75 后端 + 49 UI**，全绿；全部使用临时数据目录
- `npm audit`：4 项 = 1 runtime `node-forge`（上游无修复版本）+ 3 dev-only（vitest/tinypool/@vitest/mocker），见 `SECURITY.md`
- `npm run build`：通过

注意事项：

- 干净克隆必须先 `npm run build` 再 `npm test`；不能依赖被忽略的本机 `dist/`。CI 已按此顺序。
- Python 新建模板必须接受 HIPY 守护进程的 `t4_api` 构造参数；创建模板测试除语法检查外实际执行首页，容器验收也覆盖这条路径。
- 本机没有 Docker，**不能声称做过本机容器验收**；容器结论只以 GitHub Actions 日志为准。
- 未运行原 drpy-node-coder CLI，不宣称使用过。协议样本不代表所有第三方站点、解析器或编码可播。
- 测试数量与文件数以脚本实际输出为准；`docs/DEVELOPMENT.md` 已移除固定计数，并由回归用例防止重新写入。

## 5. 发布现状

- 2026-10-05 首次发布：功能提交 `3b17276`，源码 [Verify 37252776598](https://github.com/tardlk/CokeTV/actions/runs/37252776598) 与 [Docker amd64 37252776569](https://github.com/tardlk/CokeTV/actions/runs/37252776569) 均成功。
- 历史镜像 `:sha-3b17276`，当时同 digest 发布为 `:latest`：`sha256:8e733b3cc506be4682015e9df004ba9b3705f31c058d9da263e28dbfa049461c`（匿名读取 manifest/config 确认 `linux/amd64`）。独立拉取验收：[Verify published image 37253476492](https://github.com/tardlk/CokeTV/actions/runs/37253476492)。这个 digest 只代表旧发布，不能据此断言当前 latest 的版本。
- **2026-10-06 源码同步已完成**：用户明确授权推送。GitHub `main` 的代码快照为 `984ccf0ff2ed2d0f63c96f2f5b7b2098cba023d3`，Git tree 与本地整理后的 `da3ce44` 完全相同（`eed21e5c7d44212cec56f80ee0b2ba08cc3f708c`）；包括此前 9 个未推送提交、本轮限流修复和接手审查记录。原始本地 11 个提交保留在 `handoff-local-20261006`，本地 main 已跟随远端。收尾文档补记使用 `[skip ci]`，不重复发布相同代码。
- **本次 CI / 镜像状态（已核对）**：[Verify 37429832617](https://github.com/tardlk/CokeTV/actions/runs/37429832617) 与 [Docker amd64 37429832738](https://github.com/tardlk/CokeTV/actions/runs/37429832738) 均成功；后者的源码检查、发布前空容器验收、镜像发布三个步骤分别为 success。已发布 `ghcr.io/tardlk/coketv:sha-984ccf0` 与 `:latest`，两者 digest 相同：`sha256:8329ad339a36d81e6bfc7771104f0a9d106a8e08a210c5bbbbad9e8e255488f0`。匿名读取 manifest/config 确认 `linux/amd64`、`User=node`、revision 为 `984ccf0ff2ed2d0f63c96f2f5b7b2098cba023d3`。
- 本次没有本机 Docker 验收，也没有运行新镜像的发布后五引擎拉取/重启持久化手动工作流；容器 Range/HLS 与旧数据升级覆盖仍有第 7 节所列缺口。发布成功不表示 R1–R10 已修复。
- 发布链路：Verify 工作流跑语法/空壳/测试/构建；Docker amd64 工作流在 main/tag/manual 上做源码验证 → 原生 amd64 构建 → 临时空容器验收 → GHCR 发布，使用仓库 `GITHUB_TOKEN` 的 packages 权限，不提交发布密钥。`latest` 对应 main，`sha-*` 固定提交，`v*` 发布版本。
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

接手时 `main` 领先 `origin/main` 9 个提交的描述是历史快照。本轮限流修复的本地提交是 `a0882c2`，其内容现已同步到 GitHub 代码快照 `984ccf0`；本地 main 已跟随远端，原本地提交保留在交接分支。源码同步/镜像结果见第 5 节与第 7.4 节。**第 7.1 节第 3、4 项及 R1–R10 仍未修复**，不得把整理提交或 CI 全绿当作这些问题已闭环。

### 7.1 建议尽快修（影响已加上的防护或文档正确性）

本次接手逐条核对：接手时四项原待办均存在；现已完成第 1、2 项，第 3、4 项保留。编号保持不变，便于对照原接手要求。

1. **限流豁免范围过大（中，已修）**：修复前 `probe15` 在 `RATE_LIMIT_PER_MINUTE=5` 下复现 `/watch/sources` 4×200 后 429；带匿名媒体票据的 `/proxy/<id>/` 12×200、0×429，后续又驱动 30 次引擎执行。原因是任何有效票据都豁免，而媒体票据在 `/proxy/:module/*` 只绑定源、不绑定 URL。
   - 当前仅 GET/HEAD 媒体转发路由（`/mediaProxy`、`/req/*`、`/m3u8-proxy/{playlist,ts,proxy}`、`/unified-proxy/proxy`、`/file-proxy/proxy`）中，签名有效且 `kind === 'proxy'`、目标 URL 与票据一致时豁免。`/proxy/:module/*` 及其他公开接口照常计入原 IP 桶，默认 1200/min；不变更媒体票据的源代理兼容权限。
   - 限流按匹配路由判断，避免百分号编码路径与 absolute-form 形态跳过计数。`SECURITY.md` 与 `docs/CONFIGURATION.md` 已纠正票据范围和豁免说明。
   - 修复后同一 `probe15`：带媒体票据的 `/proxy/` 12×429、0×200，后续引擎执行数为 0。
   - `tests/rate-limit.test.js` 修复前实际失败（期望 429，实际 200），修复后通过：预算内源代理返回正常；预算耗尽后拒绝且不执行引擎；编码/absolute-form 不能绕过；HLS 分片/key 高频 GET、HEAD、Range 与 base64 目标保持可用；票据换目标/挪到其他路由不豁免；源代理 `toBytes=2` 302 补签仍可匿名跟随。
2. **`docs/DEVELOPMENT.md` 计数陈旧（低，已修）**：接手时仍写 `114 项测试（66 后端、48 UI）、117 个文件语法检查`。已删除固定计数，指向 `npm test` / `npm run check` 实际输出及本文件第 4 节的验证记录。`tests/documentation.test.js` 在原文上实际失败，修订后通过，防止“当前验证”重新维护固定测试/语法文件计数。
3. **`/mediaProxy` 与 `/proxy` 的头处理不一致（提示）**：`/proxy` 已能解包旧基类 `header`+`form=base64` 并补签票据，而直接请求 `/mediaProxy?url=…&header=<b64>` 仍只认 `headers`（复数 JSON），且只有订阅 Token 路径读调用方头，`admin`/内部运行时拿到的头恒为 `{}`。若源在服务端自行拼 `mediaProxyUrl` 就会丢头。建议把 `unwrapMediaProxyContent` 的解包逻辑复用到 `/mediaProxy`。本次在临时目录和固定 HTTP 上游复核：订阅 Token + `headers` JSON 的 Referer 可透传；订阅 Token + `header` base64、管理员 + `headers` JSON、内部运行时 + `headers` JSON 均丢失 Referer（四条请求均为 200）。本次未修改此行为。
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

### 7.3 全面接手复核（2026-10-06，新增发现，尚未修复）

用户要求对照原始仓库判断其他 AI 修改是否正确。本次以 GitHub `tardlk/CokeTV` 的远端 `main`（只读 `git ls-remote` 确认为 `ae89c27570537c8931f0747a3c2185880a6b94e3`）为基线，核对本地 `HEAD=544a618` 之后的工作区及领先远端的 9 个提交。审阅管理/订阅/媒体鉴权、票据与限流、出口策略、Store 升级与私密配置、五种引擎桥接、导入、前端变更、Docker 和三个工作流，以及测试断言与旧版实现。

结论：管理鉴权改用匹配路由、异步 scrypt、票据防篡改和 URL 绑定、源返回头透传、Python JSON 协议、空壳检查的方向正确；**现有测试全绿不能证明升级兼容或安全修复全部完成**。以下编号 R1–R10 均有独立临时样本复现；既有新增回归，也有原问题或新增防护没有闭环，不能全部归因于本轮改动。

| 编号 / 优先级 | 问题与定位 | 实测证据 / 来源 | 修复与回归要求 |
| --- | --- | --- | --- |
| **R1 / P1** | 旧数据升级不会更新框架桥接：`src/store.js:30` 仅在目录不存在时复制 `runtime/spider`，但会刷新 `libs`；新版 PHP 调用 `localProxy\|proxy`，旧桥接不认识候选名，Python 安全更新也未落到运行副本 | `probe17`：全新目录 PHP 代理 200；放入远端旧桥接后重启当前宿主，代理 500，运行副本仍含 `pickle.loads(payload)`；实例状态、用户脚本和每源 ENV 保留。旧复制策略与新版协议组合形成升级回归 | 以框架文件清单更新桥接/基类/辅助库，严格保留用户脚本、ENV、订阅和配置。回归必须从旧版本运行副本升级，验证 PHP 代理与 Python 协议及数据保留，不能只测空目录 |
| **R2 / P1** | 匿名票据泄露上游凭据：`src/playback.js:33–36` 用 base64url 明文 JSON 加 HMAC，载荷包含源返回的 `headers` | `probe16`：匿名 `/play` 返回的票据可直接解码出源从 ENV 取得的 Cookie 和源返回的 Authorization。HMAC 保证完整性，不提供保密性；远端旧版随机票据没有该载荷，属于新增回归 | 改为有容量/过期控制的服务端随机能力票据，或经过审查的认证加密；保留 kind/source/URL/headers/expiry 约束。回归断言匿名响应及票据中无法恢复源凭据，同时正常带头媒体仍可转发 |
| **R3 / P1** | IPv4 映射 IPv6 绕过内网与元数据判定：`src/ssrf.js:19–24,58` 未把规范化的十六进制 IPv4 尾部转换成 IPv4；元数据仅按文本比对 | `probe16`：关闭内网时普通回环媒体 403，`[::ffff:127.0.0.1]` 媒体 200 并取得自建临时上游内容。映射元数据地址通过守卫，而普通元数据地址 403；**未向真实元数据服务发请求**。新增防护不完整 | 按 IP 字节规范化后统一做地址分类和元数据判定；覆盖 IPv4、IPv6、映射形式、DNS 返回形式和重定向 |
| **R4 / P1** | DNS 检查与连接分离：`src/ssrf.js:55,65` 返回解析地址，`src/media.js:46,53` 丢弃结果并让 HTTP 客户端再解析 | `probe16`：受控模拟守卫解析返回公网地址、实际连接解析为回环，关闭内网后仍取得临时上游 200。**这是模拟两次 DNS 答案不同，并非真实外部 DNS rebinding 攻击测试**。新增防护不完整 | 实际连接只能使用已检查地址，并保留 Host/TLS SNI；每次重定向重新检查和绑定。回归使两次解析给不同地址并断言禁用目标不能被连接 |
| **R5 / P1** | PHP 失败向匿名用户泄露源参数：`engine/libs/php.js:62–67,99–101` 原样抛出带完整命令参数的 execFile 错误，`src/server.js:48–50` 原样发送；现有 ENV 脱敏未覆盖 params | `probe18`：普通 PHP 首页抛异常，匿名首页返回 500，响应包含固定样本的私有 params 和 sourceEnvPath。远端已有该错误链，属于旧风险未闭环 | 解析桥接错误并在公共响应中返回稳定的安全错误；不得返回子进程命令、路径或私有参数。诊断日志也需脱敏。以普通源异常触发，断言匿名响应没有 params/ENV/命令 |
| **R6 / P2** | `/http` 只检查首跳：`src/server.js:601–607` 之后由 axios 自动跟随重定向，无出口复核 | `probe19`：白名单只含临时上游的域名，直接请求未列入名单的回环 IP 403；域名 302 到同一上游的 IP 后 `/http` 返回 200，而 `/mediaProxy` 同类重定向 403。需管理、内部或订阅凭据，**并非匿名 `/http` 绕过**；实际 POST 携媒体票据仍为 403。新增防护不完整 | 每跳复核并绑定检查后的地址，限制重定向，保持 method/body/headers 的兼容语义；固定上游回归覆盖允许首跳到禁止目标 |
| **R7 / P2** | 长播放地址变成不可访问的媒体票据：`src/playback.js:35,51` 把整个 URL/headers 放入路径，`src/server.js:44` 路由参数最大 4096 | `probe16`：合法固定媒体 URL 仅附 4000 字符签名参数，播放解析 200，票据长度 5640，随后媒体请求 414；短地址对照 200。旧随机短票据不受此影响，属于新增回归 | 与 R2 一并采用短且不泄密的能力引用；不要通过缩减合法源 URL 或头的协议范围来规避。回归必须实际跟随媒体地址，不能只断言播放解析 200 |
| **R8 / P2** | 全局 ENV 的 0600 没覆盖宿主保存：`src/store.js:56–59,72–74` 原子写入临时文件未指定权限 | `probe18`：当前机器 umask 下全新全局 ENV 为 0644；先设为 0600，再调用宿主 `syncEnvironment()` 又变回 0644。旧宿主写法仍在，历史 M5 仅覆盖引擎写入路径 | 对私密文件原子写入明确 0600；覆盖首次创建、设置保存、重启和引擎 ENV.set。不能只 chmod 一次后被 rename 换掉 |
| **R9 / P2** | PHP 方法选择并非完整的“最派生”：`engine/spider/php/_bridge.php:83–93` 仅排除 BaseSpider，遇到第一个非 BaseSpider 候选就停止 | `probe18`：中间父类声明 localProxy（404），Spider 自己重写 proxy（200）；当前选择父类并返回 404。远端直调 proxy 可命中子类，属于新增兼容回归 | 比较候选声明类到 Spider 的继承距离，同层再按约定优先级选择；补多层继承、直接实现、纯继承默认方法的回归 |
| **R10 / P2** | 哈希凭据升级后 CLI 验证失效：`scripts/verify.mjs:8–9` 仍读取 `admin.json.password`，v2 格式没有这个字段 | `probe20`：临时 GUI 设密后，按文档运行实际 verify CLI（无 ADMIN_PASSWORD）退出 1；同一 CLI 显式提供正确密码，首页/分类/详情通过。哈希迁移带来的新增兼容回归 | CLI 提供安全的交互或明确的凭据输入，文档同步；不能逆推哈希或重新保存明文。回归覆盖 GUI 设置后的 v2 凭据以及旧格式迁移 |

本轮审查阶段的验证事实与边界（收尾提交/推送前的历史记录）：

- 第 7.1 节第 1、2 项的修复与两条回归保留；第 3、4 项仍在，R1–R10 此轮只复现和登记，**未修复**。
- `probe16` 至 `probe20` 均实际执行；全部使用临时数据目录与固定脚本，本地网络只访问自建临时 HTTP 上游，没有使用正式用户 `data/`。
- 新执行 `npm audit --json`：仍为 4 个包（1 high / 1 moderate / 2 critical），runtime 仅 node-forge 且 fixAvailable=false，另外 3 包标记 dev；没有擅自升级依赖。
- 历史 `probe7` 是打印式探测，退出 0 不能作为所有检查通过的证据；其中标为“POST /http”的 helper 实际发 GET，404 不证明 POST 被拒，现已由 `probe19` 对实际 POST 验证。它的 example.invalid 媒体 403 也不能当正常媒体对照；HLS 实际分片 200 与篡改票据 403 的结果仍有效。
- 本轮重新执行 `npm run check && npm run build && TEST_PYTHON=python3 TEST_PHP=php npm test`，退出 0：118 个宿主/辅助文件语法、143 个桥接文件语法、空壳检查、生产构建通过；75 后端 + 49 UI = 124 项全部通过，0 跳过，五引擎固定样本通过。构建仍有大于 500 kB 的 chunk 提示。这批独立探测尚未成为仓库内回归，不增加测试计数，也没有删除、放宽或跳过既有断言。
- 本轮未做 Docker、真实站点播放、浏览器端真实音视频播放或原 drpy-node-coder CLI。未 commit、push、发布、重建镜像或修改远端；实际执行的是本仓库的 verify CLI，二者不能混称。

建议修复顺序：先 R1（旧数据升级）和 R2/R7（票据保密与长度），再 R3/R4/R6（完整出口连接/重定向策略），随后 R5/R8（私密配置与异常）及 R9/R10（协议/工具兼容）。每组先把本节样本转成能在当前代码失败的回归，再修复并跑完整门禁；发布前另做容器旧数据升级与真实媒体转发验收。

### 7.4 会话收尾与新对话入口（2026-10-06）

- **用户最新要求**：整理仓库与文档、推送 GitHub，然后换对话；已明确授权推送，且已说明 main 推送会触发 Docker 工作流发布 latest。本轮没有扩大范围去修 R1–R10。
- **本轮实际改动**：本地提交 `a0882c2`（已包含于 GitHub `984ccf0`）收紧票据限流豁免，新增 `tests/rate-limit.test.js` / `tests/documentation.test.js`；README、配置、开发、安全策略同步真实边界和验证口径。本文件集中登记审查发现，未另建接手报告；`verify` 文档新增显式密码的临时用法，R10 的 CLI 实现仍待修。
- **收尾门禁**：再次运行 `npm run check && npm run build && TEST_PYTHON=python3 TEST_PHP=php npm test`，退出 0，118 宿主/辅助语法文件、143 桥接语法文件、空壳检查、生产构建通过；124 项 = 75 后端 + 49 UI，0 跳过。仅保留构建 chunk 大小提示。未做本机 Docker 或新增外部站点播放验证。
- **当前测试服务**：本机 `http://127.0.0.1:54058` 保持运行，首页、后台、健康接口实际返回 200；使用独立临时 DATA_DIR，未启动或改写仓库正式用户 data。测试数据保留，不要为清理仓库而删掉。仓库外 `../coketv-audit/preview-session.json` 记录 PID 与测试数据位置，不含密码或初始化码；换对话后先确认进程是否仍在，避免重复启动或覆盖测试数据。该记录与全部探测脚本都不提交。
- **提交/推送状态**：源码和接手文档已同步到 GitHub，本地 main 已与远端一致；原本地提交保留在 `handoff-local-20261006`。本机 Git HTTPS 没有登录凭据、也没有现成 SSH 身份，本次使用已登录且有仓库写权限的 GitHub 连接追加快照提交，未强推或覆盖原远端历史；以 Git tree 相等核对全部文件内容和权限。下一轮推送需使用该连接或先配置正常 Git 登录，不能因为认证失败强制改写远端。CI/镜像发布已成功并回填 digest，详见第 5 节；本次收尾纯文档补记标记 `[skip ci]`，这不用于跳过代码变更的验证。
- **新对话按顺序读**：AGENTS → 本文件 → 需要改代码时读正式开发/配置/安全文档。先读取第 7.1 节保留项及第 7.3 节 R1–R10，再结合第 8 节的本机探测脚本继续；建议优先 R1、R2/R7，保持五引擎和原源协议，先建立能失败的回归再修。

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
