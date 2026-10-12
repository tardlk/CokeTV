# 来源说明

- **drpy-node**：最初从2.0.4提取，当前执行兼容基线已按2.0.6固定镜像逐文件核对和同步，来源、原版/Coke哈希及保留补丁登记于 `engine/UPSTREAM.json`。兼容执行内核和辅助库保留在 `engine/`，预置站点脚本、解析脚本和站点资源已移除。宿主和管理页面由CokeTV组织。原LICENSE保留在engine根目录，项目根目录保留相同GPL-3.0文本。
- **shadcn-vue / Reka UI**：管理控件使用 shadcn-vue 官方组件源码和 Reka UI。组件源码在 `web/components/ui/`，依赖按各自许可证分发。
- **Monaco Editor**：源代码编辑器，使用 Microsoft Monaco 的白底主题、行号与代码缩略图。
- **Lucide / DM Sans**：图标和字体由 npm 包提供，保留包内许可。
- **ArtPlayer / HLS.js / mpegts.js**：网页播放器及 HLS、FLV/TS 加载，按需加载；各包的许可证随 npm 依赖保留。
- **OmniBox**：管理、影视站与播放页面的布局和交互参考，未引入 OmniBox SDK、源执行器或前台代码。
- **CatPawOpen 接口参考**：猫影视连接程序独立实现，参考 [入口与宿主桥接](https://github.com/CatPawApp/CatPawOpen/blob/b956aedabe5f624f1e96c8d21c8866617a0f71c1/nodejs/src/index.js)、站点发现与视频 POST 接口；研究时静态读取 Darklessing/catvod 的发布包（提交 `60cc98cf277224797f0bf39415e394c26c46673a`）作为远程 T4 转接的对照，没有执行、复制或分发其完整 bundle、站点或网盘代码。`src/cat-client.cjs` 无第三方运行依赖。

其他运行依赖及版本记录在 `package.json` / `package-lock.json`。用户导入的源可能依赖站点账号、外部插件或各自辅助资源；源执行协议兼容不代表第三方站点始终可用。

### 115 验证模块的协议参考

`src/netdisk/` 的扫码与分享接口流程参考 [SheltonZhu/115driver v1.3.5](https://github.com/SheltonZhu/115driver/tree/v1.3.5) 的 `pkg/driver/qrcode.go`、`share.go`、`download.go` 和 `api.go`；`m115.js` 将其 `pkg/crypto/m115` 的协议编解码适配为 Node 内置 crypto，用于兼容 App 分享接口。MIT License、版权和作者特别声明完整保留在 [LICENSES/115driver.txt](../LICENSES/115driver.txt)。没有内嵌或执行 Go SDK，没有复制 MoonTVPlus/LitePan 的网盘程序，无新增依赖。实际网盘授权和播放仍须按当前平台接口验证。

### 光鸭模块的协议参考

独立实现官方光鸭网页使用的分享、个人目录、转存与取链流程；对照 [LitePan](https://github.com/Ponphil/LitePan/tree/e0e29c0e4c7fb4bc172d9bb66cb0292911b6693b/drivers/Guangya) 的OAuth设备授权/刷新协议和 [OpenList](https://github.com/OpenListTeam/OpenList/tree/482464c2affc5eeba5d4a25bb272aeb352ec5918/drivers/guangyapan) 的目录/取链字段。LitePan为PolyForm Noncommercial，OpenList为AGPL-3.0；没有复制、执行或随包分发两者实现。另对照MIT许可的 [ChenyangGao/guangyapan](https://github.com/ChenyangGao/guangyapan) 接口字段。平台协议参考不代表平台授权或永久可用。

新增npm运行依赖 `qrcode` 1.5.4（MIT）在服务器生成登录二维码，不依赖外部二维码服务；其许可证及传递依赖许可随npm包保留。

### go-emby 协议适配

`src/emby/` 的客户端登录格式、PascalCase DTO、媒体库/季集与经鉴权的播放入口，以及 Infuse/播放器回归场景，按项目所有者授权从 [sd87671067/go-emby](https://github.com/sd87671067/go-emby/tree/75e68aa7d1834cd9f04fcfac686cf67917c5df70) 的 `main.go`、`compat.go`、`browsing.go`、`login_compat.go` 和相关测试适配为 Node.js。CokeTV 自行实现源目录映射、SQLite 事务、观看令牌和网盘桥接；未引入 Go 二进制、PostgreSQL、STRM 扫描器或其联网运行授权 SDK。上游运行授权模块与本次源码移植授权是不同事项，第三方依赖继续遵守其随附声明。

## 随附 bundle

`engine/libs_drpy/**` 与 `engine/spider/catLib/**` 是随内核一同分发的第三方 bundle，均随上游 drpy-node 2.0.4 引入，来源为 `https://github.com/hjdhnx/drpy-node`（版权归其作者）：

| 位置 | 内容 | 许可 |
| --- | --- | --- |
| `engine/libs_drpy/crypto-js.js`、`engine/libs_drpy/crypto-js-wasm.js` | CryptoJS / 其 WASM 版 | MIT |
| `engine/libs_drpy/underscore-esm.js`、`engine/libs_drpy/underscore-esm.min.js` | Underscore | MIT |
| `engine/libs_drpy/_dist/node-rsa.js` | node-rsa | MIT |
| `engine/libs_drpy/_dist/json5.js`、`engine/libs_drpy/pako.min.js`、`engine/libs_drpy/hls-parser.js`、`engine/libs_drpy/drpyCustom.js` 等 | JSON5 / pako / hls-parser 等 | 各自包许可（MIT/Apache-2.0） |
| `engine/spider/catLib/cat.js`（约 486KB）、`cheerio.min.js`、`mod.js`、`spider.js`、`http.js`、`similarity.js`、`sortName.js` | CatVod 运行时 bundle | 随上游，按原包许可 |

许可口径以各 bundle 文件内保留的版权声明为准。`engine/utils/api_validate.js` 生成的版权头曾标注 "LGPL3 (github.com/hjdhnx/drpy-node)"，与本仓库 GPL-3.0-only 声明不一致；以根 `LICENSE` 与实际文件头的作者声明为准，冲突时以上游仓库为准并在此登记。

`engine/spider/js/_lib.*` 是供用户源经 `$.require('./_lib.x.js')` 引用的兼容辅助库（含央视/抖音/斗鱼等站点专用逻辑与扫码登录端点），保留以维持兼容；它们不是可独立播放的成品源，上游来源与版权按原库说明。

`engine/client/drpy/drpy2.min.js`及`engine/client/dist/drpy-core-lite.min.js`原样来自固定2.0.6镜像的`public/drpy/`、`public/dist/`，原版哈希在UPSTREAM清单，随附许可声明保留。两文件为DR2客户端执行内核及打包依赖，不含预置站点清单；通过受订阅鉴权的路径提供给客户端，配套相对import路径保持不变。源码载荷合计782215字节，不代表Docker压缩层增量。
