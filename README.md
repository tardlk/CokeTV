# CokeTV

基于 **drpy3** 的源执行、网页观影和 TVBox / 猫影视 / Emby 订阅服务。当前源码版本 **0.2.4**，只有 drpy3 一个源执行引擎，运行环境为 Node.js 22。Python、PHP、drpyS、CatVod 和独立 DR2 执行器已移除。

发行是空壳：不预装站点、解析脚本或站点资源。用户自行导入有权使用的本地 drpy3 脚本或 ZIP 源包。支持相对 ESM/CJS 模块、WASM、源参数、ENV 和实例独立存储。

## 源码启动

```sh
git clone https://github.com/tardlk/CokeTV.git
cd CokeTV
npm ci
npm run build
npm start
```

打开 [http://127.0.0.1:54058](http://127.0.0.1:54058) 直接观影；管理入口为 `/admin`。首次进入管理后台创建密码，没有默认账号或密码。脚本编辑、配置和管理 API 均要求管理密码。已有密码保留；`ADMIN_PASSWORD` 只在尚未创建密码时提供预设值，不覆盖已有密码。

后台可新建 drpy3 源，点击“导入脚本”直接选择 `.js` 或 ZIP 文件。编辑页提供代码、扩展参数、本源 ENV、接口验证和脱敏日志；未保存的修改会阻止验证并提供退出保护。已有运行环境也可使用 `./start.sh`。从零写一个站点源见 [源开发指南](docs/SOURCE_DEVELOPMENT.md)。

## Docker

镜像通过 GitHub Actions 在原生 Linux amd64 上构建并验收后发布到 `ghcr.io/tardlk/coketv`。源码改动不代表 `latest` 已更新，实际镜像功能以对应提交的发布结果为准。

```sh
mkdir -p data
docker compose up -d
```

Compose 挂载 `./data:/app/data`，默认端口 54058。支持 `PUID`/`PGID`（默认 1000:1000）；NAS 用户为 1000:10 时可设置 `PGID=10`。入口先修正 CokeTV 专用 data 目录的权限，再以普通账号运行服务并清除能力；目录 0700、私密文件 0600。不要挂载共享文件夹根目录或其他项目目录。显式指定 Docker `user` 会跳过入口权限初始化，需自行保证目录可写。

镜像只安装 Node 与必要系统工具，不安装 Python/PHP、浏览器或 ffmpeg；网页使用客户端播放器，不提供服务器转码。

## 观影、订阅和网盘

- 网页支持浏览、搜索、详情、多线路选集、播放、收藏和续播；观看记录保存在浏览器本地。
- 每条订阅选择启用源并排序。TVBox 入口 `/tvbox/<Token>`，统一输出服务器 type4 API；猫影视入口 `/cat/<Token>/index.js.md5`，由轻量连接程序调用服务器，不下发源脚本或 ENV。
- 同一订阅的 Emby 登录使用服务根地址、用户名 `coke`、密码为该订阅 Token；自动准备所选源的有限推荐目录，保留稳定 ID、收藏和续播，不默认扫描全站。
- 115、光鸭账号在管理后台配置，凭据仅保存在服务器。分享目录展开及播放由统一网盘模块处理，默认客户端直连临时媒体地址；显式代理继续受鉴权和出口策略约束。
- 后台“运行维护”页可查看运行日志、立即创建并下载 data 快照。日志同时写 `data/logs/`（5 MiB 轮转）和 stdio，URL/JSON 中的令牌、Cookie 与授权头在写盘前脱敏；快照每 24 小时自动创建、保留最近 7 份，含管理凭据、网盘授权与 Emby 数据库副本，应按私密数据处理。
- 光鸭按需转存默认关闭，开启后只在 CokeTV 专用目录新增所选视频副本并复用，不移动或删除原文件。

## 配置与使用

### 启动配置

Node.js 22 是唯一语言运行环境。`HOST` 默认 `0.0.0.0`，`PORT` 默认 `54058`，`DATA_DIR` 默认项目内 `data/`；`TZ` 可设 `Asia/Shanghai`。`ADMIN_PASSWORD` 仅在未创建密码时生效。`TRUST_PROXY=1` 只用于可信且会覆写转发头的反向代理。`SOURCE_WORKERS` 控制源执行 worker 池大小（1–4，默认 2）：同一源串行，不同源可并行；worker 0 同时承载网关/WS。

### 运行日志

日志默认同时输出到 stdio（单行 JSON，`docker logs` 可见）和 `data/logs/coketv.log`（文件 0600、目录 0700，单文件 5 MiB，保留 3 个历史文件）。后台“运行维护 → 运行日志”可查看最近 400 条、按级别过滤并下载整份日志。

- `LOG_FILE=0` 关闭文件日志；也可设为绝对路径或相对数据目录的路径。
- `LOG_MAX_BYTES` 调整单文件上限，`LOG_KEEP` 调整保留的历史文件数。
- `LOG_STDOUT=0` 关闭 stdio 输出（文件日志仍保留）。
- URL/JSON 中的 token、`Authorization`/`Cookie` 头与 `password=` 类赋值会在写入前替换为 `[redacted]`；源脚本自行拼接的非标准格式不会被自动识别，日志仍应按私密数据处理。

### drpy3 脚本

后台新建、上传和编辑统一使用 drpy3，不再选择执行引擎。一个最小源为：

```js
export default {
    meta: {title: '我的源', lang: 'dr3'},
    rule: {host: '', class_name: '电影', class_url: 'movie'},
};
```

可按需要添加 `async init(ctx, extend)`、`home(ctx, filter)`、`homeVod(ctx)`、`category(ctx, tid, pg, filter, extend)`、`search(ctx, wd, quick, pg)`、`detail(ctx, id)`、`play(ctx, flag, id, flags)`、`proxy(ctx, params)`、`action(ctx, name, value)`。返回 TVBox 对象结构；详情含 `vod_play_from/vod_play_url`。宿主对多个详情 ID 逐一调用并合并。

网络与解析使用 `ctx.req`、`ctx.pdfh/pdfa/pd/pdfl` 等标准 API，CryptoJS 等库及纯工具由官方运行库提供。`ctx.store` 按实例持久化到 `runtime/data/drpy3/`，worker 重启后保留；删除脚本时一并清理关联源的此缓存。多清晰度 `urls` 数组完整保留，并将第一个地址提供给共享网页/Emby 播放流程。

后台不提供独立“设置”页面；源参数与本源 ENV 仍在各源编辑页配置。已有全局默认 ENV、解析器/直播与后台策略保留兼容，不会因删除页面清空。扩展参数通过 `init(ctx, extend)` 传入；`ENV.get/set/delete` 提供本源变量读写，未定义时回退全局值。

JS 模块与源同权限执行；只使用可信代码。小说、漫画、站点专用交互和网页嗅探是否可用取决于客户端能力，不能仅凭引擎加载成功认定所有源都可播放。

### 文件与 ZIP 导入

单文件入口使用 `.js`；顶层 `_` 前缀文件视为辅助模块。ZIP 可直接在根目录放入口，或指定目录：

```text
spider/js_dr3/源.js
spider/js_dr3/lib/helper.mjs
spider/js_dr3/lib/helper.cjs
spider/js_dr3/lib/module.wasm
json/参数.json
jx/解析.js
```

原生模块可使用 `import {defineSource} from 'drpy3'`；相对 ESM/CJS 与 `?bytes` 资产导入均受支持。子目录文件不自动注册为源，顶层辅助 JS 使用 `_` 前缀。ZIP 拒绝越界、隐藏路径和符号链接；最多 1000 文件，单个解压不超过 8 MiB、合计不超过 32 MiB。相同内容复用，不同内容拒绝覆盖；写入或状态保存失败会回滚本次文件操作，回滚失败时保留 `.rollback` 备份并明确报错。这不等于断电时的跨文件事务保证。

### 本源配置和删除

代码、扩展参数、ENV 分别保存；未保存时禁用接口验证，离开页面会提示保留或放弃。源参数/ENV 仅管理员可读；源的实际网络请求和账号权限仍由对应站点决定。

确认删除后，实际移除脚本文件、历史版本、该脚本所有关联源的 ENV 及持久 KV，并移除订阅引用。多个源共用一个脚本时一并删除，确认框显示关联数量；批量删除按脚本去重。未使用脚本同样显示在管理列表供删除，不自动清理其他脚本或共享辅助模块。文件或状态失败会回滚。

### 数据快照与恢复

服务启动 60 秒后检查一次快照，之后按 `BACKUP_INTERVAL_HOURS`（默认 24 小时）自动创建，保留最近 `BACKUP_KEEP`（默认 7）份，位于 `data/backups/`；快照文件 0600、目录 0700，不含可重建的 `runtime/libs` 与 `node_modules` 链接，也不含日志和快照目录本身。zip 压缩与文件读取在独立 worker 线程完成，不阻塞 HTTP/播放主循环。

快照内容包括 `state.json`、`admin.json`、`revisions/`、`netdisk/`、`runtime/spider/`、`runtime/config/`、`runtime/data/`、`runtime/json/` 和 `runtime/jx/`，覆盖管理状态、凭据哈希、源脚本与历史、源 ENV、持久 KV、参数文件、解析脚本以及 115/光鸭授权。Emby 的 `emby/emby.sqlite` 通过 SQLite `VACUUM INTO` 生成一致性副本后加入。源脚本和凭据都在其中，下载或转存时按私密数据保管。

后台“运行维护 → 数据快照”可立即创建并下载；删除脚本、批量迁移和导入配置前也会自动补一份快照（10 分钟内已有快照则复用），失败只记警告、不阻断操作。恢复步骤：停止服务 → 先备份当前 `data/` → 将 zip 解压覆盖到 `data/` 根目录 → 启动；不要让新旧进程同时写同一目录。旧版 `/admin/export` 只导出状态与 ENV，不包含脚本文件，完整恢复以本快照为准。

### 订阅与 Emby

订阅链接自动跟随浏览器当前访问的协议、域名或 IP 和端口。例如通过 `http://abc.com:54058/admin` 访问时，链接以 `http://abc.com:54058` 开头；改用内网 IP 访问，链接随之改用该 IP。TVBox、猫影视和 Emby 采用相同规则，无需配置固定对外地址。后端按当前请求地址生成源接口与代理地址；旧配置中的 `publicUrl` 不再生效。

反向代理应保留访问 Host；HTTPS 终止或改写 Host 时，由可信代理覆盖 `X-Forwarded-Host`、`X-Forwarded-Proto`，并显式设置 `TRUST_PROXY=1`。默认不信任转发头。

执行超时使用内部默认值：普通源操作 30 秒，交互 action 60 秒；首页 home 和 homeVod 分别计时。TVBox 使用 `/tvbox/<Token>`，站点为服务器 type4 API；猫影视使用 `/cat/<Token>/index.js.md5`。订阅停用、删除、Token 修改或源移除使旧访问失效。Token 不应写入公开文档。

订阅链接弹窗中的 Emby 使用服务根地址、用户名 `coke`、密码为对应订阅 Token。自动准备所选启用源的有限推荐目录；不默认全站扫描。稳定媒体 ID、播放状态和会话按订阅隔离，重复 Token 拒绝登录；保留 `/emby` 前缀兼容。客户端解码能力和公网可用性需分别验证。

### 网盘账号与播放

115/光鸭账号保存在 `data/netdisk` 私密文件中，后台不回显凭据。源详情返回分享链接后由宿主展开分集和获取临时地址；默认客户端直连，失败不自动回退服务器中转。账号 Cookie 不下发客户端。

光鸭按需转存默认关闭；开启后只在 CokeTV 专用目录新增选中视频副本并复用，保留平台权限和流量限制，不删除或移动原内容。更换/移除本机授权会撤销旧播放引用，不触碰云盘另一账号或原文件。网盘源开发契约见 `docs/AI_HANDOFF.md`。

### 播放、代理与解析

网页播放器支持现有 HLS、FLV/TS、浏览器原生媒体；不提供服务器转码。浏览器播放不要求管理密码。普通源请求头留在服务器，由短期媒体票据绑定 URL 与权限；支持 GET/HEAD/Range、HLS 子清单、KEY/MAP 和分片派生票据。

可配置外部 JSON/网页解析地址。`jx/` 内的本地解析脚本须改为 drpy3 格式，入口使用 `play(ctx, flag, id)`；旧 drpyS `jx` 脚本不会由旧引擎执行。FTP/WebDAV 辅助网关按需启动，继续要求对应身份与出口权限。

参数文件 `/json/*` 默认私有；管理员、有效订阅与内部调用可按权限读取。匿名媒体及订阅出口禁止私网/回环/链路本地/元数据；管理员/内部源的可信出口受 `allowPrivateTargets` 和 `targetAllowlist` 控制。这些策略在后台保留，设置页不再显示“代理与参数安全”模块；保存其他设置不会重置已有策略。高级部署的信任边界见 `SECURITY.md`。

## 从多引擎版本升级

**0.2 系列是脚本兼容范围的主动收敛。** 原生 drpy3 源继续运行；drpyS、DR2、CatVod、Python、PHP 脚本需要改写后才能使用。drpy3 官方包内置的 `load2x` 保持原样，但 CokeTV 不单独提供 DR2 导入或执行入口。

首次读取 v1 数据时，程序在刷新运行库前将已有数据备份至 `data/backups/before-drpy3-*`，然后将旧源标记为“待迁移”并停止执行。原脚本、参数、ENV、历史和订阅引用保留；公开观影和订阅列表不输出待迁移源。后台可查看旧代码，改写后点击“保存为 drpy3”，保留原实例 ID、参数、ENV 和订阅关系。迁移不会自动翻译源代码。

回退旧版本前停止服务并恢复升级前备份的专用 data 目录；不要让旧版本与新版本同时写同一目录。代码版本和数据版本应成对恢复。

## 安全边界

**导入的源脚本与宿主同权限执行，能够访问文件系统和网络；子进程隔离用于执行管理与超时回收，不是安全沙箱。** 只导入可信脚本，不向不可信人员提供管理密码。

公开观影不要求密码，但不返回脚本、源参数、ENV、账号凭据或订阅 Token。管理鉴权以匹配到的路由为准；写请求进行来源校验。媒体使用短期随机票据，匿名与订阅调用不能借代理访问私网、回环或云元数据；管理员和内部运行时保留受设置控制的内网能力。详见 [SECURITY.md](SECURITY.md)。

## 开发与验证

```sh
npm ci
npm run check
npm run build
npm test
npm run verify -- <源实例ID> [服务地址] --password-stdin
```

`npm run check` 覆盖语法、未定义变量、唯一引擎空壳清单和来源哈希；node:test 验证后端，Vitest 验证 UI。`npm test` 不依赖 Python/PHP；`tests/site-sources.test.js` 需要 data 目录中的实际站点脚本，空壳发行或 CI 无脚本时整组跳过。

测试重点包括 drpy3 六环节/模块与 WASM、HTTP/媒体/Range/HLS、TVBox/猫影视/Emby、鉴权/SSRF/出口票据、网盘、日志/快照/权限和事务回滚。`tests/helpers/drpy3-fixture.js` 仅生成测试用原生 drpy3 钩子，不被产品导入或随镜像分发。

容器发行由 GitHub Actions 在原生 Linux amd64 完成：构建候选镜像后运行容器矩阵（零预置源、非 root、权限、真实 GET/HEAD/Range/HLS、CLI、重启持久化、损坏数据拒绝启动），再用同一镜像发布 GHCR，不二次构建。手动运行默认 dry-run；PR 不发布。源码测试通过不等于真实站点、实际客户端或 NAS 实机通过。

`npm run verify` 支持终端隐藏输入，非交互从 stdin 或 `ADMIN_PASSWORD` 读取密码，不读取本地明文凭据。可诊断远端服务；输出不得包含管理密码或源 ENV。

贡献边界：保留公开观影与管理鉴权分离、路由匹配鉴权、来源校验、短期随机媒体票据及 public/subscription/trusted 出口继承。源与宿主同权限，不将 worker 描述为沙箱。发行始终零预置站点，不增加默认站点下载、全站扫描或 Android JAR 运行器。

## 第三方与许可

CokeTV 按根目录 GPL-3.0 分发。唯一源执行引擎取自 [hjdhnx/drpy3](https://github.com/hjdhnx/drpy3/tree/e5b89fd779de2a7552feec74d5bd020962ccd2f2)（0.1.0，提交 `e5b89fd…`），四文件原样保存在 `engine/libs/drpy3/`，MIT 文本在 `LICENSES/drpy3-MIT.txt`，哈希登记于 `engine/UPSTREAM.json`。

`src/host/` 的解析、JSONPath、FTP/WebDAV/源环境/代理工具源自固定的 [hjdhnx/drpy-node](https://github.com/hjdhnx/drpy-node) 2.0.6 宿主辅助代码，已去除旧内核工具链依赖。Vue、shadcn-vue/Reka UI、Monaco、Lucide、DM Sans、ArtPlayer、HLS.js、mpegts.js 按各包许可使用。

115 协议参考 [SheltonZhu/115driver v1.3.5](https://github.com/SheltonZhu/115driver/tree/v1.3.5)，MIT 声明在 `LICENSES/115driver.txt`。光鸭模块为独立实现，协议字段参考 LitePan（PolyForm Noncommercial）、OpenList（AGPL-3.0）及 ChenyangGao/guangyapan；未复制/执行其驱动。`src/cat-client.cjs` 为独立 Node 连接程序；`src/emby/` 按项目所有者授权参考 [sd87671067/go-emby](https://github.com/sd87671067/go-emby)，未引入 Go 二进制或外部数据库。

其余依赖记录在 `package.json`/`package-lock.json`。node-forge、TypeScript 与测试直接使用的 undici 归开发依赖；Cheerio 等生产包仍会带入其传递依赖。

## 文档

- [docs/SOURCE_DEVELOPMENT.md](docs/SOURCE_DEVELOPMENT.md)：从零编写 drpy3 站点源、调试、导入和发布。
- [SECURITY.md](SECURITY.md)：信任边界、鉴权、SSRF、依赖审计与部署建议。
- [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md)：架构、版本/镜像、发布验收、网盘开发契约。
- [AGENTS.md](AGENTS.md)：AI 接手约定与用户已确认的产品决策。
