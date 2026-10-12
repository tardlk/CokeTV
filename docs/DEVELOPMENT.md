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

`npm test` 顺序执行后端 node:test 和 UI Vitest。测试用临时数据目录，不改写现有用户源。

多语言集成测试优先寻找 `.tools/` 下的本机解释器，也可指定：

```sh
TEST_PYTHON="$PWD/.venv/bin/python3" TEST_PHP=php npm test
```

测试实际调用 Python/PHP。未安装解释器时应修复环境，不能用模拟解释器冒充通过。

## 当前验证

本机验证为 macOS arm64，GitHub 源码检查及容器验收运行在原生 Linux amd64；具体解释器版本以对应日志与报告为准。测试数量以 `npm test` 输出为准，语法检查文件数量以 `npm run check` 输出为准；本节不维护固定计数。最新已执行的命令与结果统一见 [当前接手入口](AI_HANDOFF.md#0-当前接手入口先看本节)及其指向的发行记录。测试涵盖：

- JS、CatVod、HIPY、PHP、DR2 的首页、分类、搜索、详情、播放与代理协议。
- 各引擎实例参数、JavaScript 源级 ENV 上下文、配置持久化、备份与订阅范围；本源 ENV 不自动映射到 Python/PHP 系统环境。
- 二进制代理、Range/206、HLS 分片与 key 改写。
- 旧 PHP/Python 运行副本升级、五引擎升级后执行，以及用户脚本、辅助文件、ENV、订阅、配置与历史保留；JSON 入站可用且旧 pickle 入站被拒绝。
- 随机媒体/分片票据保密、过期与容量回收、URL/源/路由范围，以及长签名地址的实际媒体跟随、Range 和 HEAD。
- IPv4/IPv6/映射地址和元数据判定、受控两次 DNS 答案、每跳连接地址绑定、Host/TLS SNI 与真实证书校验，以及 `/http` 的重定向出口和方法/请求体/头/响应兼容。
- PHP 普通/初始化/解释器失败的安全错误、脱敏诊断与参数编码/嵌套 ENV/JSON 标量边界，以及私密临时文件权限、设置/导入/重启和引擎 ENV 写入的 0600 保持。
- PHP 多层继承/trait 的最近声明与同层候选顺序，以及真实 verify CLI 的 v2/旧凭据迁移、stdin、远端服务与终端不回显/取消恢复。
- 源导入、压缩源编辑、语法检查、版本恢复与同名创建保护。
- 文件写入/state 提交失败后的脚本与 ZIP 整包回滚、同名冲突拒绝、已有历史保留与再次保存。
- 多层网盘 HLS/KEY/MAP 的源及账号范围继承，固定 FTP GET/Range/HEAD 协议，以及网关首次并发启动、失败与超时释放。
- 同步死循环回收，后续调用与管理服务可继续运行。
- UI 创建后跳转、重命名、语言筛选、订阅排序、配置表单与退出保护。
- 编辑页未保存代码、参数和 ENV 的取消/放弃，以及浏览器 history 前进/后退的位置恢复。
- 批量删除确认/取消、所选实例 ID、订阅引用清理与脚本/ENV保留，删除接口继续要求管理密码。
- 匿名观影、管理鉴权、只读执行、播放短期凭证、Range/206、HLS 分片与密钥请求头、JSON 解析和源代理范围。
- 网页搜索、详情、线路/选集、直接刷新、收藏和切集时过期响应处理。
- 搜索下拉、点击图标/表单提交、空输入与不支持搜索的源、首页失败时仍可搜索、桌面/手机影视站选源入口。
- 未登录/首次部署首页与播放直达、首次设置仅在管理入口、进入后台登录/退出/返回观影、公开请求不发送管理凭据、选源列表无参数与敏感配置。
- TVBox 链接预览只读、五种引擎识别、JSON/XML 采集协议、CatVod 依赖、相对 URL/扩展参数、重复导入、文件冲突与持久化失败回滚。
- 采集首页简略列表没有封面时补取 JSON `ac=detail` / XML `ac=videolist`，协议相对封面地址转为完整 URL。

TVBox 链接导入位于 `src/tvbox-import.js`；生成的采集脚本调用 `engine/utils/tvbox-cms.js`，使用现有 CatVod 引擎，没有添加 Android JAR 运行器。`Store.importSources()` 在一笔状态事务内导入所选站点，创建文件失败或状态持久化失败时回滚新文件，保留既有源与订阅。ZIP 使用 `Store.importBundle()` 与文件事务，同名相同复用、不同内容拒绝，失败撤回本包变更；不能将运行中的文件事务等同于断电时的跨文件原子提交。

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

此入口是独立验证工具，不是生产依赖；正式入口为后台“网盘管理”的平台卡片与授权弹窗，UI使用NetdiskManager/Pan115Account/GuangyaAccount。两平台共用已有账号文件，无多账号迁移；扫码/已有授权分标签，卸载组件停止轮询并丢弃迟到回包。POST /admin/netdisk/:provider/account/remove检查当前revision，存储generation防止旧扫码或正在验证的导入在移除后写回；仅删除本机凭据，原revision媒体引用自动失效。UI回归在对应tests/ui文件，后台移除/待确认扫码/重启保护在netdisk-integration.test.js。`src/netdisk/service.js` 将标准详情分享链接展开为按实例/账号绑定的随机分集引用，源执行与网页/TVBox/猫影视共用该服务，媒体继续使用原票据和订阅范围。账号不进入源状态或导出。不要用正式 data 作为独立验证目录。扫描确认需要用户本人操作；固定样本通过不等于所有真实账号和分享均可用。验证过程不使用转存、上传或删除接口。

`tests/netdisk-integration.test.js` 覆盖正式后台鉴权、详情展开、网页/TVBox/猫影视、实例/订阅范围、账号更新/源停用后的媒体引用失效；`tests/ui/netdisk-manager.test.js` 覆盖扫码界面与离开页面停止轮询。`tests/netdisk-115.test.js` 覆盖链接校验、私密持久化、扫码状态/超时/并发兑换、分页/文件夹/长 ID/边界与媒体头；`tests/netdisk-verification.test.js` 使用临时目录及本地样本验证鉴权、跨站拒绝、媒体范围、HLS、换账号失效和重启恢复。

## 源诊断

```sh
npm run verify -- <源实例ID> [服务地址]
# 自动化可由密码管理工具将密码输出到 stdin：
npm run verify -- <源实例ID> [服务地址] --password-stdin
```

终端默认提示管理密码且不回显，支持 Unicode、空格、冒号与退格；Ctrl-C/Ctrl-D 取消，退出时恢复终端模式。已通过运行环境注入 `ADMIN_PASSWORD` 时直接使用该值；显式 `--password-stdin` 优先从管道读取至 EOF，只去掉一个末尾 LF/CRLF，保留密码首尾空格。在终端直接使用该选项时仍走隐藏提示，按回车提交。终端/stdin 输入上限为 4096 UTF-8 字节。非交互环境没有凭据或输入为空时明确失败，不发送源请求。`--help` 查看用法。

CLI 不读取本地 admin.json，不依赖 DATA_DIR，也不恢复或保存明文密码；本地 GUI 创建的 v2 哈希和远端服务使用同样的显式凭据方式。旧明文格式在服务端成功登录后照常迁移，迁移后命令仍可使用。CLI 的 `ADMIN_PASSWORD` 是要发送给目标服务的凭据，不会更改该服务已经保存的密码。首页、分类、详情诊断沿用原源协议；不要把真实密码写入命令行参数、文档、脚本或提交。这里使用本仓库的 verify CLI，不能与原 drpy-node-coder CLI 混称；本机实际验证范围见交接记录。

## 执行与前端加载

HTTP 服务启动时不初始化源引擎。执行子进程按需启动，可超时回收；顶层请求串行排队，上限 64。Python 与源辅助服务不额外开放公网端口。

`src/runtime-files.js` 登记 `spider/` 下随启动刷新的框架保留路径，并供空壳发行检查共用；新增桥接、基类或兼容辅助文件必须登记。更新时逐文件原子替换，不递归替换用户源目录。`tests/fixtures/legacy-runtime/` 冻结旧版本桥接，仅在临时目录用于升级回归，不进入镜像。

源编辑工作区与 Monaco 代码编辑器独立按需加载。管理列表打开时不加载代码编辑器。

`WatchApp.vue`、`WebPlayer.vue` 与 mpegts.js 同样按需加载，管理列表不加载播放器。公开源列表在 `/watch/sources`，网页播放 API 在 `/watch/sources/:id`；原 `/admin/watch/:id` 保留鉴权兼容入口。媒体凭证在 `src/playback.js`；不复用会写入 `lastCheck` 的接口验证入口。

## Emby module

`src/emby/` 以固定coke+订阅Token派生稳定观看身份，提供订阅鉴权、DTO、有限目录同步、SQLite持久状态及播放器接口；`src/content.js` 是网页、猫影视和Emby共用的源查询/播放interface，不通过伪造request调用另一协议handler。统一网盘内部 `identity()` 只用于稳定文件映射，不进入公开源结果；每次Emby播放重新读取详情，把稳定定位信息转换为当前内存分集引用。

Emby通过订阅链接弹窗提供三项连接信息，不设独立页面/全局开关。未使用且无旧数据库时启动不创建数据库；协议首次访问按需打开。有效目录访问或管理员POST订阅prepare才排队查询源，匿名发现和错误登录不执行源。自动目录串行准备，Mixed物理缓存投影为Movie/Series标准库，稳定视图ID与单一缓存避免重复查询。复用 `node-sqlite3-wasm`，单连接短事务，关闭等待自动/同步队列；所有路由别名共用观看授权，后台写入拒绝跨站请求。保留旧内部目录管理API以兼容已有数据，不重新提供独立产品入口。

`tests/emby.test.js` 覆盖授权、Infuse字段、收藏/续播/NextUp、版本、快照及私密媒体范围；`emby-engines.test.js` 以真实五引擎和固定平台样本验证 Range/HEAD、网盘重启后重新取链及服务端零媒体下载；`emby-storage.test.js` 覆盖并发初始化、回滚、重启、权限与坏文件保护。UI 回归在 `tests/ui/subscription-emby.test.js` 与 `tests/ui/console.test.js`；后端文件纳入容器矩阵。客户端真实请求检出的 VirtualFolders / DisplayPreferences 也纳入回归；本地生成样片/客户端账号不入发行。

## Git 约定

仓库只提交源码、依赖锁文件、正式文档和配置模板。`data/`、`.tools/`、`.venv/`、`node_modules/`、`dist/`、`.env` 和本地截图/调研历史均忽略。

本机若保留调研或旧界面资料，应放在忽略的 `docs/local-history/`，不参与代码构建或发布；该目录不随仓库分发，也不保证每台机器都存在。原始 drpy-node 对照源码应另行保存在 CokeTV 目录之外，不带入发行。

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

不要在正式 data 上验收。报告记录平台、UID、Node/Python/PHP、源码 SHA、镜像 ID、清单与零跳过 TAP；首次设密验收直接提交密码和确认密码，日志产物不记录管理密码。`.github/workflows/image-verify.yml` 匿名拉取给定固定 SHA/digest 后复用完整矩阵，产物保存到工作流。旧 `latest` 可供手动选择，但不能用它证明本次源码已发布。

本机是 macOS arm64，兼容运行 Docker 镜像不能冒充原生 amd64 验收。已核对的源码提交、固定镜像 digest 与发布前后验收统一见 [当前接手入口](AI_HANDOFF.md#0-当前接手入口先看本节)及该入口指向的发行记录；历史镜像只代表对应版本，本地门禁通过不代表新版本已经发布。


## 原版脚本兼容基线

同一脚本、同一配置，以固定原版镜像实际行为验收。执行基线已统一至作者drpy-node2.0.6，OCI index sha256:2edbbdd6608590eb821809d6c871bf3ed19e86dc61ede2aed7a6ff49fc2ebe24，revision c466cb162fbf9522570722449ca6706ced01cb2b；amd64/arm64 manifest与逐文件身份见engine/UPSTREAM.json。最初从2.0.4提取；此次同步Python基类、PHP代理上下文/流式大响应及路径/文件头辅助更新，并逐项登记Coke宿主补丁。不能将旧版本标签直接当作所有文件都有版本差异，也不能无审查覆盖鉴权、ENV隔离和脱敏补丁。

src/sources.js的isCatVodSource由文件/ZIP与TVBox导入共用，认可原版模块导出形态，明文ESM入口保留正文。src/worker.js按原版传递省略flag/flags、quick、filter和数字pg；无效分类筛选退回空对象，空homeVod保留home自身list。异步req和init({stype,skey,sourceKey,ext})保持原有内核实现。鉴权、源参数和本源ENV管理继续由CokeTV宿主处理。

回归在tests/source-compatibility.test.js与tests/tvbox-import.test.js，前者纳入容器矩阵。覆盖默认导出/别名、原版纯命名导出的实际失败、文件/ZIP/TVBox相对依赖、请求默认值、首页合并、req/local及ext包装。不要凭加载器里出现某个分支就声称该模块写法运行正常：原版2.0.6纯命名导出经过cloneDeep后确实报moduleObject.home is not a function，验收保留了这个结果。

本机忽略目录.tools/drpy-parity-20261012记录原版与CokeTV逐项对照，50个案例结果匹配：五引擎25个主接口请求，加CatVod模块/参数及运行接口25个请求；错误只比较来源脚本的错误语义，宿主错误前缀可不同。新增脚本兼容差异先建立可失败用例，再按同一版本原版实测修正。固定样本覆盖不等于任意外站脚本已全部实测，也不把原版已失败的TVBox同步req或直接ext写法作为CokeTV自动适配目标。

真实内置源应补充冷启动对照：每个源测试前重建worker，不能先运行JS源再据此判断CatVod独立可用。原版API控制器启动即导入drpyS，其共享初始化包括String.parseX、strExtract、lrcToSrt、DataBase和JsonBig。CokeTV首次加载CatVod时同样导入drpyS；仅导入drpyInject/moduleLoader会漏掉这些接口，BaseSpider.fetch().data因此可能在源自己的catch中被吞为列表为空。此修复没有执行额外JS站点或预置源。

2026-10-12固定原版2.0.6和本地候选镜像，在同一arm64 Linux VM网络以相同脚本及依赖/配置抽测47个真实内置源（JS27、CatVod8、HIPY6、PHP6）及2个原版控制源。修复后196组真实源请求、9组控制请求未发现原版有内容而Coke单独失败/丢失内容的回退；37个真实源至少在一项请求返回非空作品或播放协议内容，其余不能计为源可用通过。西饭/星芽推荐及听了么歌词另以同一批上游响应重放，两边输出逐字段一致。该抽测不覆盖所有302个目录候选、全部筛选分页、付费/登录内容或客户端解码；DR2客户端脚本及空XBPQ样例未计入通过。原版PHP缺DOMDocument而Coke提供该扩展，也不能称整个运行环境逐字相同。本机脱敏证据在.tools/builtin-parity-20261012，全量282项及17项独立源回归通过；发布状态见AI_HANDOFF第0节。

### 持续兼容门禁

`npm run check`中的check-engine校验158个执行文件及36项依赖声明，新增/修改文件必须更新原版来源或明确补丁理由。125文件与固定原版相同，27文件保留已登记宿主补丁，6文件为Coke适配/空目录占位；运行时生成的pycache不计入发行身份。对照样本和冻结响应也受哈希约束，禁止直接用Coke输出更新原版快照。

`npm test`中的runtime-parity使用46组离线固定输入与真实原版HTTP响应比较，覆盖CatVod冷启动、默认参数、Python部分实现/URL/十六进制/HLS/RSA/标量参数、PHP init前代理注入及11MiB输出、跨规则缺失/目标代理/方法返回、refresh重新初始化及首页/动作超时预算。刷新响应在Coke仍为确认信息，避免下发原版完整规则/配置；测试检查后续源状态，显式记录这项宿主边界，不冒充刷新响应逐字段相同。错误脱敏、JSON-only IPC、TLS默认校验及订阅范围继续保留。

`npm run test:parity`需要已有Docker：启动固定原版临时容器，无宿主数据挂载，先检查revision和清单中原版文件哈希，再让原版和Coke执行同一批42输入，与冻结响应三方比较。首页与推荐分别拥有单步预算，runner在收到推荐阶段消息后只重新计时一次；任一阶段阻塞仍会回收worker。动作超时按实际分支选择，不依赖ac字面值是否为action。结束删除临时容器；本轮新拉取的参考镜像也删除，已有共享参考镜像保留。可用SOURCE_PARITY_REPORT_DIR指定小体积JSON报告目录。Verify及Docker候选工作流均设置此门禁；新增工作流须实际运行后才可报告远端通过，配置完成不等于已发布。

DR2用原版type3客户端下发协议；原版两份运行库原样提供，受订阅Token保护的相对路径保留配套import。dr2-delivery回归检查下载鉴权、源范围/停用/Token撤销及实际客户端内核固定分类。旧dr2→drpyS服务端尝试保留，不能作为原版存在独立DR2服务端API的证据。原版XBPQ的test.json在实际API中返回rule.init is not a function，保留占位源码而不新增可用引擎声明。
