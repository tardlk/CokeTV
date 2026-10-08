# CokeTV AI 接手文档

更新：2026-10-08。**这是本项目唯一的接手文档**：原有的《审查报告》《完善计划》《修复验收报告》《第二轮验收报告》四份过程文件已全部并入本文件并删除，不要再去找它们。

公开交接文件，不含凭据、本机绝对路径或私密地址。接手请按顺序读：

1. 根 `AGENTS.md`（硬性工作约定，优先于本文件）
2. 本文件
3. 需要改代码时再看 `README.md`、`docs/CONFIGURATION.md`、`docs/DEVELOPMENT.md`、`SECURITY.md`、`docs/THIRD_PARTY.md`

---

## 0. 当前接手入口（先看本节）

**2026-10-08 本轮GitHub同步授权**：用户已明确要求“推送到github”。六项修复、确定冗余清理、静态检查与回归将一起提交到main，后续CI/镜像实际结果见7.31；同步前已确认远端main与本地基线一致。此前“本地未提交”是7.30修复阶段快照，本机运行容器继续保留原版本与数据。

**2026-10-08 审查修复（本地未提交）**：用户要求审查冗余及完善项后，明确授权执行修复计划。六项已复现问题与确定冗余已修复，新增静态检查和回归；本轮源码门禁与162后端/58UI全部通过，详见7.30。运行中的Docker、本机账号/源/订阅未替换；下方9dbf42c及7.27仍是此前已发布版本，不能将它们作为本轮修复的发行证据。

**2026-10-08 本轮交付与换对话**：用户已明确要求“整理仓库，推送代码到GitHub”，本轮包含115统一网盘模块、后台按钮整理及网盘爬虫开发指南。功能已提交并推送main：`9dbf42c0d12db0a0bdd2095a4c8bb3aa362ef16c`。Verify与Docker原生amd64流程均成功，GHCR已发布；固定digest与匿名发布后复验见7.27，全部成功。下文7.17–7.26保留阶段记录，其中“未实现/未授权/未提交/未发布”仅代表当时状态，不是当前结论。

**沟通与操作**：用户不懂编程，请用简单中文，技术安装、配置、测试与排障由助手负责。接手先 `git status`，读 `AGENTS.md` 和本节，再读7.25–7.27；猫影视背景在7.17–7.20。唯一公开交接为本文，忽略的根 `HANDOFF.md` 和 `.tools/` 可能含敏感信息，不能提交。

| 项目 | 当前结论 / 入口 |
| --- | --- |
| Git与发布 | 继续在main，本轮审查修复未提交/推送/发布，见7.30。此前功能源码9dbf42c已推送，Verify/Docker及146原生容器回归通过；固定digest及发布后复验见7.27 |
| 115功能 | 后台“网盘管理”统一扫码账号，标准详情中的115分享/URL编码push链接自动展开；网页、TVBox、猫影视共用宿主网盘服务。当前仅115，不预置搜索站点，不转存/上传/删除网盘文件 |
| 本机Docker | `coketv-local:netdisk-bb046cd4b0a8`，OCI revision为local，基于acbfb1a固定digest的本机派生镜像。54058 healthy；原46源/1订阅/设置/管理密码保留，仅新增私密网盘账号文件。没有因本轮Git推送自动替换本机容器 |
| 本机回滚 | 完整data/src/dist与容器配置备份已移至私有 `.tools/netdisk-deployment-backup-20261008/`；旧 `coketv-local-before-netdisk-1791440886` 已停用且restart=no。不能同时启动共享原data卷的旧/新容器 |
| 其他服务 | 54060 `drpy-reference` 为独立2.0.6参考容器；用户已要求停用并删除54061独立115验证环境及54059旧手机测试环境，两个测试目录及相关临时容器/卷已清理，见7.28。不要恢复这些测试服务或重置Docker context、VM或登录自启 |
| 本机门禁 | 本轮check130语法/187未定义变量/143桥接/37spider与156engine空壳检查；build native loader；162后端+58UI=220全过、0跳过。本轮未做Docker验收；此前本机镜像146回归、五引擎/同卷重启及原生amd64发行证据属于旧版本，见7.25/7.27 |
| 真实115验收 | 用户本人扫码；凭据重启仍有效。私密分享47视频；4K HEVC Main10 MKV开播、切第二集、约21分钟大幅拖动后恢复、重启后重新获取详情/播放通过。拖动有明显缓冲，未做完整影片/声音人工确认或手机网盘解码验收 |
| 开发文档 | `docs/NETDISK_DEVELOPMENT.md` 有标准详情格式、JS/Python片段和排错。没有OmniBox SDK/Runner或可导入的CokeTV SDK；其他SDK能力仅回答研究，没有授权实现 |
| OmniBox研究 | 用户授权研究参考项目并尝试从镜像恢复源码，首轮结果见7.29；原文件、可读前端、Go结构/反汇编与恢复包仅在忽略目录，未接入CokeTV |
| 下一步 | 按用户新要求继续OmniBox研究或功能对照；真实115搜索→详情→网盘播放验收仍待实际源/站点，保留现有源。其他网盘统一账号、声音/手机客户端与转码等没有完成，不自动扩展范围 |
| 固定约定 | 保留五引擎、原协议、发行零预置源、脚本与宿主同权限；管理鉴权依据匹配路由。不得reset本轮成果或用旧GHCR镜像覆盖本机网盘功能 |

本机工具及私密信息：`.tools/container/local-test-info.json`、`.tools/container/CokeTV测试使用说明.txt` 记录当前本机配置，回滚备份路径已更新。旧独立验证和手机预览的会话文件、账号副本、样片与证据已按用户要求删除；下文相关路径仅为历史记录。只在本机读取保留的私密文件，不回显Cookie/密码/测试分享/临时媒体签名，不放入公开文档或每源ENV。

本机默认Vite config bundle曾卡住，已实际通过以下等价门禁；普通新环境/CI仍使用标准build/test，不要把替代参数说成默认命令直接通过：

```sh
export PATH="$PWD/.tools/node/bin:$PATH"
export TEST_PYTHON="$PWD/.venv/bin/python3"
export TEST_PHP="$PWD/.tools/php/php"
npm run check
npm run build -- --configLoader native
npm run test:core
npm run test:ui -- --configLoader native
```

源码门禁不代表镜像发布成功。7.20记录此前猫影视工作流37715845159与匿名发布后复验37716710290成功；它们不是本轮网盘版本的验收。本轮发布结果另见7.27。纯文档补记可用 `[skip ci]`，不能用于跳过代码门禁。

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
- 设置页已移除配置导入/导出入口；“新建实例”和“扫描源目录”位于源管理工具栏，设置页保留“检测环境”。

## 3. 架构

| 文件 | 职责 |
| --- | --- |
| `src/server.js` | Fastify 管理/公开源接口、路由、订阅和代理；鉴权、限流、SSRF 守卫都在这层 |
| `src/store.js` | 原子状态、运行副本、扫描、脚本版本、批量导入回滚 |
| `src/auth.js` | 首装引导码、scrypt 加盐凭据（异步）、旧明文格式登录后迁移、Basic 鉴权 |
| `src/runner.js` / `src/worker.js` | 按需引擎子进程、64 项串行队列、超时回收、Python 守护进程存活探测与退避重启 |
| `src/tvbox-import.js` | 配置读取、分类、相对引用、依赖、预览/提交 |
| `src/playback.js` / `src/media.js` | 最长 12 小时的服务端随机媒体能力票据、请求头、Range/HLS 代理 |
| `src/media-params.js` | 媒体 URL 与 JSON/base64 headers/旧 header 的统一解包及输入验证 |
| `src/runtime-files.js` | spider 框架保留路径清单，启动刷新与空壳检查共用 |
| `src/ssrf.js` | 按 IP 字节判定元数据、内网与白名单，只返回获准的连接地址 |
| `src/outbound.js` | 受检 DNS 地址绑定、宿主 HTTP 逐跳复核与兼容语义 |
| `engine/utils/tvbox-cms.js` | JSON/XML 采集、首页完整封面 |
| `web/App.vue` / `web/WatchApp.vue` | 管理与公开观影 |
| `web/SourceWorkspace.vue` / `web/CodeEditor.vue` | 编辑工作区和 Monaco |
| `web/SourceImport.vue` / `web/WebPlayer.vue` | 导入窗口和播放器 |
| `scripts/check-shell.mjs` | 发行树零预置源断言（spider 逐文件白名单 + 全 engine 内容判定） |
| `scripts/check-bridges.mjs` | `engine/spider/**` 的 ast.parse / php -l / node --check |
| `scripts/container-smoke.mjs` / `container-matrix.mjs` | 空容器检查与原生 amd64 完整矩阵；发布前/后均已通过 |

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
- 原生 amd64 验收来自 GitHub（7.12–7.13）；随后已安装本机 Docker 并兼容运行同一镜像（7.15）。Mac 为 arm64，不能把本机兼容测试说成原生 amd64 验收。
- 未运行原 drpy-node-coder CLI，不宣称使用过。协议样本不代表所有第三方站点、解析器或编码可播。
- 测试数量与文件数以脚本实际输出为准；`docs/DEVELOPMENT.md` 已移除固定计数，并由回归用例防止重新写入。

## 5. 发布现状

**最新发行（2026-10-08）**：猫影视功能 `acbfb1a` 的 [Docker amd64 37715845159](https://github.com/tardlk/CokeTV/actions/runs/37715845159) 已成功；`latest` 与 `sha-acbfb1a` 均为 digest `sha256:9330d3285d1ac11ff276972f3fcc487246c78987e39ca72291ce46eb9384f8ae`。固定 digest 的 [匿名发布后复验 37716710290](https://github.com/tardlk/CokeTV/actions/runs/37716710290) 已成功，发布前/后原生 amd64 均完成 131 项回归及完整容器矩阵。本机 Docker 已按用户授权升级并保留数据，见 7.20。下方 c2a1f21 是此前发行记录。

**当前发行（2026-10-06，本轮已完成）**：PR #1 已合并，源码发布提交 `c2a1f21f9be005e1855bd78b00613033791c0dbb`。源码 [Verify 37458591153](https://github.com/tardlk/CokeTV/actions/runs/37458591153)、[主线构建/验收/发布 37458591100](https://github.com/tardlk/CokeTV/actions/runs/37458591100) 与 [匿名固定 digest 发布后复验 37459488105](https://github.com/tardlk/CokeTV/actions/runs/37459488105) 均 success。`ghcr.io/tardlk/coketv:sha-c2a1f21` 与 `:latest` 同 digest：`sha256:c269b482eddaff2668a43773b82fcd98f23c89b90bd48542eb4a2a6b95c8d1a2`。匿名 manifest/config 与容器实跑确认 linux/amd64、User=node/UID 1000、OCI revision 为该源码 SHA；R1–R10 和媒体头修复均已包含。详细身份/产物/测试证据见第 7.13 节。下列首次发布与旧同步记录保留为历史，不表示当前 latest。

- 2026-10-05 首次发布：功能提交 `3b17276`，源码 [Verify 37252776598](https://github.com/tardlk/CokeTV/actions/runs/37252776598) 与 [Docker amd64 37252776569](https://github.com/tardlk/CokeTV/actions/runs/37252776569) 均成功。
- 历史镜像 `:sha-3b17276`，当时同 digest 发布为 `:latest`：`sha256:8e733b3cc506be4682015e9df004ba9b3705f31c058d9da263e28dbfa049461c`（匿名读取 manifest/config 确认 `linux/amd64`）。独立拉取验收：[Verify published image 37253476492](https://github.com/tardlk/CokeTV/actions/runs/37253476492)。这个 digest 只代表旧发布，不能据此断言当前 latest 的版本。
- **2026-10-06 历史源码同步**：用户明确授权推送。GitHub `main` 的代码快照为 `984ccf0ff2ed2d0f63c96f2f5b7b2098cba023d3`，Git tree 与本地整理后的 `da3ce44` 完全相同（`eed21e5c7d44212cec56f80ee0b2ba08cc3f708c`）；包括此前 9 个未推送提交、本轮限流修复和接手审查记录。原始本地 11 个提交保留在 `handoff-local-20261006`，本地 main 已跟随远端。收尾文档补记使用 `[skip ci]`，不重复发布相同代码。
- **历史 CI / 镜像状态（当时已核对）**：[Verify 37429832617](https://github.com/tardlk/CokeTV/actions/runs/37429832617) 与 [Docker amd64 37429832738](https://github.com/tardlk/CokeTV/actions/runs/37429832738) 均成功；后者的源码检查、发布前空容器验收、镜像发布三个步骤分别为 success。已发布 `ghcr.io/tardlk/coketv:sha-984ccf0` 与 `:latest`，两者 digest 相同：`sha256:8329ad339a36d81e6bfc7771104f0a9d106a8e08a210c5bbbbad9e8e255488f0`。匿名读取 manifest/config 确认 `linux/amd64`、`User=node`、revision 为 `984ccf0ff2ed2d0f63c96f2f5b7b2098cba023d3`。
- 上述历史 984ccf0 发布没有本机 Docker 或发布后五引擎/重启拉取复验，也未修复 R1–R10。本轮 c2a1f21 已通过完整发布前/后矩阵；发布当时本机无 Docker，这两组证据来自 GitHub 原生 amd64。随后新增的本机兼容运行部署见 7.15。
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

接手时 `main` 领先 `origin/main` 9 个提交的描述是历史快照。本轮限流修复的本地提交是 `a0882c2`，其内容现已同步到 GitHub 代码快照 `984ccf0`；本地 main 已跟随远端，原本地提交保留在交接分支。源码同步/镜像结果见第 5 节与第 7.4 节。**R1–R10 已修复并发布**，见第 7.5–7.8 节；第 7.1 节第 3 项媒体头兼容也已本地修复（第 7.10 节），第 4 项管理员锁出行为保持原产品约定；原生候选验收、main 合并、正式镜像发布及匿名发布后完整复验已完成（第 7.12–7.13 节）。当前发行见第 5 节，辅助分支与重复检查点引用已清理，只保留 main（7.14）；管理员锁出和第 7.2 节长期工作仍不变。

### 7.1 原待办处置（前三项已完成，第 4 项维持现状）

本次接手逐条核对：接手时四项原待办均存在；现已完成第 1、2、3 项（第 3 项本地验证见 7.10），第 4 项维持现状并单独作产品决策。编号保持不变，便于对照原接手要求。

1. **限流豁免范围过大（中，已修）**：修复前 `probe15` 在 `RATE_LIMIT_PER_MINUTE=5` 下复现 `/watch/sources` 4×200 后 429；带匿名媒体票据的 `/proxy/<id>/` 12×200、0×429，后续又驱动 30 次引擎执行。原因是任何有效票据都豁免，而媒体票据在 `/proxy/:module/*` 只绑定源、不绑定 URL。
   - 当前仅 GET/HEAD 媒体转发路由（`/mediaProxy`、`/req/*`、`/m3u8-proxy/{playlist,ts,proxy}`、`/unified-proxy/proxy`、`/file-proxy/proxy`）中，票据有效且 `kind === 'proxy'`、目标 URL 与票据一致时豁免。`/proxy/:module/*` 及其他公开接口照常计入原 IP 桶，默认 1200/min；不变更媒体票据的源代理兼容权限。
   - 限流按匹配路由判断，避免百分号编码路径与 absolute-form 形态跳过计数。`SECURITY.md` 与 `docs/CONFIGURATION.md` 已纠正票据范围和豁免说明。
   - 修复后同一 `probe15`：带媒体票据的 `/proxy/` 12×429、0×200，后续引擎执行数为 0。
   - `tests/rate-limit.test.js` 修复前实际失败（期望 429，实际 200），修复后通过：预算内源代理返回正常；预算耗尽后拒绝且不执行引擎；编码/absolute-form 不能绕过；HLS 分片/key 高频 GET、HEAD、Range 与 base64 目标保持可用；票据换目标/挪到其他路由不豁免；源代理 `toBytes=2` 302 补签仍可匿名跟随。
2. **`docs/DEVELOPMENT.md` 计数陈旧（低，已修）**：接手时仍写 `114 项测试（66 后端、48 UI）、117 个文件语法检查`。已删除固定计数，指向 `npm test` / `npm run check` 实际输出及本文件第 4 节的验证记录。`tests/documentation.test.js` 在原文上实际失败，修订后通过，防止“当前验证”重新维护固定测试/语法文件计数。
3. **`/mediaProxy` 与 `/proxy` 的头处理不一致（已发布）**：以下保留原复核证据；当前实现与新增失败/通过回归见第 7.10 节。审查时 `/proxy` 已能解包旧基类 `header`+`form=base64` 并补签票据，而直接请求 `/mediaProxy?url=…&header=<b64>` 仍只认 `headers`（复数 JSON），且只有订阅 Token 路径读调用方头，`admin`/内部运行时拿到的头恒为 `{}`。若源在服务端自行拼 `mediaProxyUrl` 就会丢头。建议把 `unwrapMediaProxyContent` 的解包逻辑复用到 `/mediaProxy`。本次在临时目录和固定 HTTP 上游复核：订阅 Token + `headers` JSON 的 Referer 可透传；订阅 Token + `header` base64、管理员 + `headers` JSON、内部运行时 + `headers` JSON 均丢失 Referer（四条请求均为 200）。该审查阶段未修改此行为；后续本地修复已完成。
4. **管理员锁出边界（提示）**：失败预算按 IP 20/min，耗尽后**同一 IP 即使给正确密码也 429**（已测试、已文档化）。`TRUST_PROXY=1` 且前置代理不覆写 `X-Forwarded-For` 时，可被伪造 IP 用来把管理员锁在 `/admin` 外（每 60 秒窗口需重新打满 20 次）。可选改进：只对失败计数、成功凭据始终放行。本次核对守卫仍在校验密码前检查失败预算；完整测试中的 `P0-3` 用例再次确认预算耗尽后正确密码也 429。本次未修改此行为。

本次限流修复阶段的实际验证（2026-10-06，收尾推送前的历史记录）：

- 新增两条回归在修复前实际失败：限流用例期望 429、实际 200；单跑 `node --test tests/documentation.test.js` 检出陈旧计数。修复后 `node --test tests/rate-limit.test.js tests/documentation.test.js` 2/2 通过。
- `node ../coketv-audit/probe15-ratelimit-exempt.mjs`：修复前后均运行，结果见第 1 项。
- `npm run check && npm run build && TEST_PYTHON=python3 TEST_PHP=php npm test`：全部通过；118 个宿主/辅助文件语法、143 个桥接文件语法、空壳发行检查、生产构建；124 项测试（75 后端 + 49 UI），无失败或跳过。五种引擎固定样本均通过。构建仍有大于 500 kB 的 chunk 提示。
- 未做 Docker/容器验收、外部站点播放、原 drpy-node-coder CLI 或新的 `npm audit`；未修改用户 `data/`，未 push、未发布或重建镜像。

### 7.2 仍需产品决策或专项排期的事项

- **每源隔离方案**：当前所有源共用 worker，源可读文件系统、ENV 和内部凭据，这是 AGENTS 已确认的同权限信任边界。每源进程隔离尚未实施；单独进程也不自动提供沙箱。任何权限收紧需要先作产品决策、评估五引擎与动态 require/辅助库兼容，不能直接删掉现有能力后宣称问题已解决。
- **供应链**：`.github/workflows/*.yml` 的 `uses:` 全部是浮动 tag，未钉 commit SHA；`engine/spider/py/base/requirements.txt` 无版本约束与 hash；基础镜像 `node:22-trixie-slim` 未钉 digest。
- **原“发布门强度”待办已完成**：五引擎、升级、实际 Range/HLS/分片/key、私密配置与同卷重启已移入发布前完整矩阵，发布后匿名固定 digest 复验也通过（7.12–7.13）。不要再登记成“只返回媒体地址”或“没有容器 Range/HLS 覆盖”。额外人工故障注入 CI 尚未执行；PR publish skipped 与本地条件回归已有证据。
- **兼容辅助模块整理**：旧审查曾列出约 19 个静态零引用文件，名单与“死代码”判断需重新复核；用户源可以按原模块名动态导入，零静态引用不等于可删除。保留兼容 API 面，必要时在 THIRD_PARTY 说明来源，不凭旧名单裁剪引擎。单独的 utils/with-timeout.js 当前仍无静态接线，PHP 进程回收实际由 execFile timeout/killSignal 完成（已回归）；不要把未接线辅助文件当成已生效机制。
- **`fServer` 兼容缺口**：`src/worker.js` 注入的 `fServer` 是只回 404 的裸 `http.createServer`，而 `src/server.js` 把 WebSocket upgrade 转发到同一端口；上游 drpy-node 里 `fServer` 是带 websocket 的 Fastify 实例。依赖弹幕 WS 的源不可用。
- **测试隔离与覆盖**：`tests/integration.test.js` 多用例共享同一 `app/store`，`tests/tvbox-import.test.js` 存在先后用例依赖；本轮未运行随机顺序或逐条隔离矩阵，不把“单跑必失败”作为新实测结论。仍需专项覆盖 `/parse/:jx` 的 parse type=2、`/ftp/*`、`/image/upload`、`/admin/subscriptions/:id/token`及更完整的 ZIP 恶意包场景。`state.json`/`env.json` 损坏拒绝启动、字节保留已经有发布前/后容器验证；不要重新标为零覆盖。旧记录把 `/file-proxy` 与 `bytes===2` 重定向列为零覆盖已经过时：当前 `rate-limit.test.js` / `proxy-headers.test.js` 已覆盖对应固定样本。

### 7.3 全面接手复核（2026-10-06，历史发现；R1–R10 现已发布）

用户要求对照原始仓库判断其他 AI 修改是否正确。本次以 GitHub `tardlk/CokeTV` 的远端 `main`（只读 `git ls-remote` 确认为 `ae89c27570537c8931f0747a3c2185880a6b94e3`）为基线，核对本地 `HEAD=544a618` 之后的工作区及领先远端的 9 个提交。审阅管理/订阅/媒体鉴权、票据与限流、出口策略、Store 升级与私密配置、五种引擎桥接、导入、前端变更、Docker 和三个工作流，以及测试断言与旧版实现。

结论：管理鉴权改用匹配路由、异步 scrypt、票据防篡改和 URL 绑定、源返回头透传、Python JSON 协议、空壳检查的方向正确；**现有测试全绿不能证明升级兼容或安全修复全部完成**。以下编号 R1–R10 均有独立临时样本复现；既有新增回归，也有原问题或新增防护没有闭环，不能全部归因于本轮改动。表中问题定位与证据保留审查时快照；R1–R10 的本地修复状态与新增回归见最后一列及第 7.5–7.8 节；第 7.1 节保留项、长期工作及容器验收另计。

| 编号 / 优先级 | 问题与定位 | 实测证据 / 来源 | 修复与回归要求 |
| --- | --- | --- | --- |
| **R1 / P1（已发布）** | 旧数据升级不会更新框架桥接：`src/store.js:30` 仅在目录不存在时复制 `runtime/spider`，但会刷新 `libs`；新版 PHP 调用 `localProxy\|proxy`，旧桥接不认识候选名，Python 安全更新也未落到运行副本 | `probe17`：全新目录 PHP 代理 200；放入远端旧桥接后重启当前宿主，代理 500，运行副本仍含 `pickle.loads(payload)`；实例状态、用户脚本和每源 ENV 保留。旧复制策略与新版协议组合形成升级回归 | 已按 `src/runtime-files.js` 的框架保留路径逐文件原子更新桥接/基类/辅助库。`tests/runtime-upgrade.test.js` 从 ae89c27 冻结桥接升级，PHP 代理 500→200，Python 接受 JSON 并拒绝无害 pickle 入站，五引擎执行和用户文件/状态保留通过 |
| **R2 / P1（已发布）** | 匿名票据泄露上游凭据：`src/playback.js:33–36` 用 base64url 明文 JSON 加 HMAC，载荷包含源返回的 `headers` | `probe16`：匿名 `/play` 返回的票据可直接解码出源从 ENV 取得的 Cookie 和源返回的 Authorization。HMAC 保证完整性，不提供保密性；远端旧版随机票据没有该载荷，属于新增回归 | 已改为 256 位随机、43 字符的服务端能力引用，保留 kind/source/URL/headers/expiry 约束；最长 12 小时、50000 条/64 MiB 载荷容量，淘汰最旧记录。新增回归覆盖匿名播放与 HLS 票据不可解码凭据，实际上游 Cookie/Authorization 透传、范围、篡改、过期、容量回收 |
| **R3 / P1（已发布）** | IPv4 映射 IPv6 绕过内网与元数据判定：`src/ssrf.js:19–24,58` 未把规范化的十六进制 IPv4 尾部转换成 IPv4；元数据仅按文本比对 | `probe16`：关闭内网时普通回环媒体 403，`[::ffff:127.0.0.1]` 媒体 200 并取得自建临时上游内容。映射元数据地址通过守卫，而普通元数据地址 403；**未向真实元数据服务发请求**。新增防护不完整 | 已按 IP 字节统一分类，将点分/十六进制映射 IPv6 归为 IPv4。回归覆盖直接地址、展开形式、DNS、白名单、本机 origin 豁免与重定向；内网关闭后的映射回环媒体 200→403，映射元数据永久拒绝，不访问真实元数据服务 |
| **R4 / P1（已发布）** | DNS 检查与连接分离：`src/ssrf.js:55,65` 返回解析地址，`src/media.js:46,53` 丢弃结果并让 HTTP 客户端再解析 | `probe16`：受控模拟守卫解析返回公网地址、实际连接解析为回环，关闭内网后仍取得临时上游 200。**这是模拟两次 DNS 答案不同，并非真实外部 DNS rebinding 攻击测试**。新增防护不完整 | 已通过 `pinnedLookup` 将媒体与 `/http` 每跳的新连接绑定到受检地址，IP/CIDR 名单只返回匹配地址。受控两次 DNS 样本的未经检查回环连接数 1→0；实际 Host/TLS SNI、证书验证、IP+Host 虚拟主机、Range/HEAD/HLS 和环境代理对照通过 |
| **R5 / P1（已发布）** | PHP 失败向匿名用户泄露源参数：`engine/libs/php.js:62–67,99–101` 原样抛出带完整命令参数的 execFile 错误，`src/server.js:48–50` 原样发送；现有 ENV 脱敏未覆盖 params | `probe18`：普通 PHP 首页抛异常，匿名首页返回 500，响应包含固定样本的私有 params 和 sourceEnvPath。远端已有该错误链，属于旧风险未闭环 | 已解析桥接 stdout 错误信封，不上抛/记录原始 execFile Error。接口固定 `PHP 源执行失败`；管理诊断保留原因/方法，遮蔽原始/JSON/URL 参数、嵌套/短值/数字 ENV 与私密路径。普通异常、初始化、解释器/非 JSON 失败、Warning、lastCheck 与后续正常源通过回归 |
| **R6 / P2（已发布）** | `/http` 只检查首跳：`src/server.js:601–607` 之后由 axios 自动跟随重定向，无出口复核 | `probe19`：白名单只含临时上游的域名，直接请求未列入名单的回环 IP 403；域名 302 到同一上游的 IP 后 `/http` 返回 200，而 `/mediaProxy` 同类重定向 403。需管理、内部或订阅凭据，**并非匿名 `/http` 绕过**；实际 POST 携媒体票据仍为 403。新增防护不完整 | 已用 `guardedHttp` 手动逐跳检查/绑定 DNS，默认最多 21 次、允许设置 0–21，0 返回首跳；禁止环境代理重新解析。固定上游回归首跳域名允许、跳转 IP 被拒 200→403，同域 DNS 新元数据答案也在连接前拒绝；方法/请求体/头/参数/响应与原 Axios 语义对照通过 |
| **R7 / P2（已发布）** | 长播放地址变成不可访问的媒体票据：`src/playback.js:35,51` 把整个 URL/headers 放入路径，`src/server.js:44` 路由参数最大 4096 | `probe16`：合法固定媒体 URL 仅附 4000 字符签名参数，播放解析 200，票据长度 5640，随后媒体请求 414；短地址对照 200。旧随机短票据不受此影响，属于新增回归 | 已与 R2 一并改为短引用，不截短 URL/头、不提高路由参数限制。新增回归实际跟随带 4000 字符签名参数的媒体 URL，Range 414→206，HEAD 200，完整上游 URL 保留 |
| **R8 / P2（已发布）** | 全局 ENV 的 0600 没覆盖宿主保存：`src/store.js:56–59,72–74` 原子写入临时文件未指定权限 | `probe18`：当前机器 umask 下全新全局 ENV 为 0644；先设为 0600，再调用宿主 `syncEnvironment()` 又变回 0644。旧宿主写法仍在，历史 M5 仅覆盖引擎写入路径 | `Store.atomic` 支持创建模式；全局/每源 ENV、state、插件配置和管理凭据保存显式 0600，从临时文件创建起生效。首次、设置/导入、反复替换、重启及引擎全局/每源 ENV.set/delete 回归通过，旧全局 ENV 0644 在宿主同步后为 0600 |
| **R9 / P2（已发布）** | PHP 方法选择并非完整的“最派生”：`engine/spider/php/_bridge.php:83–93` 仅排除 BaseSpider，遇到第一个非 BaseSpider 候选就停止 | `probe18`：中间父类声明 localProxy（404），Spider 自己重写 proxy（200）；当前选择父类并返回 404。远端直调 proxy 可命中子类，属于新增兼容回归 | 已比较完整继承链中声明类到 Spider 的距离，最近优先，同层按候选顺序。多层父类/子类、无 BaseSpider、trait、同层倒序、纯继承默认 404 与宿主源代理回归通过；原 404→200，显式单方法调用和既有别名行为保留 |
| **R10 / P2（已发布）** | 哈希凭据升级后 CLI 验证失效：`scripts/verify.mjs:8–9` 仍读取 `admin.json.password`，v2 格式没有这个字段 | `probe20`：临时 GUI 设密后，按文档运行实际 verify CLI（无 ADMIN_PASSWORD）退出 1；同一 CLI 显式提供正确密码，首页/分类/详情通过。哈希迁移带来的新增兼容回归 | 已移除客户端读取 admin.json，支持隐藏终端输入、环境 ADMIN_PASSWORD 和优先的 --password-stdin。实际 CLI 在 GUI v2、无本地文件的远端访问、旧凭据迁移后均完成首页/分类/详情；无凭据/空输入先失败不发请求，错误密码被拒，真实终端不回显且取消后恢复模式 |

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
- **当时的测试服务（历史，存活待核对）**：本机 `http://127.0.0.1:54058` 保持运行，首页、后台、健康接口实际返回 200；使用独立临时 DATA_DIR，未启动或改写仓库正式用户 data。测试数据保留，不要为清理仓库而删掉。仓库外 `../coketv-audit/preview-session.json` 记录 PID 与测试数据位置，不含密码或初始化码；换对话后先确认进程是否仍在，避免重复启动或覆盖测试数据。该记录与全部探测脚本都不提交。
- **提交/推送状态**：源码和接手文档已同步到 GitHub，本地 main 已与远端一致；原本地提交保留在 `handoff-local-20261006`。本机 Git HTTPS 没有登录凭据、也没有现成 SSH 身份，本次使用已登录且有仓库写权限的 GitHub 连接追加快照提交，未强推或覆盖原远端历史；以 Git tree 相等核对全部文件内容和权限。下一轮推送需使用该连接或先配置正常 Git 登录，不能因为认证失败强制改写远端。CI/镜像发布已成功并回填 digest，详见第 5 节；本次收尾纯文档补记标记 `[skip ci]`，这不用于跳过代码变更的验证。
- **新对话按顺序读**：AGENTS → 本文件 → 需要改代码时读正式开发/配置/安全文档。先读取第 7.1 节保留项及第 7.3 节 R1–R10，再结合第 8 节的本机探测脚本继续；当时建议优先 R1、R2/R7；本次已完成这组本地修复，当前状态见第 7.5 节。后续仍保持五引擎和原源协议，先建立能失败的回归再修。

### 7.5 第一组本地接手修复（历史验收：R1、R2/R7）

- **接手基线**：干净克隆 `main`，HEAD 为 `75748f1`，按 AGENTS → 本文件 → 正式文档的顺序阅读。当前修改仅在本地工作区，未 commit、push、发布或重建镜像；第 5 节远端发布记录仍指向此前代码。
- **先失败再修复**：新增 7 条回归。修复前专项运行共 15 项，9 通过、6 失败、0 跳过；旧 PHP 桥接代理期望 200 实际 500，旧 Python 桥接接受 pickle，匿名票据可解码凭据，长播放媒体请求期望 206 实际 414，短引用/容量断言也失败。Python 初次尝试系统 3.9 不支持桥接类型注解，随后改用真实 Python 3.12 重跑并确认是协议断言失败。保留既有断言，没有放宽状态码或跳过测试。
- **R1 实现**：`src/runtime-files.js` 明确登记 spider 框架保留路径，`Store.init()` 每次启动逐文件原子更新；空壳检查共用同一清单。配置目录及清单以外的用户源、辅助文件、缓存、JSON、解析、每源 ENV、订阅与历史保留。`tests/fixtures/legacy-runtime/` 原样冻结 ae89c27 的 PHP/Python 桥接，不依赖网络或 Git 历史、不进入 Docker 上下文。
- **R1 验收**：旧目录升级后的 PHP proxy-only 代理返回 200；Python 实际运行副本的 `recv_packet` 接受 JSON、拒绝无害 pickle 字典。五引擎首页/参数化分类通过；用户源、辅助文件、ENV、状态、订阅 Token/顺序、配置、管理凭据与历史逐字节保留，再次重启仍保留。完整既有五引擎协议矩阵也通过。
- **R2/R7 实现**：媒体与代理票据都是 256 位随机、固定 43 字符的服务端引用，URL/头/范围/expiry 仅留在内存；输入与读取结果不影响已签发范围。最长 12 小时、最多 50000 条与 64 MiB 载荷；签发时清过期、容量不足时淘汰最旧，读取不续期，单条载荷超过总容量返回 503，不截短 URL/头。重启、过期或淘汰后需重新选择剧集。保留 `media` 的所属源代理权限、`proxy` 的 URL 约束，以及此前限流范围。
- **R2/R7 验收**：匿名响应、媒体与 HLS 分片/key 票据不能解码出源 ENV 的 Cookie/Authorization；实际媒体、分片和 key 上游仍收到原凭据。换 URL 被拒绝，篡改/过期/跨会话/跨源/跨路由均不扩大权限；条数及字节容量回收通过。带 4000 字符签名参数和 5000 字符请求头的媒体地址实际 Range 返回 206、HEAD 返回 200，完整目标地址和请求头保留。旧基类 `header` base64 解包、源代理 `toBytes=2/3` 和 HLS 限流兼容回归保持通过。
- **本机环境与完整门禁**：Node 22.23.3、Python 3.12.14、PHP 8.4.23，运行工具/虚拟环境均忽略。`npm run check`、`npm run build`、指定真实解释器的 `npm test` 全部退出 0：119 宿主/辅助语法文件、143 桥接语法文件、spider 37/engine 156 空壳检查；82 后端 + 49 UI = 131 项全部通过、0 跳过。专项修复后 15/15 通过；随后增强长请求头断言，临时还原原票据实现时仍实际复现凭据泄露和 414，再恢复修复并跑完整门禁。构建仍保留大于 500 kB 的 chunk 提示。
- **边界与下一步**：仅使用临时数据目录、自建 HTTP 上游和固定脚本，未改正式用户 data。未做 Docker、容器旧数据升级/媒体转发、真实站点播放、浏览器音视频或原 drpy-node-coder CLI；本次没有执行独立 `npm audit`（npm ci 输出仍为 4 项）。R3/R4/R5/R6/R8/R9/R10 及第 7.1 节第 3、4 项继续待修，下一组建议 R3/R4/R6。发布前仍需容器旧数据升级与真实媒体转发验收。

### 7.6 第二组本地修复（历史验收：R3/R4/R6）

- **先失败再修复**：新增 `tests/ssrf.test.js` / `tests/outbound.test.js` 共 14 条，原实现上实际运行 1 通过、13 失败、0 跳过。关闭内网后映射回环媒体仍 200；映射元数据守卫未拒绝；媒体与 `/http` 的受控第二次 DNS 回环答案都被连接（上游收到 1 次）；允许域名跳转白名单外 IP 的 `/http` 返回 200。同域重定向的新 DNS 元数据答案与环境代理也有失败对照。所有样本使用临时目录和本地上游；模拟受检公网答案的实际拨号在测试中截断，不访问公网或真实元数据服务。
- **R3 实现**：`src/ssrf.js` 将合法 IP 转为字节，IPv4 映射 IPv6 统一按 IPv4 判定。IPv6 压缩/展开、十六进制尾部、DNS 回答、IPv4/IPv6 CIDR 与元数据归一判定；元数据检查在内网开关、白名单与本机 origin 豁免之前。空/无效 DNS 回答拒绝，关闭内网时混合答案整体拒绝；IP/CIDR 名单过滤返回地址，不能因某个答案匹配而连接另一个答案。
- **R4 实现**：新增 `src/outbound.js` 的 `pinnedLookup`，实现 Node lookup 的单地址与 all/双栈回调，连接不再重新解析。媒体每跳使用受检结果和新 socket，`/http` 每跳使用独立 Agent，保留 URL/Host/SNI/TLS 验证。TLS 回归覆盖真实临时证书成功和域名不匹配失败；另发现强制 SNI 会破坏 IP+Host 虚拟主机源（500），已增强断言并保留 Node 原有 SNI 推导，修复后 200，不关闭证书校验。
- **R6 实现**：宿主 `/http` 改为手动逐跳 await 守卫，再绑定地址请求，保留 Axios 参数序列化与响应解析、`{status, headers, data}` 返回格式。默认上限 21 次，`maxRedirects` 允许 0–21，0 返回首跳；整条请求使用同一超时预算。301/302 的 POST、303 的非 GET/HEAD 转为 GET 并移除请求体/相关头；307/308 保留方法与体。重定向移除自定义 Host、更换主机/降级移除 Cookie/Authorization 等，沿用原 Axios 同端口子域保留规则。宿主 `/http` 设置 proxy=false，不允许环境代理二次解析目标。
- **专项验收**：14/14 通过。映射回环媒体在关闭内网时 403；白名单外的映射重定向被拒；受控第二次 DNS 连接数为 0，仍保持 Host、Range、HEAD、HLS 分片/key。`/http` 允许域名跳转禁止 IP 返回 403，禁止目标没收到请求；同域新元数据答案连接前拒绝。无凭据或媒体票据的 `/http` 仍 403。方法/体/头/参数/JSON、text、arraybuffer、零次/超限跳转、跨域敏感头移除、同端口子域保留和环境代理对照通过。
- **完整门禁**：Node 22.23.3、Python 3.12.14、PHP 8.4.23；`npm run check`、`npm run build`、指定真实解释器的 `npm test` 全部退出 0：120 宿主/辅助语法文件、143 桥接文件、spider 37/engine 156 空壳检查；96 后端 + 49 UI = 145 项通过，0 跳过。五引擎、第一组升级/票据、源代理 `toBytes=2/3`、旧媒体头协议与限流回归保留；构建仍有大于 500 kB chunk 提示。
- **范围与下一步**：没有修改用户 data；未 commit、push、发布、重建镜像或做 Docker/真实站点/浏览器音视频/drpy-node-coder CLI 验收，未新跑 npm audit。源脚本仍同权限执行，宿主出口修复不改变该信任边界。当前 R5/R8/R9/R10 及第 7.1 节第 3、4 项待修；先做 R5/R8，再做 R9/R10，仍先失败回归再修。发布前仍需容器旧数据升级与媒体转发验收。

### 7.7 第三组本地修复（历史验收：R5/R8）

- **先失败再修复**：新增 `tests/private-data.test.js` 六条，修改前实际六条全部失败、0 跳过：普通 PHP 首页匿名响应含 URL 编码的私有 params，诊断泄露原始参数，初始化异常含完整 execFile 命令；全局 ENV 首次/设置保存/引擎写后宿主同步的 mode 为 0644（420），期望 0600（384）。新增 `tests/source-env.test.js` 一条辅助回归，逐步检出 JSON 数字参数、被覆盖的全局值、短/数字 ENV、异常 Unicode 和固定提示被同名参数改写的问题，均先失败再修复。
- **R5 实现**：`engine/libs/php.js` 在 execFile exit(1) 时解析 stdout 的 `{error, traceback}`；不再日志/上抛包含 cmd/argv 的原始 Error，成功协议结果和超时预算保留。普通调用、初始化、缺失解释器和非 JSON 进程失败统一返回 `PHP 源执行失败`；诊断记录异常原因/方法、经脱敏的 stderr/trace。worker 对该固定错误保持常量，不因参数恰好包含“失败”等词改变公开提示。源模块加载日志只显示文件名。
- **R5 脱敏**：worker 源上下文增加 params 与私密路径；`redactSourceSecrets` 递归收集原始参数、JSON 子值/数字/布尔值、全局与本源 ENV（含嵌套、短值和被覆盖的全局值），遮蔽原文、JSON 转义与 URL 编码/表单空格形态；运行路径及 realpath 别名一并隐藏。两个 ENV 文件独立读取，损坏一个不禁用另一个的遮蔽；孤立 UTF-16 surrogate 不导致日志 URIError。诊断仍仅管理员可读，源主动返回的业务数据与同权限执行边界保持原约定。
- **R5 验收**：普通 PHP 首页抛错的匿名 500 仅含固定安全提示；原始/编码 params、ENV 值、sourceEnvPath、运行目录和解释器命令均不在响应与诊断中。Warning/异常诊断保留 `fixture business error` 和方法，私密部分显示 `[已隐藏]`。admin verify 的 lastCheck 只保存安全错误；未鉴权日志 401；异常后正常 PHP 源仍执行成功。初始化、缺失解释器、使用 Node 触发非 JSON 进程失败均返回固定提示。
- **R8 实现**：`Store.atomic(file, content, {mode})` 在创建随机临时文件时指定权限（wx），然后原子替换。全局/每源 ENV、state.json、插件配置和管理凭据的宿主保存均传 0600；普通框架/脚本写入仍用原默认权限。现有引擎全局/本源 ENV 的 0600 写入保留，宿主后续同步不再倒退为 0644；后置 chmod 的兼容调用仍保留，但实际保密权限不依赖它。
- **R8 验收**：在 umask 000/022 下观察替换前临时文件和目标，私密文件均 0600。覆盖首次创建、旧全局 ENV 人为改为 0644 后同步、反复保存与 Store 重启、GUI 设置/每源 ENV、配置导入、管理凭据保存；值保留。真实 JS 源本源 ENV.set/delete 和独立临时 runtime 中全局 ENV.set/delete 后，宿主同步/重启仍保持值和 0600，没有写发行 engine/config 或正式 data。
- **完整门禁**：专项 `private-data + source-env` 8/8 通过（7 条新增 + 1 条既有）。Node 22.23.3、Python 3.12.14、PHP 8.4.23；`npm run check`、`npm run build`、指定真实解释器的 `npm test` 全部退出 0：120 宿主/辅助语法、143 桥接语法、spider 37/engine 156 空壳检查；103 后端 + 49 UI = 152 项全部通过，0 跳过。五引擎和前两组升级/票据/出口回归保留，构建仍有大于 500 kB chunk 提示。
- **范围与下一步**：仅临时数据和固定脚本，未修改用户 data；未 commit、push、发布、重建镜像、做 Docker/外部站点/浏览器音视频/drpy-node-coder CLI 或新 npm audit。下一组仅剩 R9/R10；第 7.1 节第 3、4 项另计。发布前仍需容器旧数据升级与真实媒体/重启持久化验收。

### 7.8 第四组本地修复（历史验收：R9/R10）

- **先失败再修复**：`tests/bridge.test.js` 新增两条，`tests/verify-cli.test.js` 新增四条；正式修复前专项 10 项中既有四项通过、新增六项全部失败、0 跳过。PHP 多层继承返回父类 404，宿主代理期望 200 实际 404；GUI v2 的 stdin CLI 退出 1；stdin 未覆盖错误环境凭据；无非交互凭据时旧 CLI 自动使用本地明文（退出 0 并执行源）；旧格式迁移后第二次 CLI 失败。后续新增真实伪终端回归，临时还原原 verify 时没有密码提示、实际失败，再恢复修复；还检出在终端直接使用 --password-stdin 没有隐藏提示会挂起，修复后终端也使用隐藏输入。
- **R9 实现**：`engine/spider/php/_bridge.php` 遍历 Spider 完整父类链，比较候选方法声明类的继承距离；最近声明优先，相等时保持候选原顺序，删除只排除 BaseSpider 的特例。方法名/参数/自动 init 与返回协议不变，单方法调用保持直接调用。
- **R9 验收**：桥接矩阵覆盖祖先 localProxy/子类 proxy、无 BaseSpider 多层继承、父类 proxy/子类 localProxy、父类同层实现、纯继承 BaseSpider 默认 404、trait、同层候选倒序；宿主实际代理由 404 变为 200。既有 proxy-only/localProxy-only、别名、未实现方法与默认 404 回归保留，R1 启动更新桥接仍通过。
- **R10 实现**：verify CLI 不再读取 admin.json 或 DATA_DIR，不恢复/保存明文或逆推哈希。终端不回显输入；非交互支持 `ADMIN_PASSWORD` 或 `--password-stdin`（显式 stdin 优先）。管道 stdin 到 EOF，只移除一个尾部 LF/CRLF，首尾空格/Unicode/冒号保留；终端直接使用 --password-stdin 也走隐藏提示，交互可退格、Ctrl-C/Ctrl-D 取消并恢复终端模式，输入上限 4096 UTF-8 字节。缺少凭据/空密码在发送请求前失败。源 ID、可选服务地址、Basic 鉴权及首页/分类/详情诊断协议保留，增加 --help；正式开发/安全说明同步。
- **R10 验收**：实际执行仓库 verify CLI，GUI v2 哈希下 stdin 成功、凭据文件字节与 0600 保持；没有本地 admin.json 的服务访问成功；stdin 覆盖错误环境密码。无凭据不会使用诱饵明文文件，空输入不发请求；错误密码仅触发一次鉴权、未启动源。旧明文成功登录后服务端迁移 v2，再次 CLI 成功且不恢复明文。Python pty 驱动真实终端验证默认和 --password-stdin 两种模式的 Unicode/首尾空格/冒号/退格登录、不回显密码或 Basic 凭据、取消退出 130、不发 API 请求、ECHO/ICANON 恢复；只用临时目录与固定凭据。
- **完整门禁**：新增共七条回归，最终 `npm run check`、`npm run build`、指定真实 Python/PHP 的 `npm test` 全部退出 0；120 宿主/辅助语法、143 桥接语法、spider 37/engine 156 空壳检查；110 后端 + 49 UI = 159 项全部通过，0 跳过。五引擎及前三组回归保留；构建仍有大于 500 kB chunk 提示。测试环境仍为 Node 22.23.3、Python 3.12.14、PHP 8.4.23。
- **当前状态与范围**：R1–R10 全部在本地修复；没有修改用户 data，未 commit、push、发布或重建镜像；未做 Docker/真实站点/浏览器音视频/原 drpy-node-coder CLI，也未新跑 npm audit。第 7.1 节第 3、4 项和第 7.2 节长期工作保留；容器旧数据升级、真实媒体转发与重启持久化仍须验收，不能把本机源码全绿视为镜像验收完成。

### 7.9 历史执行计划（阶段 0–4 已完成，证据见 7.10–7.13）

以下保留制定时的计划；本计划完整执行后的当前结果见 7.13，原配置准备阶段见 7.10；不要把历史计划作为当前待执行清单。制定时基线为 R1–R10 本地修复、159 项测试通过，尚未 commit/push/发布。本机实际检查没有 Docker CLI，因此容器验收使用 GitHub 原生 linux/amd64 runner，不能以本机源码测试替代。顺序为保存基线 → 请求头兼容 → 候选镜像与发布前门禁 → 容器矩阵 → 审查提交与发布 → 发布后复验。

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

### 7.10 本地修复与发布准备（历史阶段，后续已完成发布）

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

### 7.11 工作分支同步 GitHub（历史阶段，分支现已清理）

- 用户本次明确要求推送 GitHub；仅同步工作分支 `work/media-release-gates-20261006`，未合并/推送 main、创建 PR、手动触发容器工作流或发布镜像。main 仍为 `75748f1601f8993b59feefd0cb295990edf12639`。
- 本机 Git HTTPS 缺少登录凭据，直接 push 实际失败；改用已连接的 GitHub 账号创建对应树/提交/分支，没有强推。原本地提交保留于本地原工作分支；远端对应为 `73b4aa3 → 99a6172`、`ab7148e → 5a26dd3`、`5c496d5 → c9f2c34`。提交元数据不同，逐组 Git tree 完全相同；最终源码 tree 为 `5f78d1f72ae00e7518cf64676c3c5b523b40ad22`，fetch 后 git diff 也确认没有内容或权限差异。
- 源码 [Verify 37455466575](https://github.com/tardlk/CokeTV/actions/runs/37455466575) 已由工作分支 push 自动启动；本条记录时状态为 completed / failure。此次没有原生 Docker 结果，不能据此将第 7.9 阶段 2/3 标为完成。
- 本补记仅修改交接文档，使用 `[skip ci]` 避免重复运行同一源码。接下来使用本地 `github/media-release-gates-20261006` 跟踪远端工作分支继续开发；原 `work/media-release-gates-20261006` 保留原本地检查点历史。源码/容器门禁和 main 发布仍按第 7.9 节执行。

- **工作分支 CI 后续修正**：首轮 Verify 的 check/build 成功，后端 119/120 通过、0 跳过；失败仅为 `private-data.test.js` 把 CI 的 `TEST_PHP=php` 命令名当私密路径，误命中源文件 `.php` 后缀。先在本机用 PATH 命令形式实际复现同一失败，再通过真实解释器 `PHP_BINARY` 取得绝对路径并用于原样保密断言与桥接执行；没有删除/放宽断言、改变宿主错误或跳过测试。命令形式专项 6/6 通过，指定本机解释器的完整 check/build/test 再次退出 0：120 后端 + 49 UI = 169 全过、0 跳过。此修正已同步为远端源码提交 `2e108e91f37e41fca5cf1d017027609411e7a040`，新的 [Verify 37455860875](https://github.com/tardlk/CokeTV/actions/runs/37455860875) 已 success：源码检查、构建和 120 后端 + 49 UI = 169 项测试全过、0 跳过；这是 GitHub Linux 源码验证，原生容器矩阵仍未执行。本机修正检查点保留在 `local-ci-php-checkpoint-20261006`，跟踪分支在远端 tree 核对一致后对齐，文件内容保持不变。

### 7.12 PR 原生 amd64 候选验收（历史阶段，PR 现已合并）

- **授权与执行**：用户明确要求执行原生 amd64 容器验收。已建立 [PR #1](https://github.com/tardlk/CokeTV/pull/1)，保持 draft；只读候选工作流 [Docker amd64 37456713645](https://github.com/tardlk/CokeTV/actions/runs/37456713645) 在 GitHub 原生 Ubuntu 24.04 x64 runner 实际构建并运行容器，整体 success。candidate 的源码门禁、构建、完整容器矩阵、原镜像保存和 artifact 上传均 success；publish job 确认为 **skipped**，没有 GHCR 登录/推送、main 合并或正式 data 操作。本机仍无 Docker，不能将此描述为本机容器验收。
- **源码与镜像对应**：PR head 为 `510c5a2611a6ba3109a7160705cb16d06ca63469`；GitHub 实际 checkout/OCI revision 为 PR 合并候选 `5f58431d8058b413488e87a3c27d28db7d2e66e6`。fetch 该 merge ref 后确认两者 Git tree 同为 `3e93cbe0d2a4f0d766a9278afa70c487d291badd`，git diff 为零。镜像 ID 为 `sha256:2cb7005bdc866699f60aee8823ab2fe3a9f3a5de2cc970b5aaa1587ffb84900e`，平台 `linux/amd64`，实际 UID `1000`；Node `v22.23.3`、Python `3.13.5`、PHP `8.4.26`。这是候选 image ID，不是已发布 GHCR digest。
- **完整矩阵实际通过**：全新空数据/零源/空默认配置、首装引导码、管理/订阅边界、非 root 和正式 CLI；五引擎首页/分类/搜索/详情/代理/CLI 与实际 GET/HEAD/Range 206、Content-Range/字节、HLS 主子列表/分片/AES key；同卷 Docker 重启后脚本/实例/参数/ENV/配置/订阅/凭据/版本历史快照、旧票据失效及五引擎媒体复验。冻存 ae89c27 桥接升级、PHP 代理/Python JSON 入站及无害 pickle 拒绝、用户内容/ID/Token/顺序保留、私密 0600/异常脱敏、票据与出口/长媒体/头矩阵/CLI 等容器回归全部通过。独立坏 state/ENV 卷实际拒绝启动且保留原字节；旧 root 属主卷实际失败，按 README chown 1000:1000 后恢复并通过 smoke。所有场景仅一次性容器/卷或容器内独立临时目录。
- **测试与产物核对**：候选任务源码门禁 120 后端 + 49 UI = 169 全过、0 跳过；容器内 17 个回归文件的 TAP 为 **116/116，通过、0 失败、0 跳过**（不含只在源码 CI 检查的文档/工作流四条用例）。`report.json` 的 completed=true、六组检查清单与解释器/UID/镜像 ID 已核对；下载证据 ZIP 并实际校验 SHA256 与 GitHub artifact digest 一致，进一步核对其中 TAP，而非只看工作流 success。
- **候选产物**：[candidate artifact 11410585112](https://github.com/tardlk/CokeTV/actions/runs/37456713645/artifacts/11410585112)，ZIP SHA256 `b029f14b1009d01c613b26fef200742f2f7a1e3b2d897906ee37193ab41faf8b`，包含原 image.tar、tar 校验文件、image ID 与源码 SHA；[验收证据 artifact 11410385233](https://github.com/tardlk/CokeTV/actions/runs/37456713645/artifacts/11410385233)，ZIP SHA256 `01609e100174061cde4057811b5e10d2d4fccb2e6b828a457cc90f25b0de0731`，包含 report/TAP/脱敏容器日志。候选 artifact 2026-10-09 到期，证据 artifact 2026-10-13 到期；链接不代表长期保存或已发布镜像。测试写层/卷没有 commit 为发行镜像。
- **本轮收尾与剩余边界**：原生候选首次完整运行即通过，无容器失败需要掩盖或跳过；PR 的只读发布隔离已经实际验证。没有执行额外人工故障注入的失败候选 CI、真实外站/浏览器音视频或 drpy-node-coder CLI。本轮只回填实际验收证据，不改变源协议、管理员锁出或依赖。main/tag 合并与镜像发布仍须另行安排；发布时继续运行门禁并推送该工作流内同一验收 artifact，之后匿名固定 SHA/digest 拉取与完整发布后复验仍待执行。收尾文档提交仅文档，使用 `[skip ci]`，不能把它说成同一 SHA 的重新容器验收。

### 7.13 主线发布与匿名发布后复验（2026-10-06）

- **本次授权与最终审查**：用户明确要求按“最终审查 → 合并 main/自动发布 → 匿名固定 digest 拉取完整复验 → 回填记录”执行。复核 PR 的 42 个改动文件、发行忽略规则、五引擎/源同权限/管理与订阅边界、框架刷新、能力范围、每跳出口、PHP/私密配置/CLI 和 artifact 发布门禁。原生 PR 验收以后仅四份文档变更，没有运行代码变化；工作区干净、data/工具/虚拟环境/私密 HANDOFF 未跟踪。PR 转 ready 后以 expected head `5cd091cff7bad24388c2b75cb13d38d7897919de` 正常 merge，没有强推；[PR #1](https://github.com/tardlk/CokeTV/pull/1) 已 merged，main 发布提交 `c2a1f21f9be005e1855bd78b00613033791c0dbb`，tree `6340e71eaccf01fb496035c99ab21b2ae05807eb`，本机 main 已 fast-forward 同步。当时保留了辅助分支和检查点；现已按 7.14 清理引用，等价内容仍在 main 历史。
- **主线源码与发布前门禁**：[Verify 37458591153](https://github.com/tardlk/CokeTV/actions/runs/37458591153) success；[Docker amd64 37458591100](https://github.com/tardlk/CokeTV/actions/runs/37458591100) 的 candidate 与 publish 均 success。candidate 再次执行源码 check/build/test（169 全过、0 跳过）、原生 Ubuntu 24.04 x64 单次构建与完整容器矩阵，报告 completed=true、116/116 容器回归零失败/零跳过；六组场景同第 7.12 节全部通过。实际 runtime 为 Node 22.23.3 / Python 3.13.5 / PHP 8.4.26，linux/amd64、UID 1000。没有拿 PR 旧镜像绕过本次 main 门禁。
- **同一验收镜像发布**：candidate image ID `sha256:5f6a5b194bd4a76e9714c154f38e3e4054466572d639a59a03282e66594d46a2`。原镜像 save 后的 tar SHA256 为 `eca7bc7f9afe4238277901d4f2f1a30b367c6a87a190237892946b4e45e451d3`；[candidate artifact 11411132610](https://github.com/tardlk/CokeTV/actions/runs/37458591100/artifacts/11411132610) ZIP digest `sha256:e4bb5dc0864121f905305d4b138925ef4ce4c9767469c1314301419739cfdc9a`。publish 实际下载该 artifact，登录前完成 tar 校验（image.tar: OK）、image ID/源码 SHA/platform/OCI revision 核对，load 同一镜像后再登录/push；没有验收后重建或 commit 测试容器。
- **发行身份与匿名元数据实测**：已发布 `ghcr.io/tardlk/coketv:sha-c2a1f21` 与 `:latest`，两者 registry digest 都是 `sha256:c269b482eddaff2668a43773b82fcd98f23c89b90bd48542eb4a2a6b95c8d1a2`。未使用 GitHub/registry 登录凭据的匿名 manifest/config 读取，对响应字节计算 SHA256 并比对 Docker-Content-Digest；确认单一 linux/amd64 manifest、User=node、OCI revision `c2a1f21f9be005e1855bd78b00613033791c0dbb`。config digest 等于上述 candidate image ID，不把 config ID、artifact hash 与 registry digest 混为同一个值。
- **发布后实际复验**：通过已登录 GitHub 页面在 main 触发 `image-verify.yml`，输入固定 `ghcr.io/tardlk/coketv@sha256:c269b482eddaff2668a43773b82fcd98f23c89b90bd48542eb4a2a6b95c8d1a2`；[Verify published image 37459488105](https://github.com/tardlk/CokeTV/actions/runs/37459488105) success。其 docker pull 实际匿名拉取该 digest，随后复用完整原生矩阵：五引擎实际媒体/CLI、空壳/访问边界、旧框架升级/用户保留、同卷 Docker 重启/旧票据失效/媒体复验、私密配置/异常/出口/票据和损坏配置/旧属主恢复均通过；116/116、0 失败/0 跳过。报告的 image ID、source/verification SHA、平台、UID、解释器与发布前完全相同。
- **证据核对与保存**：[发布前证据 11410967699](https://github.com/tardlk/CokeTV/actions/runs/37458591100/artifacts/11410967699) ZIP digest `sha256:01a4310bbe89850c6df7baae8630433dec483f9b1984ca44fc8baccaa7a86a51`；[发布后证据 11410424356](https://github.com/tardlk/CokeTV/actions/runs/37459488105/artifacts/11410424356) ZIP digest `sha256:75e1ba7852019495626e0e14339552d8c654656300062d0c1ab0f121652c95fc`。两份 ZIP 均实际下载、校验 hash 并读取 report/TAP，116 全过零跳过及镜像身份已核对。candidate 产物 2026-10-09 到期，前后证据 2026-10-13 到期；不得当作永久镜像备份。日志初始化码已脱敏，正式 data 未读写。
- **收尾与边界**：本轮阶段 0–4 的既定发布/复验流程已完成。收尾再次 npm audit，仍为已登记四项（runtime node-forge high 无修复版本、其余三个 dev-only），不改依赖。管理员锁出、源同权限边界、五引擎与零预置源约定保持；本机仍没有 Docker，未运行外站/浏览器真实音视频或 drpy-node-coder CLI，也未额外执行故障注入 CI。最后仅正式文档补记，使用 `[skip ci]`，不重复发布相同运行代码；新文档 HEAD 可不同于上述 OCI revision，发行追踪以固定源码 SHA/digest 为准。

### 7.14 分支清理与接手入口整理（2026-10-06）

用户明确要求“删除多余分支，只保留主线，完善接手文档”。开始检查工作区干净、仅一个 main 工作树；PR #1 已 merged，远端工作分支 0 ahead/2 behind。逐个比较辅助分支 Git tree，全部能在 main 历史找到等价提交，没有主线未保存的独有文件内容。

| 已删除的本地分支 | main 历史中的等价提交 |
| --- | --- |
| github/media-release-gates-20261006 | c2a1f21（相同 tree） |
| local-ci-php-checkpoint-20261006 | 2e108e9（相同 tree） |
| local-native-acceptance-record-20261006 | c2a1f21（相同 tree） |
| local-release-record-20261006 | 749fc84（相同 tree） |
| work/media-release-gates-20261006 | c9f2c34（相同 tree） |

GitHub 的 work/media-release-gates-20261006 已通过分支页 Delete branch 删除，页面显示 Deleted/Restore；git ls-remote --heads 再确认仅 main。五个本地辅助分支已删除，fetch --prune 清掉 origin/work 和仅供 PR 验收的 origin/pr-1-acceptance 缓存。最终本地分支只有 main，远端跟踪仅 origin/main 与标准 origin/HEAD 别名；PR、main 的提交/代码历史和已发布镜像不删除，不执行 gc、不清理正式 data、工具或旧临时验收目录。

本次实际执行本机 `npm run check && npm run build && npm test`（使用第 0 节指定的真实工具路径），全部退出 0：122 宿主/辅助语法、143 桥接语法、spider 37/engine 156 空壳检查、120 后端 + 49 UI = 169 全过、0 跳过；保留构建 chunk 提示，没有新跑 Docker 或外部站点验收。

本文新增第 0 节当前接手入口，补齐本机实际工具命令、main 与发行 SHA 的区别、验证证据和下一步；纠正发布门/坏配置覆盖仍待执行的旧说法。旧修复与失败/通过证据保留，但明确标为历史，旧分支名不再作为开发入口。本次仅文档整理，用 `[skip ci]` 同步 main，不触发新的镜像发布；7.13 的源码 SHA/digest 与验收结论保持。

### 7.15 本机 Docker 部署与实际浏览器播放（2026-10-06）

- **授权与隔离**：用户要求“部署这个 Docker，测试一下”，并表示不懂编程；本轮由助手安装运行环境并交付可直接打开的本机测试页面。部署固定 7.13 已发布 digest，不构建/推送新镜像、不创建新分支、不复制或挂载正式 data，也不恢复原站点。运行环境无 Mac 主目录/项目挂载；测试数据只在新建 Docker 命名卷中。
- **实际运行环境**：Mac arm64，Lima 2.2.1 的 VZ Ubuntu arm64 VM（4 CPU/4 GiB）与 Docker CLI/Engine 29.8.2，按 Lima 官方支持的 QEMU user-mode 方式兼容 amd64；未安装 Docker Desktop 或 Rosetta。程序仍以 UID 1000/node 运行，cap_drop=ALL、no-new-privileges。固定镜像 revision c2a1f21 与 registry digest c269b482…保持 7.13 的完整值。Docker 29 containerd store 的 inspect ID 展示 manifest ID，与旧 classic store 的 config ID 形式不同；本轮以固定 RepoDigest、平台、OCI revision 和实际运行核对身份，不据显示差异误称换了镜像。
- **容器协议实际测试**：独立 coketv-check 测试容器执行空数据/首装/边界/模板 smoke、五引擎完整协议/正式 CLI、实际 GET/HEAD/Range/HLS 与同卷重启复验；17 个容器回归文件以 concurrency=2 执行，TAP **116/116、0 失败、0 跳过**。兼容运行速度不同，不改断言、不跳过测试，也不替代已有 GitHub 原生结论。
- **可使用的测试部署**：coketv-local 仅绑定 127.0.0.1:54058；数据卷 coketv-local-test-data、只读样片卷 coketv-local-demo-media，与仓库正式 data 分开。测试源是在运行卷通过管理 API 创建的“Docker测试样片”，发行镜像自身仍零源。公开页面无需密码；后台的随机测试凭据仅保存本机私密说明/会话文件（0600），不写入本文件、Git 或镜像。
- **真实媒体/浏览器实测**：镜像自带 ffmpeg 生成 12 秒、640×360 H264/AAC 样片与 AES-128 加密 HLS（主/子列表、key、TS 分片）。源要求 Referer/User-Agent，上游实际检查；MP4 Range 返回 206/正确 Content-Range 和 128 字节，HLS 主/子列表、16 字节 key、分片和 HEAD 实际请求成功。在本机浏览器实际点击播放，MP4 播放到 12 秒、切第二段后自动播放成功，HLS 解密后播放至约 12.028 秒、640×360、readyState=4、无媒体错误。这是生成样片的解码/播放，不是外部电影站或真实 TVBox 设备验收。
- **重启与自动启动实测**：coketv-local restart 后密码、state、全局 ENV、测试源脚本逐字节 hash 相同，实际媒体恢复；Docker VM stop/start 后源/密码和 HLS 恢复。首次登录自动启动配置在项目 Desktop 路径中失败，未掩盖该失败；运行环境迁到用户专用 .coketv-docker 目录，LaunchAgent 显式设置 LIMA_HOME 后，由 launchctl bootstrap 从停止状态拉起 VM 的通路实际通过、应用 healthy。guest 内 binfmt 服务保持兼容执行支持；未重启/注销整台 Mac，不声称实测过完整 Mac 登录。
- **宿主文档门禁实际情况**：check 通过（122/143/空壳）；标准 build 和 UI 命令本轮在默认 esbuild config bundle 阶段挂起，停止了仅本轮的挂起进程，没有把它报成成功。使用 Vite 已有 `--configLoader native` 后构建 3275 模块成功；后端 120/120、UI 使用同一 native loader 后 49/49 全过、0 跳过。源码、依赖锁文件和镜像未改，也没有删/放宽断言。这组替代命令不等于标准串行命令已直接通过；后续若本机重现，先查日志，不以反复等待代替诊断。
- **交付与运维入口**：打开本机 127.0.0.1:54058；浏览器测试页保留，截图、TAP、私密登录说明与辅助脚本在忽略的 .tools/container 中。`.tools/container/docker-coketv` 指向专用 daemon；start-test/stop-test 辅助脚本仅管理本轮 VM，stop-test 会先取消登录自启。coketv-check 与 coketv-media-prep 已停止，保留测试卷/证据，只有 coketv-local 继续服务。公开交接不包含本机绝对路径或后台测试密码，正式 data 保持未改。

### 7.16 换对话快照与下一步（2026-10-07）

- **本次请求**：用户准备换对话，要求生成接手文档。继续维护这一份公开 AI_HANDOFF，不创建第二份交接报告。本次检查运行状态、复跑文档门禁、完善文档和同步记录，不重启/重装 Docker、不导入新源、不修改正式 data 或重新发布镜像。
- **新检查到的状态**：开始时 main 为 89078c6、工作区干净；本地和 GitHub 仅 main。coketv-local 正在运行、healthy；本机 GET /health 实际 200，返回 ok=true/version=0.1.0。容器仍是 7.13 的固定 digest、User=node，只绑定 127.0.0.1:54058；/app/data 是 coketv-local-test-data 命名卷，/demo 是 coketv-local-demo-media 只读卷，没有挂载仓库正式 data。当前记录不将昨晚的播放测试冒充今天重新完整播放。
- **直接使用**：打开本机 127.0.0.1:54058，选择“Docker测试样片”，点击“Docker测试视频”；里面只有生成的测试视频，不是电影资源库。MP4/HLS、切集、116 容器回归、重启恢复等已执行结果见 7.15。用户若需要真实电影内容，先明确其已有内容来源/配置链接，助手负责导入与验收；不能自行恢复原 300 多源或默认下载来路不明的脚本。
- **私密本机入口**：.tools/container/CokeTV测试使用说明.txt 和 local-test-info.json 都存在、权限 0600，包含测试后台登录信息，只在本机需要时读取，不复制到公开交接、GitHub 或截图。docker-coketv、start-test、stop-test 辅助脚本存在且 0700；播放截图存在。Docker 实际运行状态与 VM 位于用户专用 .coketv-docker，项目 .tools 中只是入口/证据，不能误当缓存删除整个目录。
- **运维注意**：用户级 LaunchAgent 已核对 RunAtLoad=true，LIMA_HOME 指向专用 state；登录自动启动已配置，停止状态通过 launchctl 拉起的实测见 7.15，未重启整台 Mac。coketv-local 是当前交付环境，应保留；coketv-check/media-prep 已停止，仅作测试证据。需要停止时 stop-test 会同时取消登录自启；需要恢复自启时应检查现有 plist 的 LIMA_HOME，不盲目覆盖。除非明确要求，不改全局 Docker context、不删除卷/私密说明或重新设置密码。
- **本次实际复验**：check 通过（122 个宿主语法文件、143 个桥接语法文件、空壳发行检查）；build 使用 `--configLoader native` 成功（3275 模块，保留既有大包警告）；core 120/120、UI 使用 `--configLoader native` 后 49/49 通过，0 失败/跳过。本次未重复运行容器 116 项或完整播放，容器验收证据仍以 7.15 为准。
- **接手后的工作顺序**：先 git status、读取 AGENTS/本节，检查当前服务是否仍 healthy；若用户只是要使用，直接帮助打开页面并处理具体问题。若用户提供内容来源，再在这套隔离测试环境导入测试。正式部署/正式数据迁移、真实 TVBox 设备与外站验收尚未执行，需要明确目标并先备份；长期开发列在 7.2，不自动改管理员锁出、裁剪引擎或触发新发布。

### 7.17 CokeTV 猫影视订阅开发与 iOS Miraplay 验证（2026-10-08，开发验收记录）

- **目标与授权**：用户澄清最终目标是 CokeTV 提供猫影视订阅链接，CatSource 与旁边的资料包只作独立参考，随后明确要求按计划执行。目标 App 为 iOS Miraplay，用户确认 Darklessing/catvod 的参考链接能用，尚未提供精确 App/iOS 版本。没有修改 CatSource、正式 data 或现有 Docker 配置，没有推送/发布。开工时 main 工作区干净；当前新增改动应完整保留。
- **研究依据**：读取本机资料、CatSource、CokeTV 订阅/源/媒体代码，以及 CatPawOpen 固定提交公开接口。静态读取用户 ZIP 和 Darklessing/catvod 提交 `60cc98cf277224797f0bf39415e394c26c46673a` 的四文件，确认 T4 转接；两版各自 MD5 正确但程序不同，没有运行或复制其完整第三方 bundle、站点或网盘代码。
- **实现**：`src/cat-client.cjs` 是仅用 Node 内置模块的 CommonJS 连接程序，串行 `start/stop`、宿主 factory、`127.0.0.1:0`、发现与视频 POST 路由、原生嗅探。`src/cat-subscriptions.js` 按订阅路径提供最终程序/配置/两个 MD5，配置只含版本和私有 endpoint。每次 `/config` 重新取授权 manifest，源/顺序变化无需改变连接文件；原五引擎继续留在服务器执行。分类筛选、中文搜索与页码、多 ID 汇总、多线路/分集保留；只允许读取/播放动作，不接受调用方源参数或 action。
- **权限与媒体**：文件/发现/业务/媒体检查订阅 ID、当前 Token、启用状态和成员关系。媒体随机引用绑定订阅、Token 与源，HLS 变体/分片/KEY/MAP 全部包为同范围媒体地址；源 Cookie/Authorization 留在服务器。文件/业务限流，有效媒体 GET/HEAD 豁免，非法媒体引用不豁免。停用/删除/重置后新请求拒绝，已缓冲或已在传输的数据不追溯清除。网页解析复用服务器设置；无服务器解析时可请求宿主 sniff，未具备能力时明确失败；带源私密头的网页要求服务器解析。后台链接窗口增加“猫影视 / Miraplay”，TVBox 保留。
- **先失败再修复**：新增下载/协议测试首先实际返回 404；UI 新选项测试实际缺少标签；反向代理子路径的源代理媒体实际 404，修复本地回环挂载路径后通过。初批本地全门禁为 133 后端 + 50 UI；初批隔离容器回归为 129/129。不要把早期计数当作最终 HLS 修复后的结果。
- **手机首轮与 HLS 修复**：用户反馈“MP4 可以播放，HLS 不行”。请求记录出现清单 416/206 和后续 403。新增固定 Range 清单与格式后缀两条回归，在原实现上均实际失败；修复为媒体地址保留 `stream.m3u8` 等后缀，猫影视 HLS 清单请求不转发播放器 Range，完整改写后返回；无扩展名清单按实际 Content-Type 在 206 后无 Range 重取一次，MP4/分片的范围语义保留。专项与既有播放/头/限流 37/37 通过、0 跳过；修复后的独立测试服务重启并交付同一订阅链接后，用户明确反馈“hls 可以播放了”及“HLS 已能播放”。因此目标 iOS Miraplay 的四文件导入、站点浏览及生成样片 MP4/加密 HLS 原生开播已由用户确认；精确 App/iOS 版本、播放至结尾、手机拖动/切集/搜索和外站影片原生播放未逐项确认。
- **最终宿主门禁**：指定本机 Node/Python/PHP 后 `npm run check`、`npm run build -- --configLoader native`、`npm run test:core`、`npm run test:ui -- --configLoader native` 退出 0：124 个宿主/辅助语法文件、143 个桥接、spider 37/engine 156 空壳；135 后端 + 50 UI = 185 全过、0 跳过，保留构建大包提示。使用已有 native loader 方案，不宣称标准默认 config bundle 已直接通过。
- **最终本机容器复验**：HLS 修复后重新用固定旧发行镜像创建独立非 root 容器，在启动前仅向其临时写层覆盖本次 src/dist 与注入测试；没有 build/commit/push 镜像。19 个后端回归文件、131/131 通过、0 失败/跳过，独立容器重启健康检查通过；UID 1000、Node 22.23.3。源文件汇总 SHA256 为 `3d0344115abf21a6297a93d7355c85a54d71bba87c620fd2e46283434ff6952f`。Mac arm64 经 QEMU 兼容运行 amd64，不能称为原生 amd64 或正式新镜像构建验收。临时容器已停止，卷与前后两份回归证据保留，原 `coketv-local` 的启动时间未改变且仍 healthy。
- **隔离环境与证据**：`.tools/cat-preview-*/session-info.json`（0600、所在目录私有）记录独立源码测试服务、PID、后台测试密码、手机订阅链接与样片端口；仅本机需要时读取，不放进公开文档/Git。源码服务使用自己的忽略数据目录与端口 54059，手机只开放已鉴权猫影视入口和健康检查；管理入口限制本机。只复制旧 Docker 只读样片卷中的生成媒体到新目录，未复制正式 data；复制清单中的旧绝对 key 地址已改为本副本相对地址，原卷未改。四文件 ZIP、UI 截图、宿主日志、容器 TAP/report 和真实网络报告均在该忽略目录。
- **实际媒体与外站**：下载最终四文件后实际加载 Node 连接程序，生成 MP4 的 Range 206/128 字节/ftyp、HLS 主/子清单、16 字节 AES key 与真实 TS 分片可读。真实非凡采集通过此连接程序取得 31 分类、20 首页条目、分类第 2 页、搜索、详情和播放地址；HLS 清单及首个 `video/mp2t` 数据块/TS 同步字节读取成功。这是网络和协议证据，不代表电影已在手机完整播放或解码。
- **后续边界**：基础手机导入与两种样片开播已完成。搜索/切集/拖动和订阅刷新已有本地协议/界面覆盖，手机逐项操作与真实电影原生播放仍可继续验收。保持现有 `coketv-local` 与测试数据；源码预览是临时手工启动，未配置登录自启。新代码尚无正式候选镜像构建、GitHub 原生 amd64 或发布后验收。开发阶段未进行发布；用户随后明确要求直接提交推送主线，本轮授权与发布进度见 7.18，不能把源码覆盖的临时容器说成新发行镜像。

### 7.18 猫影视功能提交与主线同步（2026-10-08）

- **本轮明确授权**：用户要求“完成代码提交，再推送到 GitHub”，并进一步明确“直接推送到主线”。因此本次直接在 main 提交全部猫影视功能、测试与正式文档，再正常推送；不创建工作分支或 PR，不强推。现有 main push 会自动触发源码检查和 amd64 候选/发布流程，后续状态须按本轮 CI 实际结果回填，不能引用旧镜像验收作为新发行结论。
- **提交前复核**：远端 main 与本地基线同为 `88979ac`；没有用户新改动或分叉。运行数据、工具、虚拟环境、私密说明和凭据未跟踪。源码汇总 hash 与本轮最终 131 项临时容器回归一致，已有 check/build、135 后端 + 50 UI、手机生成 MP4/HLS 开播证据保持有效。提交不包含本地生成的四文件配置、样片或截图，不改变正式 data、现有 Docker 服务与手机源码测试服务。
- **主线同步成功**：功能提交 `acbfb1af02c1f47a3cdf10e8f6457183e01b9516`（16 个文件）已通过正常 Git push 从 `88979ac` 快进到 GitHub main；没有强推或创建分支/PR。源码汇总 hash 与上一节最终容器证据一致，提交前检查未发现本机绝对路径、私密地址或实际密码/订阅凭据，工作区干净。
- **本轮 CI 已启动**：[Verify 37715845060](https://github.com/tardlk/CokeTV/actions/runs/37715845060)、[Docker amd64 37715845159](https://github.com/tardlk/CokeTV/actions/runs/37715845159) 均由上述 feature SHA 的 main push 触发；后续复核 Verify 已 completed/success；Docker 流程仍在运行，尚未取得本次原生容器或新镜像发布成功结论，不能把旧 digest 当作新镜像。最后仅补记公开交接，使用 `[skip ci]` 避免同一运行代码重复构建；该文档 HEAD 可领先实际 OCI revision。后续应根据上述两条运行核对结果，若有失败再修复并走完整门禁。

### 7.19 本次换对话快照（2026-10-08）

- **最新用户意图与授权**：CokeTV 提供猫影视 Node.js 四文件订阅，目标 iOS Miraplay。用户已确认生成 MP4 与加密 HLS 样片都能开播，并明确要求代码直接提交推送 GitHub main，允许因此触发既有自动镜像发布；不要再以“不重新发布镜像”为由阻止本轮流程。用户现在准备换对话，先维护这一份交接，不创建第二份报告。
- **Git 快照**：功能提交 `acbfb1a` 已推 main；上一次公开同步记录 `c028fa4` 也已推送，本地/远端一致，开始本次换对话补记时工作区干净。只存在 main，没有 PR 或工作分支；本次仅文档提交使用 `[skip ci]`，代码/镜像追踪仍以 `acbfb1a` 为准。
- **GitHub 最新复核**：源码 [Verify 37715845060](https://github.com/tardlk/CokeTV/actions/runs/37715845060) 已 completed/success，check/build/test 步骤全部 success；已读取实际日志。镜像 [Docker amd64 37715845159](https://github.com/tardlk/CokeTV/actions/runs/37715845159) 仍 in_progress，本轮检查时 candidate 在执行 Verify source，构建、完整矩阵与 publish 尚未完成。新对话必须先查询该运行，失败则读取失败步骤修复；成功则核对新镜像固定 SHA/digest、OCI revision、容器报告并安排匿名发布后复验。不得把“已推主线”“Verify 通过”或旧镜像证据当作新镜像发布成功。
- **现有服务已重验**：旧 `coketv-local` 仍 healthy、未重启或升级，绑定本机 54058；新猫影视源码预览 54059 的 GET /health 返回 ok=true/version=0.1.0，仍在运行。新源码预览使用独立忽略数据，手机入口/后台测试密码/PID/样片端口在 `.tools/cat-preview-*/session-info.json`（0600）与同目录私密说明，不写入公开文档。不要删该目录或误以为旧 Docker 已具备新 UI。预览手工启动，没有 Mac 登录自启。
- **已保留证据与边界**：同目录有四文件 ZIP、后台截图、本机最终门禁日志、131 项容器回归报告/TAP、真实非凡网络报告及 native-verification.json。第三方完整 bundle 未执行、未复制；正式 data、CatSource 和原 Docker 测试卷未改。精确 Miraplay/iOS 版本、手机完整播放/拖动/切集/搜索、真实电影原生播放尚未逐项验收，嗅探仍只有本地模拟证据。
- **继续工作的顺序**：git status → AGENTS → 第 0/7.17/7.18/本节 → 查询当前 GitHub 镜像流程。保留用户现有测试环境和数据；新镜像发布不等于本机服务已升级，本机替换/正式部署与数据迁移另行安排并先备份。

### 7.20 新镜像发布核对与本机 Docker 升级（2026-10-08）

- **本次授权**：用户要求先接手核对镜像，随后明确“暂时不需要手机服务54059服务端口了，你把镜像更新到最新版”。因此不恢复 54059，保留其目录和数据；只升级现有 `coketv-local`，不改正式仓库 data、不重新发布代码。
- **GitHub 发布**：已读取 37715845159 的步骤和实际日志。源码检查、构建、完整候选矩阵、镜像身份校验和发布均 success。`latest`/`sha-acbfb1a` 日志均给出 digest `sha256:9330d3285d1ac11ff276972f3fcc487246c78987e39ca72291ce46eb9384f8ae`；OCI revision 为 `acbfb1af02c1f47a3cdf10e8f6457183e01b9516`。候选报告 completed=true、linux/amd64、UID 1000、131 后端回归全过。
- **发布后独立复验**：触发并完成 [Verify published image 37716710290](https://github.com/tardlk/CokeTV/actions/runs/37716710290)，输入上述固定 digest；匿名拉取和完整矩阵均 success。下载的 report completed=true、131 项回归，五引擎、GET/HEAD/Range/HLS/key、空壳、重启持久化、旧数据升级、坏状态拒绝启动和旧属主恢复全部通过。候选与发布后报告的 config image ID 都是 `sha256:e00f02556b6a855b9d2ac6e121fe50c18f7b4de474d882ab0eebd5f5a723db7d`。
- **实际数据纠偏**：当前 Docker 数据已有用户导入的 45 个源和 1 个订阅，不再是早期只有样片的快照；旧私密说明中的样片 source ID 已不存在。首轮升级的旧样片接口检查因此 404，已自动回退，随后按实际数据重新核验。未恢复失效样片源或增删现有实例。原生成样片文件仍保留。
- **备份与升级**：先停止旧容器，将完整 data 通过 Docker tar 备份到忽略的 `.tools/image-upgrade-37715845159/data-before.tar`（私有目录），已核验归档和 SHA256。新容器固定上述 digest，继续挂载原 `coketv-local-test-data` 与只读 `coketv-local-demo-media`，仍绑定本机 54058，保留 `unless-stopped`、非 root、全部 capabilities 移除和 no-new-privileges。旧容器 `coketv-local-before-acbfb1a` 保留停止状态、restart=no，旧镜像保留；切勿与新容器同时启动共享数据卷。
- **升级验收**：新容器 healthy、UID 1000；管理导出内容前后相同，完整 data 中所有普通文件 SHA256 前后相同，45 个源、1 个订阅、密码、ENV 与脚本均保留。读取现有已启用订阅的四文件，两个 MD5 正确，manifest 成员与原订阅一致；后台页面和新 Miraplay UI 构建存在。容器内部原样片服务 Range 返回 206/128 字节；不将该检查说成失效样片源已恢复或真实电影手机验收。本机仍为 Mac arm64 经兼容运行 amd64，原生 amd64 证据来自上述 GitHub 两次矩阵。
- **证据与入口**：发布前/后报告、TAP、原容器配置、完整备份、hash 清单和 upgrade-report.json 均在上述忽略目录；可能含用户数据，不提交。私密 local-test-info 的镜像信息已更新，凭据不变。访问本机 127.0.0.1:54058；54059 本轮最初即无法连接，用户表示暂时不需要后未恢复，也未删除其数据。没有修改产品源码或再次推送发布。

### 7.21 后台按钮整理与本机页面更新（2026-10-08）

- **用户要求与修改**：删除设置页的“导出配置/导入配置”，将“新建实例/扫描源目录”移动到源管理。`web/App.vue` 移除两个配置入口及未使用的前端函数，两个源操作放入源管理工具栏，保留原有处理逻辑和 busy 状态；设置页保留检测环境。后端兼容接口未改。
- **验证**：沿用已有本机工具和 native config loader：check 124/143/空壳通过，`npm run build -- --configLoader native` 通过，core 135/135、UI `--configLoader native` 50/50，0 失败/跳过。没有新增依赖或更改引擎，构建保留既有大包提示；不宣称默认 config bundle 直接通过。
- **本机交付**：先备份旧前端到忽略的 `.tools/ui-toolbar-20261008/dist-before.tar`，复制新哈希资源并替换 index。容器未重启，全部 data 普通文件 hash 与操作前相同；页面服务已核对最终 index 和引用资源与本地构建逐字节一致。当前容器镜像仍固定 7.20 的正式 digest，本次仅修改容器前端写层，重建容器会恢复发行版页面，不能说 GHCR 已含本次修改。源代码和交接文档仍在本地未提交；没有推送或触发发布。
- **浏览器实测**：刷新现有后台，源管理工具栏出现“新建实例/扫描源目录”；点击新建实例能打开已有脚本选择窗口，取消退出，未保存新实例；设置页四个旧入口全部消失，仅检测环境保留。没有点击实际扫描来改用户数据。截图、门禁日志与 deployment-report.json 保存在上述忽略目录。本轮浏览器显示 46 个源、47 个脚本，为用户操作后的当前内容，不以 7.20 的 45 个源旧快照覆盖。
- **本机凭据补记**：本节前用户明确要求更改测试后台访问密码。已按原 v2 scrypt 格式原子改写管理员凭据、保持 0600 并重启生效，新密码实际管理接口登录通过；密码以外 data 文件 hash 不变。修改前凭据备份在 7.20 的私密证据目录，本机登录说明已更新；公开文档不记录密码。此重启发生在页面整理前，本次页面更新本身没有重启。

### 7.22 统一网盘调研与 drpy-node 2.0.6 独立参考部署（2026-10-08）

- **目标与授权**：用户提出后台扫码登录网盘、搜索源返回分享链接、统一 SDK 展开文件并播放，确认“后台登录，全家共用”。先研究 MoonTVPlus 和用户提供的 drpy-node 2.0.4 ZIP，随后明确批准独立部署最新镜像与源码研究计划。此次授权不等于开始实现 CokeTV 网盘功能或重新发布 CokeTV。
- **镜像身份**：ZIP 的 docker-compose 注释中指向 `ghcr.io/hjdhnx/drpy-node:latest`。匿名核对最新 index digest 为 `sha256:23a341124c301a9dcc7a2e29cbf1c8553819d25e87da7e9069a0c1f3f3e83688`，支持 amd64/arm64；本轮固定该 digest 拉取原生 arm64，版本标签 2.0.6，OCI revision `30ebd254ef09335c71b9ba84d13b24a58a6f1275`。项目在 `/app`，镜像创建于 2026-10-06 UTC（北京时间 10-07）。此前只读比较来自 amd64 源码层，本次已实际导出 arm64 容器源码复核。
- **部署边界**：`drpy-reference` 仅绑定本机 54060→5757，restart=no，无挂载，不连接 CokeTV 数据卷或仓库 data；全部 capabilities 移除、no-new-privileges。独立随机管理凭据、Cookie 入库码和下载密钥只在本机私密说明/env/session-info 中；ENABLE_TASKER=0、ENABLE_TERMINAL=0、ENABLE_MCP_COMPAT=false。镜像全部辅助插件 inactive，plugins 目录无自动启动服务；实际进程只有主 Node 和包内 Python 守护进程。不要把停止参考容器扩大为停止现有 Docker VM。
- **源码与研究产物**：启动前从容器导出 1163 个项目文件，排除 node_modules、.venv、.git、__pycache__，记录完整 hash 清单；原样源码、镜像元数据、比较/启动/保留报告、截图、研究结论和私密使用说明位于忽略的 `.tools/drpy-reference-206/`。目录 0700，凭据文件 0600，原项目站点仅保留在独立参考环境，不进入 CokeTV 源管理、发行代码或 Docker 上下文。start-reference/stop-reference 只管理此参考容器。
- **核心结论**：9 个 `utils/pan` 驱动与用户 ZIP 及 CokeTV engine 对应文件逐字节一致；pans、_lib.scan、push_agent、扫码管家的 index/core/cookie 共 15 个重点文件均与 ZIP 一致。扫码页面支持阿里、夸克/夸克TV、UC/UC_TOKEN、哔哩哔哩、移动、百度、PikPak，没有 115；聚合器将 Yun 注释为 115 是错误标注，实际驱动连接移动 yun.139.com。搜索脚本识别 115 链接不代表有 115 播放能力。
- **可参考与需要改造**：扫码状态机→ENV 保存→源展开分享为线路/分集→lazy 取原画或平台转码地址可参考；已有多盘刷新逻辑。各驱动方法/输出不统一，且部分路线会转存并清空 drpy 目录，有外部辅助认证/代理依赖，原扫码界面会返回/显示原始凭据。未来统一账号管理、服务端扫码保存、受控临时文件、统一分享/播放接口、媒体票据/订阅范围以及跨引擎衔接均需单独设计；CokeTV 的按源 ENV 回写与原全局 ENV 不同，共用账号刷新不能简单分散写入每源。115 扫码和驱动仍缺；MoonTVPlus 仅提供了 Cookie 配置及分享播放参考。
- **新版其他变化**：2.0.5/2.0.6 有默认鉴权、媒体代理连接池/Range/pipeline 与备份并发复制等更新，网盘重点文件未变。可独立评估，不覆盖 CokeTV 现有匹配路由鉴权、SSRF/受检连接、媒体票据和用户内容保留逻辑。
- **本轮实际验收**：独立管理健康接口 200，浏览器以独立凭据打开后台与扫码页，后台显示 2.0.6/linux arm64；实测 Node v24.18.1、Python 3.14.8、PHP 8.3.35（运行镜像版本不能按构建阶段 Node 22 推断）。终端 available=false，任务列表为空，辅助插件未激活。没有点击扫码/入库、运行源接口、转存、删除或登录个人网盘，未声称网盘接口或真实播放已通过。CokeTV 健康，原容器 ID/镜像/启动时间及全部 data 普通文件 hash 与部署前相同；既有前端写层修改保留，54059 未恢复。没有修改 CokeTV 产品代码、提交或推送。

### 7.23 115 网盘独立验证与实际扫码登录（2026-10-08，进行中）

- **当前授权与进度**：用户认可资料已足够后明确“那就开工”。沿用已提出的顺序：先独立验证扫码→分享展开→选集播放/拖动/切集→重启保持，再正式接入 CokeTV。账号模型仍为后台一次登录、家庭共用。本轮建立基础模块与验证工具；正式后台、搜索源自动交接、TVBox/猫影视网盘订阅尚未实现，未推送发布。
- **实现**：`src/netdisk/accounts.js` 用独立 netdisk/115.json 原子保存账号，0700 目录/0600 文件，状态不返回 Cookie，损坏文件拒绝并保留；换账号生成新 revision。`pan115.js` 为 Node 实现，参考 SheltonZhu/115driver v1.3.5 的协议路径，无新增依赖、未内嵌 Go SDK 或 MoonTVPlus/LitePan 程序。固定平台端点完成二维码/状态/确认兑换、分享分页/子目录/视频过滤/长 ID/集数排序、分享文件取播放 URL；只实现读取与播放，不用转存/上传/删除 API。
- **独立 HTTP/页面**：`scripts/netdisk-verify.mjs` 与 `.html` 仅本机 54061，Basic 管理鉴权按匹配路由、跨站写请求拒绝、请求限流。分享结果与分集只返回随机会话/索引；播放随机引用绑定账号 revision，旧账号/重启会话失效；媒体复用原 `streamMedia` 和受检出口，支持 Range/HEAD/HLS 改写，请求头留在服务器，不把账号 Cookie 发送给媒体 CDN。该工具独立于正式 server.js、现有后台页面和发行 Docker 启动命令。
- **先失败再修复**：新模块测试首先实际报模块不存在。真实二维码已取得，但初次状态查询 20 秒被长轮询超时打断；新增超时回归实际失败后改为 45 秒等待并允许网络超时重试。继续实测发现 115 约 30 秒返回 HTTP 200、`state=1/code=0/data={}`，原实现错误报状态异常；使用这份实际返回新增回归实际失败后修为继续等待，并加时间戳避免状态缓存，未知状态仍拒绝。不是删断言或把未知响应都视为成功。
- **实际手机登录与重启**：用户通过独立验证页使用本人 115 App 扫码并确认；服务端获取完整凭据，页面显示已保存。调用 115 的只读账号接口 HTTP 200/state=true，返回账号与保存的 UID 匹配（账号标识未写入公开证据）。仅重启 54061 验证进程后，凭据文件 hash/revision/0600 不变；再次向平台查询仍有效。未用会挤掉设备的额外 LoginCheck 接口，也未再次要求扫码。此为真实账号登录和重启有效性证据，不能替代分享播放证据。
- **门禁**：check 127 个语法文件、143 桥接、spider37/engine156 空壳通过；build 使用已有 `--configLoader native` 成功；core 147/147，UI native loader 50/50，197 全过、0 失败/跳过。新增 12 个网盘固定样本/HTTP 场景覆盖鉴权/跨站、扫码状态/并发/超时、私密持久化/损坏保留、分页/目录/长 ID/上限、媒体头/Range/HEAD/HLS、换账号失效和重启。没有运行 drpy-node-coder CLI，也未声称标准默认 config bundle 已直接通过。
- **本机保留**：`.tools/netdisk-115-verify/` 为私有目录，session-info（0600）记录 PID、入口与管理密码，data/netdisk/115.json 含真实网盘凭据，不打印/提交。证据日志、真实登录/重启的脱敏结果、二维码/登录后截图、现有 CokeTV hash 基线与私密使用说明在同目录；manage.py 仅管理这一验证进程，重启会保留凭据。没有登录自启。CokeTV 54058、drpy-reference 54060 均保留，54059 未恢复；CokeTV 容器 ID/镜像/启动时间与全部 data 文件 hash 校验一致，既有前端写层与本地未提交修改保留。
- **必须继续的验收**：已经向用户索取一条可访问的 115 测试分享链接和提取码，当前尚未收到。拿到后继续真实分享展开、文件/分集、取地址、实际解码、拖动/切集和重启后重取播放。只有这条链路验证通过后再进入正式源/后台/订阅接入，不得把静态样本或成功扫码说成真实电影播放成功。登录信息保留在独立环境，勿为了获取测试样本自行搜索或恢复原站点。

### 7.24 115 真实分享、4K 播放与接口兼容修复（2026-10-08）

- **用户输入与范围**：用户提供一条带提取码的 115 分享，授权继续前述真实链路验证。分享地址、提取码、文件标识和下载签名只保存于私密 `.tools/netdisk-115-verify/`，不进入公开交接/源码。实际分享目录展开得到 47 个视频，保留子文件夹与自然集数排序；未转存、上传或删除网盘文件。
- **真实失败与修复**：最初 Web `/webapi/share/downurl` 返回 HTTP200/state=false/errno50029，平台提示版本过低；按上游已知浏览器版本更新 UA 的对照仍失败。通过参考库协议验证 HTTPS `proapi.115.com/app/share/downurl` 加密请求与响应解码实际成功后，加入仅对 50029 的兼容切换，确认 App 接口成功后进程内优先复用。登录/权限/其他平台失败不触发此切换。新增固定50029回归实际先失败再通过；没有宽泛接受失败响应。
- **编解码来源与测试**：新增 `src/netdisk/m115.js`，将 SheltonZhu/115driver v1.3.5 的 `pkg/crypto/m115` 适配为 Node 内置 crypto，完整 MIT 许可、版权与作者声明保留在 `LICENSES/115driver.txt`。使用随机16字节请求密钥、RSA分块与协议XOR，严格校验密文与填充。测试独立生成RSA测试密钥和服务端响应，验证多块解码、随机性、长度/填充拒绝；公开协议常量已与上游逐项核对。固定样本没有真实账号、平台私钥或有效视频签名，无新增依赖。此次适配更新了此前“未引入编解码实现”的阶段性结论。
- **真实网络与格式**：第一集 HEAD200、Range0–127与1MB偏移206/128字节/正确Content-Range，3GB偏移206/128字节约0.22秒。Matroska魔数正确。只取前2MB在既有参考容器内用 ffprobe 读格式：3840×2160、HEVC Main10、yuv420p10le，时长约2796.8秒，含EAC3六声道和AAC双声道。媒体地址与UA留在服务器，账号Cookie未发送给CDN。格式探测不等于音频已人工听测。
- **浏览器实播**：在本机内置浏览器实际点击第一集，看到真实视频画面；读取DOM媒体状态 currentTime持续增长、readyState4、3840×2160、error=null。原生进度条从开头拖到约1298.9秒（约21分39秒），先缓冲后恢复，后续进度超过1344秒、readyState4/error=null。此MKV有明显缓冲等待，不承诺秒跳。点击下一集后第二集实际播放至约22秒、3840×2160、readyState4/error=null。没有完整播放47分钟，也未进行手机Miraplay/TVBox或人工听音验收。
- **真实重启再播**：先关闭浏览器媒体连接，仅重启54061验证服务，凭据文件hash不变、原媒体票据403；重新读取同分享仍47项，第二集重新取地址并Range206。浏览器重新读取并点击第一集，实际播放至约22秒、3840×2160、readyState4/error=null。随后暂停在验证画面，页面与登录数据保留。证据包含 live-share/media-probe、media-format、large-range、browser-seek/episode2/after-restart 与截图，均在上述忽略目录。
- **最终门禁与保留**：check128个语法文件、143桥接、spider37/engine156空壳通过；build native loader通过；core150/150、UI native loader50/50，200全过、0跳过。既有CokeTV和参考容器未重启/替换，正式data未用于验证，54059未恢复。此阶段只改网盘模块、独立验证工具/测试与文档，没有推送、构建或发布新CokeTV镜像。已有网页按钮本地修改仍保留。
- **下一阶段**：最小扫码→分享→取地址→真实播放/拖动/切集→重启恢复已具备证据。统一网盘管理后台、搜索源结果自动交接、跨引擎与TVBox/猫影视订阅接入尚未实现；不能把54061验证页冒充已接入54058正式后台。实施时保留本次有效账号，继续维护订阅/实例范围与服务端媒体票据，不能复制凭据到公开配置或每源ENV。

### 7.25 115 统一网盘模块接入与本机镜像交付（2026-10-08）

- **接续授权与最终范围**：用户原目标为网盘账号统一管理、搜索源交给 SDK 播放，已授权“开工”；按先验证后接入的顺序，7.24通过后继续实现第一版115。其他五引擎和既有网盘辅助库不裁剪、不适配额外Runner、不恢复旧预置源。没有自动选择或添加115搜索站点；用户当前只提供了测试分享，具体搜索脚本/站点仍待其提供。
- **主后台**：左侧新增“网盘管理”，`web/NetdiskManager.vue` 通过既有管理API进行账号状态、设备选择、扫码/重新扫码和状态轮询；离开页面停止前端轮询，Cookie不在前端表单或响应中。后台GET `/admin/netdisk`，POST登录/轮询，GET二维码JSON（data:image/png），均继承匹配路由鉴权、限流，增加跨站修改拒绝和private/no-store。另有仅管理员可调用的账号迁移接口 `/admin/netdisk/115/account`，用于复用已经确认的本机验证账号，响应只含状态，不提供公网Cookie入口。
- **源与订阅交接**：`src/netdisk/service.js` 在原五引擎执行之后处理标准详情 `vod_play_url`，识别完整115分享和 `push://` URL编码分享，展开文件为按源实例/账号revision绑定的随机分集引用。点击内部引用由宿主直接取媒体，不再交回源lazy；普通线路保留原引擎逻辑。网页、TVBox与猫影视共用服务；非标准脚本若仅在lazy返回分享网页，需要调整详情输出，不能声称所有第三方脚本原样可用。缓存、并发、分享数、目录/文件/分页请求均有上限，账号不分散写入每源ENV，也不进入state/export/subscription配置。
- **权限与媒体**：分集引用不能跨源实例使用；源启用、订阅启用/Token/成员检查仍在原入口执行。网页/猫影视能力票据附带网盘revision，HLS子引用继承；更新账号后旧媒体新请求拒绝，停用源后网盘网页HLS子引用也拒绝。猫影视保留MKV/AVI等格式后缀。TVBox保持原播放JSON协议，返回临时上游地址及必要UA，不返回内部revision、文件对象或账号Cookie。已缓冲数据和已发出的平台直链不追溯回收，平台控制其有效期。共享账号库不是对同权限源脚本的隔离边界，SECURITY已说明。
- **先失败再修复与实链路**：新增主服务集成用例最先实际404，再实现后台/源交接，通过网页/TVBox/猫影视、跨源/订阅拒绝、账号更新和HLS子范围检查；新增2个UI行为用例。随后用独立忽略data的实际JS协议样本与用户真实账号/分享执行主服务：详情展开47分集，网页Range206/128字节，猫影视Range206且stream.mkv，公开结果无Cookie。样本只在本机忽略目录，不进入现有46源。一次从 `--input-type=module` stdin启动验收导致fork继承参数失败，改用保存的.mjs验收脚本后通过，没有为此改框架或测试断言。真实手机客户端解码仍未完成。
- **门禁与容器资源问题**：宿主check129个语法文件、143桥接、spider37/engine156空壳，build native loader，core151/151、UI52/52，203全过/0跳过。第一次旧镜像覆盖的容器并行146项中145通过、1个源worker被SIGKILL；读取memory.events确认oom_kill=3，VM总内存约4GB，未将其说成功。保留失败TAP，不重启/扩容VM、不改断言；构建真实本机派生镜像后，在独立卷重新做空壳/五引擎/重启，并清理测试进程缓存后以 `--test-concurrency=2` 完整运行同146项全部通过、0跳过、oom_kill=0。新原生amd64 GitHub CI尚未执行；本机为Mac ARM经QEMU运行amd64。未来container-matrix已纳入115/编解码/正式交接3个回归文件，独立验证工具仍只在宿主门禁测试。
- **镜像身份与许可**：本机 `coketv-local:netdisk-bb046cd4b0a8`，OCI revision `local-netdisk-bb046cd4b0a8`，载荷hash `bb046cd4b0a811e61ed43bc1ef2d6a5e39c6866cb934f04fad5e3a47faa55fec`，基于 acbfb1a digest `sha256:9330d3285d1ac11ff276972f3fcc487246c78987e39ca72291ce46eb9384f8ae`。仅覆盖src/dist/LICENSES，没有将验收容器commit为镜像，没有预置测试样本或用户数据。构建使用现有Docker legacy builder，因为未装buildx；实际inspect确认linux/amd64、User=node/UID1000，候选检查许可存在。正式Dockerfile补COPY LICENSES，避免被忽略的docs目录导致MIT许可遗漏。此为未发布的本机测试镜像，不能混称GHCR latest或新Git SHA发行。
- **备份、切换与数据保留**：部署前保存完整旧data tar并核对归档所有文件hash，另保存旧src/dist及容器配置；证据位于私有 `.tools/netdisk-115-verify/deployment/`。旧 `coketv-local-before-netdisk-1791440886` 停止且restart=no，保留原写层/卷，不能与新容器同时运行共享卷。新 `coketv-local` 继续挂载原data和只读demo卷，仅本机54058、unless-stopped、能力移除/no-new-privileges，healthy。迁移账号前全部data hash原样；迁移后原文件hash、管理导出内容、46源/1订阅/密码/设置均相同，仅增加 `netdisk/115.json`（0700目录/0600文件）。通过管理鉴权迁入有效验证账号，无需重新扫码；容器向115只读账号接口实测仍有效/账号匹配。54060参考和54061验证保留，未改全局Docker context、VM或登录自启。
- **实际界面与隐私复核**：浏览器刷新54058后，网盘管理实际显示已保存登录信息及重新扫码入口，旧源管理按钮整理保留。正式二维码端点实际返回PNG，未再次确认登录，现有凭据hash不变。源码/前端/许可载荷hash与当前工作区一致；拟提交文件检查没有真实Cookie或测试分享地址。本机私密使用说明已更新。截图、203宿主日志、146容器TAP、OOM失败记录、真实集成/迁移/账号验证、数据备份和镜像报告均忽略，不提交。
- **后续边界**：第一版已具备统一115账号、标准详情分享展开及三端服务协议；不存在预置资源搜索站点。需要用户提供对应源脚本/TVBox配置/具体站点后，再在保留现有源的前提下做真实搜索到播放的整条验收。完整影片、声音人工确认、手机Miraplay/TVBox真实网盘解码、其他网盘统一账号与正式GitHub发布尚未完成；目前没有自动发布授权，不推送main触发latest。现有代码及之前页面改动均本地未提交，接手不得reset或用旧GHCR镜像覆盖。

### 7.26 网盘爬虫开发指南（2026-10-08）

- **用户请求**：参考所提供的 OmniBox 爬虫开发指南，单独写一份文档，让爬虫作者了解 CokeTV 网盘能力。已读取其介绍与SDK说明，按本项目 `src/netdisk/service.js`、`pan115.js`、各引擎样本及正式集成测试核对内容，没有移植外部SDK或新增调用接口。
- **交付**：新增 `docs/NETDISK_DEVELOPMENT.md`；README、CONFIGURATION、DEVELOPMENT增加入口。包含支持范围、标准详情JSON、直接链接/push编码、提取码、多线路、drpyS与HIPY片段、缓存与实例/账号绑定、播放/客户端限制、保护上限与排错/验收。所有示例使用占位地址，不含真实分享/提取码/Cookie/媒体签名；明确统一账号目前仅115，当前本机功能不能等同已发行GHCR镜像。
- **验证与保留**：7个代码示例（2 JSON、3 JS、2 Python）完成解析/语法检查，4份文档本地链接存在，git diff --check通过；check、build native loader、151后端与52UI全过，0失败/跳过。本次只修改文档，没有调整容器/账号/源/订阅或正式data，没有提交推送；既有网盘与界面代码仍为本地未提交修改。

### 7.27 本轮仓库整理、GitHub同步与换对话（2026-10-08）

- **新授权**：用户明确要求整理仓库并推送代码，准备换对话。本轮提交包含7.21按钮整理、7.23–7.25统一115功能与测试/许可、7.26网盘开发指南。保持main，不新建工作分支，不带入运行数据/账号/研究源码/截图/本机工具。
- **交接整理**：第0节已收敛为当前状态表，阶段历史集中保留在第7节，避免多个“最新状态”互相冲突；AGENTS正式文档目录补入网盘开发指南。README猫影视段落的旧“无新网盘登录能力”措辞已按当前独立网盘模块澄清。
- **功能提交**：`9dbf42c0d12db0a0bdd2095a4c8bb3aa362ef16c` 已推送origin/main，本机与远端SHA一致。共28文件，包含AGENTS文档目录、MIT完整许可及网盘代码/验收工具/测试/开发指南。许可只清理行尾空格，不变更条款；本机旧local镜像的许可文件仍是清理空格之前的副本，运行代码未变。
- **本轮门禁**：全发行文件与当前私密Cookie/分享值交叉扫描无命中，无data/.tools/.venv/dist/node_modules/HANDOFF进入提交。暂存区diff检查通过。首次单独check漏带本机PHP路径而ENOENT，补齐已有TEST_PYTHON/TEST_PHP后完整check/build(native)/151后端+52UI全部通过，0失败/跳过；未掩盖失败或改测试断言。
- **远端流程成功**：[Verify 37740948077](https://github.com/tardlk/CokeTV/actions/runs/37740948077)、[Docker amd64 37740948038](https://github.com/tardlk/CokeTV/actions/runs/37740948038) 均success，对应功能SHA9dbf42c。GitHub使用标准check/build/npm test全部通过；原生amd64候选146/146后端回归、零源/非root/首装/五引擎真实GET-HEAD-Range-HLS-key/同卷重启/损坏数据保留/卷属主恢复均成功，0失败/跳过。下载report.completed=true，sourceSha/verificationSha均匹配。实际运行Node22.23.3、Python3.13.5、PHP8.4.26、UID1000。
- **固定发布身份**：`ghcr.io/tardlk/coketv:sha-9dbf42c` 与 `latest` 均指向 `sha256:d51d92eeaa86c6c03f5944787dc434ea2b0abeb9632b772c1deb9ba52405a77a`；image/config ID为 `sha256:f38e54607900e6f08dd5fc8e9e8b7532523a11231eb77da7db841470f26ad75f`。匿名读取GHCR两个manifest，digest一致且config与已验收候选report一致，发布过程未重新构建。
- **匿名发布后复验成功**：[37741632204](https://github.com/tardlk/CokeTV/actions/runs/37741632204) 对上述固定digest匿名拉取并复用完整矩阵，success；下载report.completed=true，sourceSha/verificationSha为9dbf42c、imageId与候选相同，146/146回归，0失败/跳过，五引擎/重启/异常数据保留等全部通过。不是仅检查health或仅拉取成功。
- **换对话收尾**：源码/镜像均已完成同步与验证，最终补记仅修改本文和网盘指南的版本说明，以 `[skip ci]` 文档提交同步，避免无代码变化重复发布镜像。功能SHA始终为9dbf42c；后续文档HEAD领先镜像revision属于预期。当前没有待完成的发布流程；下一对话按第0节继续用户新需求，保留本机账号/服务，不需重复扫码。
- **本机保留**：54058继续使用已验证的local镜像与原卷，推送前复核healthy；54060参考和54061验证环境保留，54059未恢复。没有因推送自动替换容器、重扫/覆盖源或改账号数据。复核部署前210个文件，209个hash相同；唯一变化为 `runtime/spider/py/base/__pycache__/spider.cpython-313.pyc` 的16字节缓存头，归档与当前缓存字节码完全相同；state/源脚本/ENV/设置/管理凭据不变，只增加已知 `netdisk/115.json`。不得把Python自动缓存头变化误称业务数据被覆盖。

### 7.28 停用并清理独立115及旧手机测试环境（2026-10-08）

- **用户授权与清理**：用户明确要求停止独立115验证服务和旧手机测试服务，并删除相关文件。通过原管理脚本停止54061；54059及其样片端口54161已无监听。删除忽略目录 `.tools/netdisk-115-verify/` 与 `.tools/cat-preview-20261008-EsYrsv/`，包括独立账号副本、测试数据、分享信息、会话/管理脚本、样片、四文件包、日志、截图及本地验收证据。仓库中的通用验证工具及正式网盘、猫影视功能保留。
- **Docker清理**：删除两套测试对应的4个已停止临时验收容器及4个专用数据卷。保留当前 `coketv-local`、`drpy-reference`、停止的主服务回滚容器、正式数据卷与样片卷，没有执行全局prune。
- **回滚备份保留**：被删目录内的 `deployment/` 属于当前CokeTV主服务的部署回滚资料，清理前单独移至 `.tools/netdisk-deployment-backup-20261008/`（0700），本机私密 `local-test-info.json` 的backupDirectory同步更新（0600）。第7.25–7.27节原备份路径为历史位置。
- **保留核对**：清理前后主服务data的211个普通文件hash全部相同，包含正式115账号；主服务与参考服务容器ID、镜像和启动时间未变。54058、54060健康检查通过；54059、54061、54161无监听。本次仅本机清理与交接文档更新，没有修改运行代码、重新扫码、重启主服务、推送或发布镜像。

### 7.29 OmniBox参考界面与镜像源码恢复研究（2026-10-08）

- **授权与页面核对**：用户提供局域网OmniBox、访问密码及官方介绍页，要求开始研究并尝试从镜像恢复源码。实际登录并长按“我的”进入后台，读取源管理、网盘授权、订阅及影视设置；打开新源表单后取消，没有创建/修改源、订阅、账号或设置。局域网地址及密码不写入公开交接。
- **版本与来源**：实际页面为v3.1.0-beta.1，Go构建提交 `98057fbdfc430692c652b1ea681bfffbb4f21afd`。按官方安装文档读取 `lampon/omnibox`，固定beta索引 `sha256:71a591abd593a17342b13a39a26aa4c77be62c51edc723f9ebcd68c585e2b30e` 与amd64 manifest `sha256:60d1bd8e32273b9b5ca1e9c74fa6d884d715ab2b48c2dcc93116eb2785894773`；四个主要前端资产与实际页面逐字节一致，构建版本/提交/时间也匹配，但没有远程Docker inspect证据，不断言远程容器digest。此次latest对应2026-05-13构建，与beta不同，另作对照。
- **恢复与边界**：逐层验证13个应用层hash并提取beta61个普通文件、对照版76个；找回原始JS/Python SDK、运行器、嗅探脚本和模板，前端发布JS/CSS另作格式化。Go主程序保留DWARF，提取29项目编译模块、3152条函数记录（含内联/包装）、431个结构类型、228条源码路径；35个重点函数静态反汇编与直接调用清单、20条表名返回常量。没有发现原Go/TSX工程或source map，不把格式化JS、结构清单和反汇编称为完整可编译源码；没有下载系统层/依赖层，没有执行镜像代码。
- **仓库线索与材料**：镜像SLSA指向 `Lampon/OmniBox` 及上述提交，公开页面/API返回404，只能判断公开不可访问，不能确定删除或永久丢失。研究说明、原文件、前端调用清单、SHA256记录及恢复ZIP在私有忽略目录 `.tools/omnibox-recovery-20261008/`；官方文档HTML副本保留。未将任何模板、SDK或第三方站点带入CokeTV发行树，没有适配新的Runner或更改五引擎。
- **验证与保留**：应用层/原文件hash与ZIP完整性检查，原Python源码AST解析、原JS运行器/SDK语法检查及前端格式化解析通过；仅研究文件和交接文档有变化，没有运行完整项目门禁、推送或发布。CokeTV主服务、drpy参考及现有账号/源保留，54059/54061旧测试服务未恢复。

### 7.30 冗余审查与六项修复（2026-10-08，本地未提交）

- **授权与基线**：接手先确认main/HEAD93e1e36，仅本文有7.28–7.29未提交补记；这些记录完整保留。用户先要求审查，再明确要求“执行修复计划”。范围为六项已复现问题、确定冗余、预防检查及相关文档，不扩展Runner/网盘平台，不删兼容内核。
- **先复现再修复**：独立临时data/本地HTTP与UI夹具确认深层HLS停用/换账号仍200、脚本保存失败后文件改变、ZIP部分写入、FTP健康500、并发首次网关等待丢失、浏览器返回丢未保存内容。正式后端新增用例最初7失败/1取消，UI新增4失败；原203用例仍全部通过，未修改旧断言或跳过失败。后续补真实history前进/后退、已有历史保留/重试、网关超时及固定FTP协议样本。FTP HEAD越界额外先复现500，再修正为416。
- **媒体范围**：宿主集中签发子代理凭证，网页媒体、源代理toBytes=2/3、mediaProxy、req及别名保留source/netdiskRevision；普通网页分片也绑定源。三级HLS、KEY/MAP和分片新请求在源停用或更新账号后拒绝，头/Range/订阅/猫影视既有回归保持通过。不清除已缓冲字节或追溯回收TVBox已取得的平台直链。
- **文件与ZIP事务**：Store新增文件变更事务，替换前备份原内容；状态提交失败时恢复原脚本并撤回本次历史文件，新建失败移除新文件。回滚用rename，避免磁盘满时再次复制旧内容；回滚自身失败明确报错并保留.rollback备份。ZIP脚本/辅助库/JSON/jx共用整包事务，先核对冲突；同名相同复用，不同内容409且不覆盖，文件或state写入失败整包撤回。正常编辑与恢复历史继续使用saveScript；不是断电/进程强杀时的跨文件持久事务保证。
- **FTP与网关**：恢复FTP日志及parseRangeHeader导入；HEAD只查询文件信息，不下载文件，越界416并释放连接。固定本地FTP样本实际验证GET、Range206、HEAD及HEAD416，不是外部FTP站点验收。Runner在第一个await前缓存共享网关promise，启动失败、IPC错误及10秒无响应统一释放等待者；worker也合并启动中的网关实例。真实并发HTTP健康检查通过。
- **编辑保护**：App/WatchApp使用带位置的浏览器历史，SourceWorkspace暴露统一离开确认；popstate先恢复编辑位置，继续编辑保留内容，确认后才跳转，取消不破坏前进/后退历史。代码/ENV/参数分别覆盖，无修改时直接离开；JSdom实际history.back/forward通过，未做原生浏览器人工验收。
- **精简与检查**：移除5个未用全局注册（70→65）、14个下拉菜单Vue文件及其入口、notices状态、worker内部未调用syntax分支和sources未用导入。保留无静态引用的兼容辅助库和两处CryptoJS入口。新增check-identifiers，以已有TypeScript/Vue检查宿主/scripts/web与两网关的未定义变量；Vue script setup含内联模板，其他依赖注入的engine不套用此规则，不是完整类型检查，无新增依赖。自测确认被注释的日志导入和Vue变量缺失能被检出。container-matrix纳入正式review-regressions，静态检查自测仅在宿主执行。
- **最终门禁**：使用第0节真实解释器路径运行check（130语法、187变量、143桥接、37spider/156engine空壳）、build native loader、test:core162/162、test:ui native loader58/58，220全过/零跳过。仍有原有大chunk提示；主入口394.71kB/gzip120.93kB，播放器/编辑器继续按需加载，不能把删除的未引用模板算成首屏减量。README/CONFIGURATION/DEVELOPMENT已纠正旧latest SHA、工具栏位置、ZIP冲突/回滚规则及检查说明。
- **交付边界**：本轮没有修改正式data、重启或替换现有主/参考容器，没有提交、推送、构建或发布镜像，没有新增外部站点/原drpy-node-coder验收。测试和审查日志在忽略目录.tools/review-20261008，不进入发行。依赖已知告警、fServer默认WebSocket缺口及真实网盘搜索/手机/声音验收仍属于专项待办，本轮不声称解决。

### 7.31 审查修复提交与GitHub同步（2026-10-08，进行中）

- **授权与提交范围**：用户明确要求推送GitHub；本地main基线93e1e36与fetch后的origin/main一致，无需变基或覆盖远端。提交包括7.30六项修复、确定冗余清理、静态检查及测试、正式文档，以及此前未提交的7.28–7.29公开交接补记；不包含data、账号、研究恢复文件、截图、构建输出、本机工具或私密HANDOFF。
- **验证与发行门**：7.30记录的check/build native/162后端与58UI已全部通过；本次推送使用正式主线Verify/Docker流程，不能用旧9dbf42c的镜像和CI证明本轮修复已发布。实际源码SHA、工作流结果、固定digest和发布后复验将在完成后补记；此处未预先声明远端成功。
- **本机保留**：推送不自动替换本机容器，不清理或迁移现有账号/源/订阅，不恢复已删除的测试服务。运行数据与私密备份继续只在本机保留。

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
