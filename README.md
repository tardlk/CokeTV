# CokeTV

基于 drpy-node 兼容内核的源执行与 TVBox / 猫影视订阅管理服务。

CokeTV 是不预装任何站点源的空壳，提供服务器执行脚本、TVBox 订阅、网页管理与网页观影。保留 JS、DR2、CatVod、PHP、HIPY 的运行入口；列表按语言显示 JS、Python、PHP。管理与播放界面参考 OmniBox，源执行仍沿用 drpy-node 协议。

仓库：[tardlk/CokeTV](https://github.com/tardlk/CokeTV)。当前版本：`0.1.0`。

## 快速开始

需要 Node.js 22。Python 与 PHP 源还需要对应解释器及依赖。

```sh
git clone https://github.com/tardlk/CokeTV.git
cd CokeTV
npm ci
npm run build

python3 -m venv .venv
.venv/bin/pip install -r engine/spider/py/base/requirements.txt
PYTHON_PATH="$PWD/.venv/bin/python3" PHP_PATH=php npm start
```

打开 [http://127.0.0.1:54058](http://127.0.0.1:54058) 直接进入观影首页，浏览、搜索和播放无需密码。进入“管理后台”（`/admin`）才需要访问密码；全新部署首次进入管理后台时直接填写新密码和确认密码，创建后进入后台，没有默认密码、用户或账号系统。通过页面创建的密码只以加盐 KDF 结果保存到 `data/admin.json`，重启后继续使用。尚未创建密码时，也可通过 `ADMIN_PASSWORD` 预设管理密码；已有管理密码时，该变量不会覆盖或重置它。环境变量方式只在内存中保留 KDF 结果，重启时需要继续提供该变量，并保护保存变量的 `.env` 或部署配置。

后台“网盘管理”支持 115 扫码登录，账号供源和订阅共用。源详情返回标准 115 分享链接后，服务器自动展开分集并处理播放；不会预置搜索站点、转存或删除网盘文件。账号保存和客户端限制见 [网盘配置](docs/CONFIGURATION.md#网盘账号与-115-分享)；爬虫作者请看 [网盘开发指南](docs/NETDISK_DEVELOPMENT.md)，包含详情格式、JS/Python 示例与排错说明。

已安装运行环境并构建前端后，可以用 `./start.sh` 启动。本机开发工具若放在 `.tools/`，启动脚本会自动识别；这些工具不随仓库分发。

PHP 源按需要安装 curl、mbstring、xml 等扩展。浏览器、外部插件、Cookie、Token 以及源专用依赖按实际源配置。

## Docker

镜像通过 GitHub Actions 构建、验收并发布到 GHCR，仅提供 **linux/amd64（x86-64）**：

```sh
docker pull --platform linux/amd64 ghcr.io/tardlk/coketv:latest
mkdir -p data
# 首次部署时，确保绑定目录可由容器 UID/GID 1000 写入。
docker run --rm -v "$(pwd)/data:/app/data" alpine chown -R 1000:1000 /app/data
docker compose up -d
```

也可以单独运行：

```sh
docker run -d --name coketv --platform linux/amd64 \
  -p 54058:54058 -v "$(pwd)/data:/app/data" \
  --cap-drop=ALL --security-opt=no-new-privileges:true \
  --restart unless-stopped ghcr.io/tardlk/coketv:latest
```

首次使用空数据目录时，源、解析、直播和环境变量均为空；进入 /admin 直接创建管理密码（或通过 `ADMIN_PASSWORD` 预设），再导入 TVBox 链接或自己的脚本。镜像保留 Node.js 22、Python、PHP、ffmpeg 及兼容辅助库。挂载的 data 持久化用户数据，更新镜像不会清空已有源。

镜像以**非 root 用户 `node`（UID/GID 1000）**运行。镜像内的数据目录已设置属主，新建命名卷会继承；`./data:/app/data` 这类主机目录挂载使用主机目录自身的属主，首次部署或旧数据升级都可能需要修正。主机目录挂载与命名卷的区别见 [Docker 官方说明](https://docs.docker.com/engine/storage/bind-mounts/)。若容器无法写入，请先停止正在使用该目录的服务，再确认并修正属主：

```sh
docker run --rm -v "$(pwd)/data:/app/data" alpine chown -R 1000:1000 /app/data
```

现有部署更新前，先停止服务并备份完整 `data/`，再拉取镜像并启动；不要删除数据目录或同时启动两个共享该目录的容器。Compose 默认只传入 `TZ`，不会自动把主机 `.env` 中的所有变量传给容器；需要 `ADMIN_PASSWORD` 等变量时，须在 `compose.yaml` 的 `environment` 中显式配置，或使用 `docker run -e`。

从源码构建 x86 镜像（可选浏览器）：

```sh
docker buildx build --platform linux/amd64 --load -t coketv:local .
docker buildx build --platform linux/amd64 --load \
  --build-arg INSTALL_BROWSER=1 -t coketv:browser .
```

浏览器版在设置中填写 /usr/bin/chromium。发布工作流在原生 amd64 验证空数据、五引擎实际媒体、旧框架升级、私密配置与同卷重启；验收后只发布同一镜像。PR 和手动默认 dry-run 只构建/验收，不写 GHCR。已核对的源码提交、固定镜像 digest 与发布前后验收记录统一见 [接手入口](docs/AI_HANDOFF.md#0-当前接手入口先看本节)，实时构建状态见 [GitHub Actions](https://github.com/tardlk/CokeTV/actions)。本地修改通过测试不代表运行容器或已发布镜像已更新。

## 使用流程

1. **添加源**：选择 JS、Python 或 PHP，填写脚本名，保存后进入编辑页。自动补文件后缀，同名脚本不会被覆盖。
2. **导入源**：点击导入，粘贴 TVBox 配置链接并读取，选择兼容项后导入。直接引用的 JS/Python/PHP 脚本会下载并识别，JSON/XML 采集接口会生成兼容源脚本，Android JAR 等不兼容项列出跳过原因。“本地文件”仍支持 `.js`、`.py`、`.php` 和 ZIP；不明确的 JS 再选择运行格式。
3. **编辑与验证**：编辑页提供 Monaco 代码编辑器、本源环境变量、扩展参数、接口预览和日志。代码与配置独立保存，验证使用已保存版本。
4. **管理列表**：单击名称重命名；列表开关控制启用、搜索和筛选；勾选源后批量启用、停用或删除。删除先确认，移除源实例及订阅引用，保留脚本文件。扫描源目录、新建参数化实例位于源管理工具栏。
5. **生成订阅**：创建订阅，选择源并排序。访问令牌支持自定义，新建留空自动生成；修改令牌后需在 TVBox 和猫影视更新链接。在“订阅链接”中选择 TVBox 或猫影视，复制简短地址（`/tvbox/<令牌>` 或 `/cat/<令牌>/index.js.md5`），原地址仍兼容。增减源、改名或调整顺序后，在播放器刷新订阅。
6. **网页观影**：侧栏进入“网页观影”，点击“影视站”选择已启用的源，浏览分类；搜索框点击后展开推荐和本地搜索记录，输入关键词后点击搜索或按回车。打开详情后选集、切换线路并播放。支持观看历史、续播和收藏；这些信息只保存在当前浏览器。

网页观影入口为 `/`（兼容 `/watch`），播放页面为 `/watch/play?source=<实例ID>&vod=<影片ID>`，直接访问和刷新都无需密码。播放器按需加载 ArtPlayer、HLS.js 与 mpegts.js，支持浏览器可解码的普通视频、HLS、FLV/TS。源要求解析时使用设置中的解析服务；没有解析配置、外部插件或站点凭据时会显示具体原因。TVBox 可以播放的编码不一定受浏览器支持。

TVBox 在另一台设备上时，在设置中填写可达的服务对外地址，例如 `http://192.168.1.10:54058`。停用源不会出现在订阅中；删除实例会移除订阅引用，原脚本仍保留。

### 猫影视 / Miraplay

订阅链接窗口的“猫影视”页提供 `index.js.md5` 入口。CokeTV 自动提供同目录的 `index.js`、`index.config.js` 和两个 MD5；不需要额外上传文件。适用于使用 CatPawOpen Node.js 接口的播放器，不适用于旧 QuickJS 配置入口。2026-10-08 用户已确认 iOS Miraplay 能导入并播放生成的 MP4 / 加密 HLS 样片；精确 App/iOS 版本未提供，其他版本和真实站点仍需分别验收，不能用本地协议测试代替。

手机端运行轻量连接程序，分类、分页、搜索、详情与源解析继续由 CokeTV 的五引擎执行；CokeTV 必须保持运行。连接配置只含服务端点与版本，不包含源脚本、源参数、ENV 或上游账号请求头。每次读取站点列表都检查当前订阅，停用源或订阅、移除源、删除订阅与重置 Token 后，新请求会被拒绝；已经下载到播放器缓冲区的媒体不会被追溯清除。

手机必须能访问设置中的“服务对外地址”。电脑上的 `127.0.0.1` 不能作为手机地址；容器还需具备相应的端口映射。局域网测试需同一 Wi-Fi，对外使用需自行配置可达的 HTTPS 服务。四文件下载入口使用路径中的订阅凭证，链接与下载的连接配置均应按私人订阅保管。重置链接会同时影响 TVBox 和猫影视。

直接视频使用 CokeTV 的媒体转发，保留源请求头、Range、HLS 主/子清单、分片、KEY 和 MAP；服务器里的 Cookie/Authorization 不下发到连接配置。已配置的 JSON / 本地脚本解析沿用服务器设置；普通网页可请求播放器提供的原生嗅探，没有能力或没有结果时明确报错。需要私密请求头的网页应配置服务器解析；没有实现通用网页解析或 DRM 解密。115 统一登录与分享播放由前述网盘模块提供；源站不可用仍可能导致播放失败。

## 安全边界（务必阅读）

接手复核登记的 R1–R10 已修复并随 `sha-c2a1f21` 发布，包括旧数据框架升级、媒体票据、宿主出口策略、PHP 异常脱敏、私密配置权限、多层继承方法选择和 verify CLI 凭据输入。保留项与验证边界见 [SECURITY.md](SECURITY.md) 和 [接手文档](docs/AI_HANDOFF.md#7-当前状态与下一步待办)。本地测试通过不代表已发布镜像包含这些修改，也不能替代容器和外部站点验收。

- 源脚本在服务器上以**与 CokeTV 相同的权限**执行：JS 源可直接调用 Node 的 `require`，Python/PHP 源可访问文件系统与网络。
  **导入任何第三方源（尤其是来路不明的 TVBox 订阅链接）= 允许其在你的服务器上执行任意代码。**
- 观影接口默认公开，管理密码只保护管理操作。公网部署若需限制观众，应在外部 HTTPS 网关增加访问鉴权和限流，并按 [安全策略](SECURITY.md) 收紧代理目标；只安装可信源。容器部署请参考 `compose.yaml` 的非 root/能力裁剪配置。
- 管理后台（`/admin`）的访问密码是唯一的管理凭据，请使用独立强口令，并保护好 `data/` 备份（其中含管理凭据与源 ENV）。
- 源的 `data/runtime/json/` 参数文件默认不再匿名可读：外部匿名请求被拒绝，源自身的回环请求带内部凭据放行。

## 兼容范围

| 引擎 | 语言 | 执行入口 |
| --- | --- | --- |
| drpyS / JS | JavaScript | 原规则引擎及上下文注入 |
| DR2 | JavaScript | DS 规则兼容入口，特殊规则需逐源验证 |
| CatVod | JavaScript | 原 ESM 适配及 `assets://` 加载 |
| HIPY | Python | 原 Python 桥接与按需 T4 守护进程 |
| PHP | PHP | 原 PHP Spider 桥接 |

保留原模块名 API/代理入口、网盘辅助库、WASM、源代理、Range/206、媒体流及 HLS 分片/key 地址改写。源引擎、Python 与辅助服务按需启动。

内核来自 drpy-node 2.0.4。旧播放器、音乐控制台、在线终端等外围页面未纳入 CokeTV。CatVod 此处指服务器支持的 JS 模块，不是 Android JAR 运行器。固定样本协议通过不等于所有第三方站点当前可播放。

## 数据与配置

用户运行数据在 `data/`，不进入 Git。

```text
data/admin.json                    访问密码配置
data/state.json                    源实例、订阅与设置
data/netdisk/115.json               统一 115 登录凭据（如已登录）
data/runtime/                      运行内核副本、源与辅助资源
data/runtime/config/source-env/    按源实例保存的环境变量
data/revisions/                    脚本历史版本
```

首次启动准备引擎辅助库和空源目录，不添加站点源；后续启动刷新 libs/libs_drpy/utils/controllers，并按 `src/runtime-files.js` 的框架保留路径清单原子更新 `runtime/spider` 中的桥接、基类和兼容辅助库，包括旧数据目录。清单以外的用户源、辅助文件、ENV、订阅、配置和脚本历史保留，不需要删除运行目录。框架修改应进入 `engine/`，运行副本中的框架保留路径会随启动刷新。备份整个 `data/` 可保留服务器数据——**其中可能含管理凭据哈希、115 登录凭据、源 ENV、源参数和订阅 Token，请妥善保管**；使用环境变量提供的配置和浏览器本地历史/收藏需另外备份。管理配置导出 API 不包含脚本、插件二进制或统一网盘账号，界面已移除配置导入/导出入口，详见 [备份与恢复](docs/CONFIGURATION.md#备份与恢复)。

详见 [配置与源包](docs/CONFIGURATION.md) 和 [开发说明](docs/DEVELOPMENT.md)。

## 开发

```sh
npm run check
npm run build
TEST_PYTHON=python3 TEST_PHP=php npm test
```

测试覆盖源协议、环境隔离、订阅、代理、执行进程回收与 UI 操作。多语言测试使用真实 Python/PHP；可通过 `TEST_PYTHON`、`TEST_PHP` 指定路径。

GitHub Actions执行相同检查，Docker工作流通过后才发布镜像。AI接手先读 [AGENTS.md](AGENTS.md) 和 [AI接手文档](docs/AI_HANDOFF.md)。

## 项目目录

```text
src/          HTTP 服务、源调度、管理数据、订阅
web/          Vue 管理界面与 UI 组件
engine/       drpy-node 兼容内核和辅助库，无预置站点
tests/        固定样本、协议与 UI 回归
scripts/      检查与验证工具
docs/         正式配置及开发文档
.github/      持续集成配置
```

本机运行数据、工具、依赖、构建输出、调研历史和截图由 `.gitignore` 排除。

## 许可证

保留原内核的 GPL-3.0，见 [LICENSE](LICENSE)。第三方依赖和 UI 组件保留各自许可，见 [来源说明](docs/THIRD_PARTY.md)。
