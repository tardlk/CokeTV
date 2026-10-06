# 来源说明

- **drpy-node 2.0.4**：兼容执行内核和辅助库保留在 `engine/`，预置站点脚本、解析脚本和站点资源已移除。内核调整、宿主和管理页面由 CokeTV 组织。原 LICENSE 保留在 engine 根目录，项目根目录保留相同 GPL-3.0 文本。
- **shadcn-vue / Reka UI**：管理控件使用 shadcn-vue 官方组件源码和 Reka UI。组件源码在 `web/components/ui/`，依赖按各自许可证分发。
- **Monaco Editor**：源代码编辑器，使用 Microsoft Monaco 的白底主题、行号与代码缩略图。
- **Lucide / DM Sans**：图标和字体由 npm 包提供，保留包内许可。
- **ArtPlayer / HLS.js / mpegts.js**：网页播放器及 HLS、FLV/TS 加载，按需加载；各包的许可证随 npm 依赖保留。
- **OmniBox**：管理、影视站与播放页面的布局和交互参考，未引入 OmniBox SDK、源执行器或前台代码。

其他运行依赖及版本记录在 `package.json` / `package-lock.json`。用户导入的源可能依赖站点账号、外部插件或各自辅助资源；源执行协议兼容不代表第三方站点始终可用。

## 随附 bundle

`engine/libs_drpy/**` 与 `engine/spider/catLib/**` 是随内核一同分发的第三方 bundle，均随上游 drpy-node 2.0.4 引入，来源为 `https://github.com/hjdhnx/drpy-node`（版权归其作者）：

| 位置 | 内容 | 许可 |
| --- | --- | --- |
| `engine/libs_drpy/crypto-js.js`、`crypto-js-wasm.js` | CryptoJS / 其 WASM 版 | MIT |
| `engine/libs_drpy/underscore.js`（如存在） | Underscore | MIT |
| `engine/libs_drpy/node-rsa.js` | node-rsa | MIT |
| `engine/libs_drpy/json5.js`、`pako.js`、`hls-parser.js`、`drpyCustom.js` 等 | JSON5 / pako / hls-parser 等 | 各自包许可（MIT/Apache-2.0） |
| `engine/spider/catLib/cat.js`（约 486KB）、`cheerio.min.js`、`mod.js`、`spider.js`、`http.js`、`similarity.js`、`sortName.js` | CatVod 运行时 bundle | 随上游，按原包许可 |

许可口径以各 bundle 文件内保留的版权声明为准。`engine/utils/api_validate.js` 生成的版权头曾标注 "LGPL3 (github.com/hjdhnx/drpy-node)"，与本仓库 GPL-3.0-only 声明不一致；以根 `LICENSE` 与实际文件头的作者声明为准，冲突时以上游仓库为准并在此登记。

`engine/spider/js/_lib.*` 是供用户源经 `$.require('./_lib.x.js')` 引用的兼容辅助库（含央视/抖音/斗鱼等站点专用逻辑与扫码登录端点），保留以维持兼容；它们不是可独立播放的成品源，上游来源与版权按原库说明。
