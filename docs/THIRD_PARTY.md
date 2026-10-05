# 来源说明

- **drpy-node 2.0.4**：兼容执行内核和辅助库保留在 `engine/`，预置站点脚本、解析脚本和站点资源已移除。内核调整、宿主和管理页面由 CokeTV 组织。原 LICENSE 保留在 engine 根目录，项目根目录保留相同 GPL-3.0 文本。
- **shadcn-vue / Reka UI**：管理控件使用 shadcn-vue 官方组件源码和 Reka UI。组件源码在 `web/components/ui/`，依赖按各自许可证分发。
- **Monaco Editor**：源代码编辑器，使用 Microsoft Monaco 的白底主题、行号与代码缩略图。
- **Lucide / DM Sans**：图标和字体由 npm 包提供，保留包内许可。
- **ArtPlayer / HLS.js / mpegts.js**：网页播放器及 HLS、FLV/TS 加载，按需加载；各包的许可证随 npm 依赖保留。
- **OmniBox**：管理、影视站与播放页面的布局和交互参考，未引入 OmniBox SDK、源执行器或前台代码。

其他运行依赖及版本记录在 `package.json` / `package-lock.json`。用户导入的源可能依赖站点账号、外部插件或各自辅助资源；源执行协议兼容不代表第三方站点始终可用。
