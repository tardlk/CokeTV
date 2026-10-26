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

后台可新建 drpy3 源，点击“导入脚本”直接选择 `.js` 或 ZIP 文件。编辑页提供代码、扩展参数、本源 ENV、接口验证和脱敏日志；未保存的修改会阻止验证并提供退出保护。已有运行环境也可使用 `./start.sh`。

## Docker

镜像通过 GitHub Actions 在原生 Linux amd64 上构建并验收后发布到 `ghcr.io/tardlk/coketv`。源码改动不代表 `latest` 已更新，实际镜像功能以对应提交的发布结果为准。

```sh
mkdir -p data
docker compose up -d
```

Compose 挂载 `./data:/app/data`，默认端口 54058。支持 `PUID`/`PGID`（默认 1000:1000）；NAS 用户为 1000:10 时可设置 `PGID=10`。入口先修正 CokeTV 专用 data 目录的权限，再以普通账号运行服务并清除能力；目录 0700、私密文件 0600。不要挂载共享文件夹根目录或其他项目目录。显式指定 Docker `user` 会跳过入口权限初始化，需自行保证目录可写。

镜像只安装 Node 与必要系统工具，不安装 Python/PHP、浏览器或 ffmpeg；网页使用客户端播放器，不提供服务器转码。

## 从多引擎版本升级

**0.2 系列是脚本兼容范围的主动收敛。** 原生 drpy3 源继续运行；drpyS、DR2、CatVod、Python、PHP 脚本需要改写后才能使用。drpy3 官方包内置的 `load2x` 保持原样，但 CokeTV 不单独提供 DR2 导入或执行入口。

首次读取 v1 数据时，程序在刷新运行库前将已有数据备份至 `data/backups/before-drpy3-*`，然后将旧源标记为“待迁移”并停止执行。原脚本、参数、ENV、历史和订阅引用保留；公开观影和订阅列表不输出待迁移源。后台可查看旧代码，改写后点击“保存为 drpy3”，保留原实例 ID、参数、ENV 和订阅关系。迁移不会自动翻译源代码。

回退旧版本前停止服务并恢复升级前备份的专用 data 目录；不要让旧版本与新版本同时写同一目录。代码版本和数据版本应成对恢复。具体行为见 [配置说明](docs/CONFIGURATION.md)。

## 观影、订阅和网盘

- 网页支持浏览、搜索、详情、多线路选集、播放、收藏和续播；观看记录保存在浏览器本地。
- 每条订阅选择启用源并排序。TVBox 入口 `/tvbox/<Token>`，统一输出服务器 type4 API；猫影视入口 `/cat/<Token>/index.js.md5`，由轻量连接程序调用服务器，不下发源脚本或 ENV。
- 同一订阅的 Emby 登录使用服务根地址、用户名 `coke`、密码为该订阅 Token；自动准备所选源的有限推荐目录，保留稳定 ID、收藏和续播，不默认扫描全站。
- 115、光鸭账号在管理后台配置，凭据仅保存在服务器。分享目录展开及播放由统一网盘模块处理，默认客户端直连临时媒体地址；显式代理继续受鉴权和出口策略约束。
- 后台“运行维护”页可查看运行日志、立即创建并下载 data 快照。日志同时写 `data/logs/`（5 MiB 轮转）和 stdio，URL/JSON 中的令牌、Cookie 与授权头在写盘前脱敏；快照每 24 小时自动创建、保留最近 7 份，含管理凭据、网盘授权与 Emby 数据库副本，应按私密数据处理。
- 光鸭按需转存默认关闭，开启后只在 CokeTV 专用目录新增所选视频副本并复用，不移动或删除原文件。

## 安全边界

**导入的源脚本与宿主同权限执行，能够访问文件系统和网络；子进程隔离用于执行管理与超时回收，不是安全沙箱。** 只导入可信脚本，不向不可信人员提供管理密码。

公开观影不要求密码，但不返回脚本、源参数、ENV、账号凭据或订阅 Token。管理鉴权以匹配到的路由为准；写请求进行来源校验。媒体使用短期随机票据，匿名与订阅调用不能借代理访问私网、回环或云元数据；管理员和内部运行时保留受设置控制的内网能力。详见 [SECURITY.md](SECURITY.md)。

## 文档与验证

- [配置、脚本、升级与备份](docs/CONFIGURATION.md)
- [开发与验收](docs/DEVELOPMENT.md)
- [网盘源开发](docs/NETDISK_DEVELOPMENT.md)
- [第三方来源与许可](docs/THIRD_PARTY.md)
- [项目交接](docs/AI_HANDOFF.md)

```sh
npm run check
npm run build
npm test
npm run verify -- <源实例ID> [服务地址] --password-stdin
```

上游引擎来源为 [hjdhnx/drpy3](https://github.com/hjdhnx/drpy3)，固定版本与哈希见 `engine/UPSTREAM.json`。CokeTV 按根目录 GPL-3.0 许可证分发，第三方组件保留各自许可。
