# 开发与验证

## 工作范围

`src/` 是 CokeTV 宿主，`web/` 是 Vue 页面，`engine/` 保留 drpy-node 执行契约与必要依赖。GUI 显示三种语言，不改变五种引擎的内部标识。

不要修改 `data/runtime/` 来发布内核改动：内核修改应进入 `engine/`。原模块名、源上下文与代理返回语义需要保持兼容。

编写返回网盘资源的爬虫，请看 [网盘开发指南](NETDISK_DEVELOPMENT.md)：说明当前 115 能力、标准详情交接、JS/Python 示例及引用有效期，不要求脚本接触账号凭据。

## 本地检查

```sh
npm run check     # 宿主/辅助语法、未定义变量、桥接语法、空壳发行检查
npm run build     # 干净克隆请先 build 再 test：页面路由集成测试需要 dist/index.html
npm test          # 后端 node:test + UI Vitest
```

`scripts/check-bridges.mjs` 对 `engine/spider/**` 的 Python/PHP/JS 文件做 `ast.parse` / `php -l` / `node --check`；Python 用 `ast.parse` 而非 `py_compile`，避免产生 `__pycache__` 触发空壳白名单告警。`scripts/check-shell.mjs` 除 `spider/` 的文件白名单外，还会扫整个 `engine/` 是否存在 `var rule=` / `class Spider` / `"sites":[`（判定前剔除整行注释），新增站点定义会让发行检查失败。

`scripts/check-identifiers.mjs` 使用已有 TypeScript 与 Vue 编译器检查宿主、脚本、Web 和 FTP/WebDAV 控制器的未定义变量；Vue script setup 包含内联模板。它不执行完整类型检查，也不对依赖动态注入全局变量的其他兼容引擎套用同一规则，不增加分析依赖。

`npm test` 顺序执行后端 node:test 和 UI Vitest。测试用临时数据目录，不改写现有用户源。若本地开启了批量删除保护，清理临时目录可能被拦截，用 `CODEBUDDY_SAFE_DELETE_ENABLED=0` 运行测试即可（CI 无此限制）。

多语言集成测试优先寻找 `.tools/` 下的本机解释器，也可指定：

```sh
TEST_PYTHON="$PWD/.venv/bin/python3" TEST_PHP=php npm test
```

测试实际调用 Python/PHP。未安装解释器时应修复环境，不能用模拟解释器冒充通过。

## 当前验证

验证使用 macOS arm64 / Node 22 / Python 3.12 / PHP 8.4。测试数量以 `npm test` 输出为准，语法检查文件数量以 `npm run check` 输出为准；本节不维护固定计数。最新已执行的命令与结果见 `docs/AI_HANDOFF.md` 第 4 节。测试涵盖：

- JS、CatVod、HIPY、PHP、DR2 的首页、分类、搜索、详情、播放与代理协议。
- 实例参数、源级 ENV 隔离、配置持久化、备份与订阅范围。
- 二进制代理、Range/206、HLS 分片与 key 改写。
- 旧 PHP/Python 运行副本升级、五引擎升级后执行，以及用户脚本、辅助文件、ENV、订阅、配置与历史保留；JSON 入站可用且旧 pickle 入站被拒绝。
- 随机媒体/分片票据保密、过期与容量回收、URL/源/路由范围，以及长签名地址的实际媒体跟随、Range 和 HEAD。
- IPv4/IPv6/映射地址和元数据判定、受控两次 DNS 答案、每跳连接地址绑定、Host/TLS SNI 与真实证书校验，以及 `/http` 的重定向出口和方法/请求体/头/响应兼容。
- PHP 普通/初始化/解释器失败的安全错误、脱敏诊断与参数编码/嵌套 ENV/JSON 标量边界，以及私密临时文件权限、设置/导入/重启和引擎 ENV 写入的 0600 保持。
- PHP 多层继承/trait 的最近声明与同层候选顺序，以及真实 verify CLI 的 v2/旧凭据迁移、stdin、远端服务与终端不回显/取消恢复。
- 源导入、压缩源编辑、语法检查、版本恢复与同名创建保护。
- 同步死循环回收，后续调用与管理服务可继续运行。
- UI 创建后跳转、重命名、语言筛选、订阅排序、配置表单与退出保护。
- 批量删除确认/取消、所选实例 ID、订阅引用清理与脚本/ENV保留，删除接口继续要求管理密码。
- 匿名观影、管理鉴权、只读执行、播放短期凭证、Range/206、HLS 分片与密钥请求头、JSON 解析和源代理范围。
- 网页搜索、详情、线路/选集、直接刷新、收藏和切集时过期响应处理。
- 搜索下拉、点击图标/表单提交、空输入与不支持搜索的源、首页失败时仍可搜索、桌面/手机影视站选源入口。
- 未登录/首次部署首页与播放直达、首次设置仅在管理入口、进入后台登录/退出/返回观影、公开请求不发送管理凭据、选源列表无参数与敏感配置。
- TVBox 链接预览只读、五种引擎识别、JSON/XML 采集协议、CatVod 依赖、相对 URL/扩展参数、重复导入、文件冲突与持久化失败回滚。
- 采集首页简略列表没有封面时补取 JSON `ac=detail` / XML `ac=videolist`，协议相对封面地址转为完整 URL。

TVBox 链接导入位于 `src/tvbox-import.js`；生成的采集脚本调用 `engine/utils/tvbox-cms.js`，使用现有 CatVod 引擎，没有添加 Android JAR 运行器。`Store.importSources()` 在一笔状态事务内导入所选站点，创建文件失败或状态持久化失败时回滚新文件，保留既有源与订阅。

以下是前期开发记录，不是本次接手重新执行的验证：用户示例链接在临时目录实测，56个站点中47个采集接口通过并导入，9个跳过；生成的“蜜源”源返回43个分类、20条视频。数量随第三方站点状态改变，不是全库播放验收。正式用户源库未由该测试改写。

前期开发还记录了独立临时数据目录中公开 CC0 MP4 样片的浏览器解码、实际播放、切集和切换线路，以及贝乐虎源的《小兔子乖乖》实际播放（129.16秒）；本次接手没有重跑这些浏览器或外部站点验证。桌面与手机布局参考用户 OmniBox。FLV/TS、其他第三方源和解析器的实际网络播放需按源验收。

这些结果不替代整个第三方源库的持续网络可用性、实际 TVBox 播放、外部插件或 Docker/Linux 验收。远程检查结果以 GitHub Actions 日志为准。

## 猫影视连接程序

`src/cat-client.cjs` 是直接提供给手机的 CommonJS 程序，`src/cat-subscriptions.js` 按订阅提供配套四文件、站点清单、业务动作和受订阅约束的媒体。配置模块由服务动态生成并计算最终 MD5，不需要独立 npm 构建或第三方 bundle。Dockerfile 的 `COPY src ./src` 同时纳入连接程序，语法检查覆盖 `.cjs`。

`tests/cat-subscriptions.test.js` 下载最终文件并实际加载，通过宿主 factory 模拟连接真实五引擎；`tests/cat-client.test.js` 检查取消、并发生命周期及网络错误。固定样本覆盖订阅刷新/范围/失效、搜索分页/筛选/多 ID/多线路、媒体头/Range/HLS KEY/MAP、限流、反向代理子路径、服务器解析和模拟嗅探。UI 覆盖两个订阅入口。容器矩阵纳入这两个回归文件；不能把本地或消息模拟称为 iOS 原生验收。

## 115 网盘模块与独立验证

`src/netdisk/pan115.js` 提供扫码会话、分享分页/子目录展开和分享文件播放地址获取；`accounts.js` 将共享账号独立保存到指定目录的 `netdisk/115.json`，目录 0700、文件 0600，不写入各源 ENV。账号状态不返回 Cookie，平台请求只访问固定 115 接口；媒体地址继续使用受检出口和服务端随机引用。

旧 Web 分享下载接口返回 50029（版本过低）时，改用 HTTPS App 分享接口与 m115 编解码；仅对这项明确错误切换，不把登录/权限/其他平台失败视为可播放。确认 App 接口有效后，同一服务进程直接复用该接口；下载请求的 User-Agent 在媒体请求中保持一致，账号 Cookie 不发送到媒体 CDN。编解码固定样本使用测试 RSA 密钥，不包含真实账号、平台私钥或有效下载签名。

设置 `NETDISK_TEST_DIR`（独立临时目录）、`NETDISK_TEST_PASSWORD`（该目录首次创建管理密码时使用）、可选 `NETDISK_TEST_PORT`，运行 `node scripts/netdisk-verify.mjs`。仅监听 127.0.0.1，默认端口 54061，网页包含登录、扫码、读取分享和选集验证。已经创建的管理密码继续从独立目录读取。二维码默认绑定支付宝小程序设备，可以选择其他受支持设备；同类设备重复登录可能影响已有会话。

此入口是独立验证工具，不是生产依赖；正式入口为后台“网盘管理”。`src/netdisk/service.js` 将标准详情分享链接展开为按实例/账号绑定的随机分集引用，源执行与网页/TVBox/猫影视共用该服务，媒体继续使用原票据和订阅范围。账号不进入源状态或导出。不要用正式 data 作为独立验证目录。扫描确认需要用户本人操作；固定样本通过不等于所有真实账号和分享均可用。验证过程不使用转存、上传或删除接口。

`tests/netdisk-integration.test.js` 覆盖正式后台鉴权、详情展开、网页/TVBox/猫影视、实例/订阅范围、账号更新/源停用后的媒体引用失效；`tests/ui/netdisk-manager.test.js` 覆盖扫码界面与离开页面停止轮询。`tests/netdisk-115.test.js` 覆盖链接校验、私密持久化、扫码状态/超时/并发兑换、分页/文件夹/长 ID/边界与媒体头；`tests/netdisk-verification.test.js` 使用临时目录及本地样本验证鉴权、跨站拒绝、媒体范围、HLS、换账号失效和重启恢复。

## 源诊断

```sh
npm run verify -- <源实例ID> [服务地址]
# 自动化可由密码管理工具将密码输出到 stdin：
npm run verify -- <源实例ID> [服务地址] --password-stdin
```

终端默认提示管理密码且不回显，支持 Unicode、空格、冒号与退格；Ctrl-C/Ctrl-D 取消，退出时恢复终端模式。已通过运行环境注入 `ADMIN_PASSWORD` 时直接使用该值；显式 `--password-stdin` 优先从管道读取至 EOF，只去掉一个末尾 LF/CRLF，保留密码首尾空格。在终端直接使用该选项时仍走隐藏提示，按回车提交。终端/stdin 输入上限为 4096 UTF-8 字节。非交互环境没有凭据或输入为空时明确失败，不发送源请求。`--help` 查看用法。

CLI 不读取本地 admin.json，不依赖 DATA_DIR，也不恢复或保存明文密码；本地 GUI 创建的 v2 哈希和远端服务使用同样的显式凭据方式。旧明文格式在服务端成功登录后照常迁移，迁移后命令仍可使用。首页、分类、详情诊断沿用原源协议；不要把真实密码写入命令行参数、文档、脚本或提交。本次运行的是本仓库的 verify CLI，本机未安装原 drpy-node-coder CLI，不能混称。

## 执行与前端加载

HTTP 服务启动时不初始化源引擎。执行子进程按需启动，可超时回收；顶层请求串行排队，上限 64。Python 与源辅助服务不额外开放公网端口。

`src/runtime-files.js` 登记 `spider/` 下随启动刷新的框架保留路径，并供空壳发行检查共用；新增桥接、基类或兼容辅助文件必须登记。更新时逐文件原子替换，不递归替换用户源目录。`tests/fixtures/legacy-runtime/` 冻结旧版本桥接，仅在临时目录用于升级回归，不进入镜像。

源编辑工作区与 Monaco 代码编辑器独立按需加载。管理列表打开时不加载代码编辑器。

`WatchApp.vue`、`WebPlayer.vue` 与 mpegts.js 同样按需加载，管理列表不加载播放器。公开源列表在 `/watch/sources`，网页播放 API 在 `/watch/sources/:id`；原 `/admin/watch/:id` 保留鉴权兼容入口。媒体凭证在 `src/playback.js`；不复用会写入 `lastCheck` 的接口验证入口。

## Git 约定

仓库只提交源码、依赖锁文件、正式文档和配置模板。`data/`、`.tools/`、`.venv/`、`node_modules/`、`dist/`、`.env` 和本地截图/调研历史均忽略。

本地历史资料保存在 `docs/local-history/`，不参与代码构建或发布。原始 drpy-node 源码位于 CokeTV 目录之外，作为对照保留。

## 空壳发行与 x86 镜像

`scripts/check-shell.mjs` 检查发行树没有可注册站点、解析脚本或 JSON 站点资源；`tests/shell.test.js` 使用默认启动路径验证零源和空默认配置。必要的 JS/CatVod 辅助模块、HIPY core/base、PHP bridge/lib 和 WASM 保留，不能因“空壳”删除兼容内核。

`.github/workflows/docker.yml` 的候选任务使用原生 `ubuntu-24.04` amd64 runner，先执行源码门禁，再构建一次镜像并运行 `scripts/container-matrix.mjs`。PR 与手动默认 `dry_run=true` 没有 packages 写权限或 GHCR 登录；main/v* push、或显式关闭 dry-run 的 main/v* 手动运行，才允许在候选任务成功后进入发布任务。

容器矩阵使用独立临时卷与 compose 同等的 `cap_drop=ALL` / `no-new-privileges` 约束，检查非 root、零源、首装、正式 verify CLI、五引擎实际 GET/HEAD/Range/HLS 分片/key、同卷重启/旧票据失效，以及注入的升级/票据/出口/0600/异常/CLI 回归。另建卷验证损坏 state/ENV 拒绝启动且保留内容、旧 root 属主失败后按 README 修正恢复。冻结旧桥接、固定源与测试脚本通过 `docker cp` 注入临时写层，最终镜像只带 `check-shell.mjs` 和正式 `verify.mjs`，不能 commit 测试容器为发行镜像。测试数与解释器版本以容器报告和 TAP 为准，失败或跳过都阻止候选通过。

验收成功后 `docker save` 保存原镜像，记录 tar SHA256、image ID、源码 SHA 与 artifact digest。发布任务只下载该 artifact，校验 tar/image ID/OCI revision/platform 后登录并推送，不重新构建。候选失败、PR、dry-run 与工作分支不能发布；`tests/release-gates.test.js` 覆盖这些门禁。artifact 交接沿用 [GitHub 官方说明](https://docs.github.com/en/actions/tutorials/store-and-share-data)，额外 tar 校验不接受只告警的 digest 不一致。

原生 Linux amd64 机器可以手动执行：

```sh
docker buildx build --platform linux/amd64 --load -t coketv:candidate .
CONTAINER_REPORT_DIR=/tmp/coketv-container-report node scripts/container-matrix.mjs coketv:candidate
```

不要在正式 data 上验收。报告记录平台、UID、Node/Python/PHP、源码 SHA、镜像 ID、清单与零跳过 TAP；启动初始化码从日志产物中隐藏。`.github/workflows/image-verify.yml` 匿名拉取给定固定 SHA/digest 后复用完整矩阵，产物保存到工作流。旧 `latest` 可供手动选择，但不能用它证明本次源码已发布。

本机是 macOS arm64，兼容运行 Docker 镜像不能冒充原生 amd64 验收。已核对的源码提交、固定镜像 digest 与发布前后验收统一见 [当前接手入口](AI_HANDOFF.md#0-当前接手入口先看本节)及该入口指向的发行记录；历史镜像只代表对应版本，本地门禁通过不代表新版本已经发布。
