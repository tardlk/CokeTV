# 开发与验证

## 工作范围

`src/` 是 CokeTV 宿主，`web/` 是 Vue 页面，`engine/` 保留 drpy-node 执行契约与必要依赖。GUI 显示三种语言，不改变五种引擎的内部标识。

不要修改 `data/runtime/` 来发布内核改动：内核修改应进入 `engine/`。原模块名、源上下文与代理返回语义需要保持兼容。

## 本地检查

```sh
npm run check     # 语法检查（src/scripts/web）+ 桥接语法检查（engine/spider/**）+ 空壳发行检查（spider 白名单 + engine 全域站点规则/清单扫描）
npm run build     # 干净克隆请先 build 再 test：页面路由集成测试需要 dist/index.html
npm test          # 后端 node:test + UI Vitest
```

`scripts/check-bridges.mjs` 对 `engine/spider/**` 的 Python/PHP/JS 文件做 `ast.parse` / `php -l` / `node --check`；Python 用 `ast.parse` 而非 `py_compile`，避免产生 `__pycache__` 触发空壳白名单告警。`scripts/check-shell.mjs` 除 `spider/` 的文件白名单外，还会扫整个 `engine/` 是否存在 `var rule=` / `class Spider` / `"sites":[`（判定前剔除整行注释），新增站点定义会让发行检查失败。

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

`.github/workflows/docker.yml` 在 main、v* 标签或手动运行时执行源码测试，然后在原生 x86 GitHub runner 构建 linux/amd64 镜像。先加载本地镜像，用 `scripts/container-smoke.mjs` 验证零源/首次密码/真实 JS、Python、PHP 调用，再发布 latest、sha-* 或版本标签到 GHCR。测试使用临时容器和临时数据，不能拿正式数据作构建输入。

本机无 Docker 引擎；2026-10-05 GitHub原生x86容器验收与发布已通过，见 [Docker amd64](https://github.com/tardlk/CokeTV/actions/runs/37252776569)。对应功能提交 `3b17276`，镜像 `ghcr.io/tardlk/coketv:sha-3b17276`，同digest也发布为latest，匿名拉取元数据已验证。失败时修复后重试，不在检查失败时发布。接手摘要见 `docs/AI_HANDOFF.md`。
