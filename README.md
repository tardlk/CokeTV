# CokeTV

基于 drpy-node 兼容内核的源执行与 TVBox 订阅管理服务。

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

打开 [http://127.0.0.1:54058](http://127.0.0.1:54058) 直接进入观影首页，浏览、搜索和播放无需密码。进入“管理后台”（`/admin`）才需要访问密码；全新部署首次进入管理后台时创建密码，**需要填写启动日志里打印的「初始化码」**（同时写入 `data/setup-code.txt`，创建成功后自动删除），没有默认密码、用户或账号系统。管理密码只保存加盐 KDF 结果到 `data/admin.json`（不会落盘明文），重启不会再次要求创建，也可以通过 `ADMIN_PASSWORD` 预设并跳过引导码。

已安装运行环境并构建前端后，可以用 `./start.sh` 启动。本机开发工具若放在 `.tools/`，启动脚本会自动识别；这些工具不随仓库分发。

PHP 源按需要安装 curl、mbstring、xml 等扩展。浏览器、外部插件、Cookie、Token 以及源专用依赖按实际源配置。

## Docker

镜像通过 GitHub Actions 构建、验收并发布到 GHCR，仅提供 **linux/amd64（x86-64）**：

```sh
docker pull --platform linux/amd64 ghcr.io/tardlk/coketv:latest
docker compose up -d
```

也可以单独运行：

```sh
docker run -d --name coketv --platform linux/amd64 \
  -p 54058:54058 -v "$(pwd)/data:/app/data" \
  --restart unless-stopped ghcr.io/tardlk/coketv:latest
```

首次使用空数据目录时，源、解析、直播和环境变量均为空；查看容器日志中的「初始化码」，进入 /admin 用它创建管理密码（或直接设置 `ADMIN_PASSWORD` 跳过），再导入 TVBox 链接或自己的脚本。镜像保留 Node.js 22、Python、PHP、ffmpeg 及兼容辅助库。挂载的 data 持久化用户数据，更新镜像不会清空已有源。

镜像以**非 root 用户 `node`** 运行，`data/` 的属主为 `node`。若挂载的是旧版本（root 属主）遗留的数据目录，需先修正属主，否则容器无法写入：

```sh
docker run --rm -v "$(pwd)/data:/app/data" alpine chown -R 1000:1000 /app/data
```

从源码构建 x86 镜像（可选浏览器）：

```sh
docker buildx build --platform linux/amd64 --load -t coketv:local .
docker buildx build --platform linux/amd64 --load \
  --build-arg INSTALL_BROWSER=1 -t coketv:browser .
```

浏览器版在设置中填写 /usr/bin/chromium。本地待发布工作流已扩展发布前门禁：原生 amd64 验证空数据、五引擎实际媒体、旧框架升级、私密配置与同卷重启；验收后只发布同一镜像。PR 和手动默认 dry-run 只构建/验收，不写 GHCR。本轮原生候选容器矩阵已在 [PR #1 工作流](https://github.com/tardlk/CokeTV/actions/runs/37456713645) 通过，发布任务 skipped；main 与 GHCR 镜像尚未更新。构建状态见 [GitHub Actions](https://github.com/tardlk/CokeTV/actions)。

## 使用流程

1. **添加源**：选择 JS、Python 或 PHP，填写脚本名，保存后进入编辑页。自动补文件后缀，同名脚本不会被覆盖。
2. **导入源**：点击导入，粘贴 TVBox 配置链接并读取，选择兼容项后导入。直接引用的 JS/Python/PHP 脚本会下载并识别，JSON/XML 采集接口会生成兼容源脚本，Android JAR 等不兼容项列出跳过原因。“本地文件”仍支持 `.js`、`.py`、`.php` 和 ZIP；不明确的 JS 再选择运行格式。
3. **编辑与验证**：编辑页提供 Monaco 代码编辑器、本源环境变量、扩展参数、接口预览和日志。代码与配置独立保存，验证使用已保存版本。
4. **管理列表**：单击名称重命名；列表开关控制启用、搜索和筛选；勾选源后批量启用、停用或删除。删除先确认，移除源实例及订阅引用，保留脚本文件。扫描源目录、新建参数化实例在设置页。
5. **生成订阅**：创建订阅，选择源并排序，复制地址填入 TVBox。修改后刷新 TVBox 配置生效。
6. **网页观影**：侧栏进入“网页观影”，点击“影视站”选择已启用的源，浏览分类；搜索框点击后展开推荐和本地搜索记录，输入关键词后点击搜索或按回车。打开详情后选集、切换线路并播放。支持观看历史、续播和收藏；这些信息只保存在当前浏览器。

网页观影入口为 `/`（兼容 `/watch`），播放页面为 `/watch/play?source=<实例ID>&vod=<影片ID>`，直接访问和刷新都无需密码。播放器按需加载 ArtPlayer、HLS.js 与 mpegts.js，支持浏览器可解码的普通视频、HLS、FLV/TS。源要求解析时使用设置中的解析服务；没有解析配置、外部插件或站点凭据时会显示具体原因。TVBox 可以播放的编码不一定受浏览器支持。

TVBox 在另一台设备上时，在设置中填写可达的服务对外地址，例如 `http://192.168.1.10:54058`。停用源不会出现在订阅中；删除实例会移除订阅引用，原脚本仍保留。

## 安全边界（务必阅读）

接手复核登记的 R1–R10 已在本地修复，包括旧数据框架升级、媒体票据、宿主出口策略、PHP 异常脱敏、私密配置权限、多层继承方法选择和 verify CLI 凭据输入。保留项与验证边界见 [SECURITY.md](SECURITY.md) 和 [接手文档](docs/AI_HANDOFF.md#7-当前状态与下一步待办)。本地测试通过不代表已发布镜像包含这些修改，也不能替代容器和外部站点验收。

- 源脚本在服务器上以**与 CokeTV 相同的权限**执行：JS 源可直接调用 Node 的 `require`，Python/PHP 源可访问文件系统与网络。
  **导入任何第三方源（尤其是来路不明的 TVBox 订阅链接）= 允许其在你的服务器上执行任意代码。**
- 因此：不要在公网无鉴权暴露本服务；不要导入不可信的源；生产部署请参考 `compose.yaml` 的非 root/能力裁剪示例。
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
data/runtime/                      运行内核副本、源与辅助资源
data/runtime/config/source-env/    按源实例保存的环境变量
data/revisions/                    脚本历史版本
```

首次启动准备引擎辅助库和空源目录，不添加站点源；后续启动刷新 libs/libs_drpy/utils/controllers，并按 `src/runtime-files.js` 的框架保留路径清单原子更新 `runtime/spider` 中的桥接、基类和兼容辅助库，包括旧数据目录。清单以外的用户源、辅助文件、ENV、订阅、配置和脚本历史保留，不需要删除运行目录。框架修改应进入 `engine/`，运行副本中的框架保留路径会随启动刷新。备份整个 `data/` 可完整恢复——**其中含管理凭据的加盐哈希、源 ENV 与源参数，请妥善保管**。管理配置导出包含源环境变量，不包含脚本和插件二进制。

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
