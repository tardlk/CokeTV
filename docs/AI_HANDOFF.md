# CokeTV 接手记录

更新：2026-10-26。当前源码版本 **0.2.1**，用户已明确 **只保留 drpy3 一个源执行引擎**；工作方式继续直接在 `main` 工作，不主动创建分支或 PR。

## 0. 当前接手入口（先看本节）

- **先读顺序**：`AGENTS.md`（用户已确认的产品与安全决定）→ 本文件 → `README.md`、`SECURITY.md`、`docs/CONFIGURATION.md`、`docs/DEVELOPMENT.md`。
- **当前验证**（2026-10-26，macOS arm64 / Node 22.23.4）：`npm run check`、`npm run build` 通过；`npm test` 为后端 259 项（248 通过，11 项 data 目录站点脚本回归在空壳环境按设计跳过）+ 界面 77 项，共 336 项。
- **镜像（2026-10-26 已发布）**：`ghcr.io/tardlk/coketv:0.2.1`、`:0.2`、`:latest`、`:sha-cce9666` 指向同一 manifest digest `sha256:26412dbf3d5df18c42e6da8f89e9db02c16b5468cbbed74414a40547a7674d6e`（image ID `sha256:725346ef5680561df3e30cd100e5ae99079cf833779ffbb13ff6b4e058f88148`），源码提交 `cce9666e`。GitHub Release：https://github.com/tardlk/CokeTV/releases/tag/v0.2.1 。上一版 0.2.0 镜像保留 `:sha-70bcf98`（manifest `sha256:49742ce391ff294cd6baeb7f35e606f253c307c00ee7da05a0275ec83df9d61b`）；0.2.0 未单独打 Git tag，回退优先用 sha 标签。
- **发布门禁**：推送 `main`/`v*` 触发 `.github/workflows/docker.yml`；候选镜像先在原生 amd64 跑容器矩阵，再用同一镜像（不重建）发布 GHCR。本机没有 Docker，容器结论只能来自 Actions。
- **本机私有**：`HANDOFF.md`、`.tools/`、`data/` 不入库；不要拿正式用户 data 做删除、迁移或恢复实验。

## 当前架构

- `engine/libs/drpy3/`：上游 e5b89fd779de2a7552feec74d5bd020962ccd2f2 四文件原包，MIT；engine/UPSTREAM.json 登记哈希。内置 load2x 保持原样，CokeTV 不提供独立 DR2 入口。
- `src/drpy3.js`、`drpy3-loader.mjs`：HostEnv、标准库投影、ESM/CJS 和字节资产、持久 KV、多个详情 ID 聚合、多清晰度默认地址。源调用自己的服务地址时改走内部回环，重定向移除内部凭据。
- `src/worker.js` / `runner.js`：按需 drpy3 子进程、串行队列、超时回收与脱敏日志；无 Python 守护或旧插件启动。FTP/WebDAV 和源自定义 WS 仍按需提供宿主能力。
- `src/host/`：独立 HTML 解析、JSONPath、ENV 及网关辅助；来源与本地哈希在 UPSTREAM。宿主修改进入 src，不修改官方引擎原包。
- `src/store.js`：数据版本 v2、事务/历史、v1 预备份与旧源标记、显式代码迁移。数据只在 data，发行始终零预置源。
- `src/logging.js`、`src/backups.js`：stdio + 轮转文件日志（脱敏）、data 快照（定时/手动、保留份数、下载）。
- 网页、TVBox、猫影视、Emby 和 115/光鸭继续通过统一内容服务。CatVod 执行器已删除，猫影视连接程序保留；TVBox 配置链接导入和采集 JSON/XML 脚本生成器已移除。

## 旧数据处理

v1 首次启动先备份原数据至 backups/before-drpy3-*（排除备份本身与依赖链接），再刷新运行库。旧源停止执行、标记待迁移，原脚本/历史/ENV/参数和订阅引用保留。公开/订阅目录过滤旧源，API 不能重新启用旧引擎。

后台读取旧代码后人工改写，保存为 drpy3；保持共享该脚本的原实例 ID、ENV、参数与订阅引用，并恢复原启用状态。文件名冲突自动采用独立名称，不覆盖已有源；迁移失败回滚文件和状态。回退应停止服务并成对恢复旧代码及升级前 data 备份，不让两个版本同时写同一目录。

升级与协议回归在临时目录完成。随后本地预览已初始化 data，并按用户要求导入爱看机器人 drpy3 脚本；当前实际源、账号与配置以磁盘数据为准，不能自动覆盖或清空。该站点脚本与本机调试资料不进入发行树。NAS 未部署本轮版本。

## 已完成实现

移除 drpyS、独立 DR2 客户端库、CatVod、HIPY、PHP 执行器、桥接及旧源专用库；移除旧基线对照脚本与专项测试，保留并迁移公共协议/安全回归。后台新建/导入固定 drpy3，设置中不再出现 Python/PHP/浏览器路径或旧引擎插件。本地 JS/ZIP 导入支持模块和 WASM；旧格式明确拒绝。TVBox 链接导入页面、预览/提交 API、远程依赖下载、CMS 生成器及 coketv/cms 别名已删除，直接 JSON5 生产依赖已移除。新建与上传不再自动识别或选择引擎；观影和订阅选择器删除引擎筛选，管理列表只在有旧源时提供迁移状态筛选，不再重复显示引擎类型列。删除旧 map.txt 自动导入，保留版本升级备份与待迁移代码读取。本地解析器固定使用 drpy3，并覆盖网页播放和 /parse 入口。

2026-10-25：删除整个“连接与运行”设置模块及 `/admin/dependencies`，移除可配置对外地址和执行超时。订阅窗口直接使用 window.location.origin，TVBox/猫影视/Emby 一致；后端使用 Fastify 请求 protocol/host 生成接口与代理地址，默认忽略转发头，显式 TRUST_PROXY=1 时按可信代理转发头还原地址。同源保护使用同一来源规则，旧 publicUrl 不再额外放行其他 Origin。旧数据中的 publicUrl/timeout 不再影响运行，保存设置时不再写入；未手动修改现有用户配置。普通源操作默认 30 秒，action 60 秒；保留超时回收保护。

同日删除“代理与参数安全”整个界面与前端表单状态，当时设置页仅保留全局默认 ENV 及订阅扩展。后台策略与高级配置兼容保留；保存其他设置时，不重置被隐藏的 jsonPublic/allowPrivateTargets/targetAllowlist。用户 data 保持不变。

随后按用户要求删除整个设置页面和侧栏入口，以及其前端状态、保存逻辑与专属样式。后台运行配置/高级管理接口保留兼容，已有全局 ENV、解析器、直播及安全策略不清空；本源参数和 ENV 仍在源编辑页管理。

本轮按用户要求改为脚本级真删除：DELETE /admin/scripts/:id 和 /admin/scripts/batch 调用 Store.deleteScripts，实际删除脚本/历史/全部关联源 ENV 与持久 KV 并移除订阅引用，事务失败回滚。共享脚本的全部源一并删除，确认框明确提示数量；遗留孤立脚本进入管理列表可删除。移除实例新建与目录扫描入口/API，以及旧实例删除 API 和软删除选项，不再内部扫描；导入/新建脚本自动注册对应源。现有运行脚本仍留给用户确认删除，未自动清理 s.js 或爱看机器人。

网页观影对没有分类和首页影片、但可以搜索的源显示“请搜索影片”与直接聚焦搜索框的按钮，不再一律显示“暂无影片”。首页/搜索响应可选的 notice 仅按纯文本显示（最多 500 字符），用于说明站点浏览限制；切换查询时清除旧提示，不修改官方引擎。站点脚本和登录资料仍仅保存在忽略的本机运行目录。

2026-10-26（0.2.1）：运行日志改为 stdio 单行 JSON + `data/logs/coketv.log`（0600，5 MiB × 3 个历史文件），写入前隐藏 URL token、Authorization/Cookie 与 password 类赋值；后台新增“运行维护”页，可看最近 400 条、按级别过滤、下载日志。新增进程内数据快照：启动 60 秒后检查，默认每 24 小时创建、保留 7 份，zip 0600，包含状态/凭据/脚本与历史/ENV/KV/参数文件/解析脚本，不含运行库；后台可立即创建与下载；删除脚本、批量迁移、导入配置前自动补快照（10 分钟节流，失败不阻断）。恢复步骤写入 CONFIGURATION。静态资源启用 gzip/br（阈值 1 KiB）与一年 immutable 缓存，HTML 统一 no-cache。版本升至 0.2.1；新增 logging/backups/maintenance-api/static-delivery 测试与运行维护 UI 测试。

生产依赖只保留宿主所需包，前端构建工具和测试库归开发依赖；新增 `@fastify/compress` 为生产依赖。Docker 不安装 Python/PHP、浏览器或 ffmpeg，保留证书和权限初始化工具。GitHub Verify 与原生 amd64 候选矩阵已同步；发布仍须核对同一 artifact/image ID/revision，不能重建后直接发布。

## 验证与发行边界

本机为 macOS arm64 / Node 22.23.4。0.2.1 完整 `npm test` 通过后端 259 项（248 通过、11 项 data 站点脚本在空壳下跳过）和界面 77 项，合计 336 项；`npm run check` 与 `npm run build` 通过。新增回归覆盖日志脱敏/轮转/权限、快照内容/保留/路径校验、维护接口鉴权与下载、静态资源压缩与缓存（无 dist 时跳过）。

2026-10-26 的 `70bcf98` 已在 GitHub Actions 原生 Linux amd64 上通过 Verify 与 Docker 候选矩阵（12 项容器检查、容器内 237 项回归 fail 0 / skipped 0），并用同一镜像发布 `ghcr.io/tardlk/coketv:latest` 与 `:sha-70bcf98`（manifest digest 见 §0）。本机仍无 Docker 及原生 amd64 环境，0.2.1 的容器结果以本次推送后的 Actions 为准；真实站点、真实 WASM 解密、异地客户端和 NAS 实机不在本轮验证范围。

上游百忙无果1、央视频-1 仅在临时目录经 CokeTV HTTP 接口运行上游固定响应；六环节、多清晰度、m3u8 与 WASM 桩 TS 代理通过，示例未进入发行树。完整真实 GET/HEAD/Range/HLS/二进制代理、CLI 和重启持久化脚本也在本机服务验证；另以仅安装生产依赖的独立临时副本复验。以上不等于原生 Linux amd64 Docker 验收、真实站点/真实 WASM 解密或异地客户端验收。

历史版本的 NAS 部署、镜像 digest 和过程记录留在 Git 历史。当前正式说明为 README、SECURITY、CONFIGURATION、DEVELOPMENT、NETDISK_DEVELOPMENT、THIRD_PARTY；私密 HANDOFF 和 .tools 不提交。
