# 开发与验证

CokeTV 0.2.4 使用 Node.js 22，唯一源引擎为 drpy3。`src/` 是 HTTP/管理/订阅/网盘宿主，`src/host/` 是独立的解析、ENV和按需网关；`engine/libs/drpy3/` 保留官方原包四文件，版本与 SHA-256 见 UPSTREAM.json。`web/` 是 Vue 前端；用户运行文件仅放 data，不进入发行。

## 当前验证

```sh
npm ci
npm run check
npm run build
npm test
```

测试及语法文件数量以命令输出为准。检查覆盖语法、未定义变量、唯一引擎空壳清单和来源哈希；node:test 验证后端，Vitest 验证 UI。没有 Python/PHP 测试环境要求。

drpy-node 2.0.6 全源兼容基线及其旧引擎专项用例已退役；保留 HTTP/媒体/订阅/Emby/网盘/鉴权/SSRF/权限与事务回滚回归，并将协议样本迁为 drpy3。`tests/helpers/drpy3-fixture.js` 仅生成测试用的原生 drpy3 钩子，不被产品导入或随镜像分发。node-forge、TypeScript 与测试直接使用的 undici 是开发/验证依赖；生产镜像中 `cheerio` 仍会带入其传递依赖 `undici`（见 SECURITY 审计表），不能把“测试直接依赖”与“镜像内不存在”混为一谈。

`tests/logging.test.js`、`backups.test.js`、`maintenance-api.test.js` 分别覆盖日志脱敏（含 JSON 键值）/轮转/权限、快照内容（含网盘凭据与调用方一致副本）/保留份数/路径校验以及管理接口鉴权与下载；`tests/hardening.test.js` 覆盖图片上传的 SVG/魔数/权限和 WebDAV/FTP 配置接口的订阅越权阻断；`static-delivery.test.js` 验证带指纹资源长缓存、HTML 回源校验和压缩（未构建 dist 时跳过）。`tests/drpy3.test.js` 覆盖六环节、工具全局、存储和模块实例隔离、ESM/CJS/WASM、HTTP字符集/二进制/重定向、本地JS/ZIP导入与本地drpy3解析；`subscription-address.test.js` 验证域名/IP/IPv6与可信反代地址、旧地址覆盖失效、固定超时及退役检测API；`single-engine.test.js` 验证旧执行入口和已删除的链接导入API不可用、v1备份/升级、旧源过滤和迁移回滚；`site-sources.test.js` 针对data目录中的实际站点脚本做六环节、验证失败降级和媒体代理内网拦截回归，脚本不存在时整组跳过（发行空壳不受影响）。TVBox订阅、猫影视与Emby继续通过同一内容服务执行drpy3。

## 数据与生命周期

保留按需 worker 池（`SOURCE_WORKERS`，默认 2，范围 1–4）、每源串行队列、超时回收和独立的源实例状态；同一源固定在一个 worker 上串行，不同源可并行，worker 0 保留网关/WS 端口。不创建 Python 守护或旧引擎插件服务。drpy3 官方包保持原样，宿主适配修改进入 src；更新原包时记录提交、哈希并对照固定样本。

数据版本 v2：先备份旧数据再刷新运行库，旧源标记待迁移但保留文件/引用，迁移代码不会自动翻译。所有验证用临时 data；不能把历史真实环境记录当作当前机器状态，也不能拿正式用户数据做删除实验。

运行日志默认写 `data/logs/coketv.log`（5 MiB × 3 个历史文件，0600）并输出 stdio；数据快照由进程内定时器创建到 `data/backups/`，默认 24 小时、保留 7 份，不含运行库。两者都用临时 data 验证，测试结束后清理。

## 容器发行

GitHub Actions 在原生 Linux amd64 检查、构建、运行测试，再构建候选一次。container-matrix.mjs 验证实际镜像的零预置源、无Python/PHP、普通用户/权限修复、真实GET/HEAD/Range/HLS/CLI、重启数据与旧票据失效、异常数据拒绝启动等。验证代码和开发工具只在检查发行树后注入临时容器，不进入镜像。

发布作业必须加载同一已验收镜像，核对artifact摘要、镜像ID、平台与revision后才登录GHCR；不二次构建。手动运行默认dry-run，PR不发布。已有源码测试通过不等于容器、真实站点、实际客户端或公网环境通过；当前已执行结果见 AI_HANDOFF.md。

## verify CLI

```sh
npm run verify -- <实例ID> [服务地址] --password-stdin
```

终端支持隐藏输入，非交互从stdin或ADMIN_PASSWORD读取密码，不从本地凭据文件恢复明文。可诊断远端服务；输出不得包含管理密码或源ENV。

## 贡献边界

保留公开观影与管理鉴权分离、路由匹配鉴权、来源校验、短期随机媒体票据及public/subscription/trusted出口继承。源与宿主同权限，不将worker描述为沙箱。发行始终零预置站点，不增加默认站点下载、全站扫描或Android JAR运行器。
