# CokeTV

基于 drpy-node 兼容内核的源执行与 TVBox 订阅管理服务。

CokeTV 集中提供服务器执行脚本、TVBox 订阅和网页管理。保留 JS、DR2、CatVod、PHP、HIPY 的运行入口；列表按语言显示 JS、Python、PHP。管理界面参考 OmniBox，源执行仍沿用 drpy-node 协议。

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

打开 [http://127.0.0.1:5758](http://127.0.0.1:5758)。首次启动生成 `data/admin.json`，其中保存管理员账号和密码。也可以通过 `ADMIN_USER`、`ADMIN_PASSWORD` 指定已有登录配置。

已安装运行环境并构建前端后，可以用 `./start.sh` 启动。本机开发工具若放在 `.tools/`，启动脚本会自动识别；这些工具不随仓库分发。

PHP 源按需要安装 curl、mbstring、xml 等扩展。浏览器、外部插件、Cookie、Token 以及源专用依赖按实际源配置。

## Docker

```sh
docker compose up -d --build
```

镜像使用 Node.js 22，包含 Python、PHP、ffmpeg。`./data` 挂载到容器持久化数据。需要浏览器时：

```sh
docker build --build-arg INSTALL_BROWSER=1 -t coketv:0.1.0 .
```

浏览器路径填写 `/usr/bin/chromium`。本地尚未完成 Docker 构建与 Linux 实机验收。

## 使用流程

1. **添加源**：选择 JS、Python 或 PHP，填写脚本名，保存后进入编辑页。自动补文件后缀，同名脚本不会被覆盖。
2. **导入源**：点击导入直接选择 `.js`、`.py`、`.php` 或 ZIP。自动识别语言、明确的 JS 运行格式及源包目录；不明确的 JS 再选择 drpyS、DR2 或 CatVod。
3. **编辑与验证**：编辑页提供 Monaco 代码编辑器、本源环境变量、扩展参数、接口预览和日志。代码与配置独立保存，验证使用已保存版本。
4. **管理列表**：单击名称重命名；列表开关控制启用、搜索和筛选；勾选源后批量启用或停用。扫描源目录、新建参数化实例在设置页。
5. **生成订阅**：创建订阅，选择源并排序，复制地址填入 TVBox。修改后刷新 TVBox 配置生效。

TVBox 在另一台设备上时，在设置中填写可达的服务对外地址，例如 `http://192.168.1.10:5758`。停用源不会出现在订阅中；删除实例会移除订阅引用，原脚本仍保留。

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
data/admin.json                    管理登录信息
data/state.json                    源实例、订阅与设置
data/runtime/                      运行内核副本、源与辅助资源
data/runtime/config/source-env/    按源实例保存的环境变量
data/revisions/                    脚本历史版本
```

首次启动复制初始源与资源；后续启动刷新内核代码，保留用户源与配置。备份整个 `data/` 可完整恢复。管理配置导出包含源环境变量，不包含脚本和插件二进制。

详见 [配置与源包](docs/CONFIGURATION.md) 和 [开发说明](docs/DEVELOPMENT.md)。

## 开发

```sh
npm test
npm run check
npm run build
```

测试覆盖源协议、环境隔离、订阅、代理、执行进程回收与 UI 操作。多语言测试使用真实 Python/PHP；可通过 `TEST_PYTHON`、`TEST_PHP` 指定路径。

GitHub Actions 已配置相同检查，尚未在远程执行。

## 项目目录

```text
src/          HTTP 服务、源调度、管理数据、订阅
web/          Vue 管理界面与 UI 组件
engine/       drpy-node 兼容内核、初始源与辅助资源
tests/        固定样本、协议与 UI 回归
scripts/      检查与验证工具
docs/         正式配置及开发文档
.github/      持续集成配置
```

本机运行数据、工具、依赖、构建输出、调研历史和截图由 `.gitignore` 排除。

## 许可证

保留原内核的 GPL-3.0，见 [LICENSE](LICENSE)。第三方依赖和 UI 组件保留各自许可，见 [来源说明](docs/THIRD_PARTY.md)。
