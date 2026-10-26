# 来源与许可

CokeTV 按根目录 GPL-3.0 许可证分发。第三方组件保留各自许可；移除旧执行器不会取消现有宿主代码的来源与许可义务。

## drpy3

唯一源执行引擎取自 [hjdhnx/drpy3](https://github.com/hjdhnx/drpy3/tree/e5b89fd779de2a7552feec74d5bd020962ccd2f2)，版本 0.1.0，提交 `e5b89fd779de2a7552feec74d5bd020962ccd2f2`。以下四文件从 `dist/` 原样保存到 `engine/libs/drpy3/`：

- drpy3.js
- drpy3-peer.js
- drpy3-globals-capture.js
- drpy-core-lite.min.js

MIT 文本保存在 LICENSES/drpy3-MIT.txt，原库包内的第三方声明保留，SHA-256 登记于 engine/UPSTREAM.json。上游内置的 load2x 不作删改，但产品不提供独立DR2入口。没有复制或预装上游示例站点。

## 独立宿主辅助库

`src/host/htmlParser.js`、`jsonpathplus.min.js` 和 FTP/WebDAV/源环境/代理工具，源自此前固定的 [hjdhnx/drpy-node](https://github.com/hjdhnx/drpy-node) 2.0.6 宿主辅助代码。解析器去除旧内核工具链依赖，使用 Node URL 拼接与独立日志；ENV保留本源作用域和0600原子写入。链接导入专用的采集源生成器已删除。来源和本地文件哈希见 UPSTREAM.json 的 hostFiles；根许可证与 engine/LICENSE 保留。

drpyS、独立DR2客户端库、CatVod、HIPY/Python、PHP执行器、桥接、旧源专用辅助包与自动插件启动已从发行树移除。产品没有新增旧脚本自动翻译运行层；测试中的样本生成工具只用于迁移既有协议回归，不进入生产镜像。

## 界面与播放

Vue、shadcn-vue/Reka UI、Monaco Editor、Lucide、DM Sans、ArtPlayer、HLS.js 和 mpegts.js 按各包许可使用；对应许可随npm包或组件源码保留。OmniBox仅为既有页面布局与交互参考，没有接入其SDK或源执行器。

## 网盘模块

115扫码/分享协议及m115编解码参考 [SheltonZhu/115driver v1.3.5](https://github.com/SheltonZhu/115driver/tree/v1.3.5)；MIT许可与作者声明保留在 LICENSES/115driver.txt。没有引入Go运行环境。

光鸭模块独立实现网页分享、个人目录、转存与取链流程；协议字段参考 LitePan（PolyForm Noncommercial）、OpenList（AGPL-3.0）及MIT许可的ChenyangGao/guangyapan。没有复制、执行或分发LitePan/OpenList驱动。账号权限和流量限制按平台规则处理。

## 猫影视与Emby

`src/cat-client.cjs` 为独立实现的轻量Node连接程序，参考CatPawOpen宿主接口；客户端不携带服务器源脚本或账号配置。

`src/emby/` 的协议与相关行为按项目所有者授权参考 [sd87671067/go-emby](https://github.com/sd87671067/go-emby/tree/75e68aa7d1834cd9f04fcfac686cf67917c5df70)。CokeTV自行实现源目录映射、SQLite存储、订阅身份与媒体桥接，没有引入Go二进制、PostgreSQL、STRM扫描器或联网运行授权SDK。

其余实际依赖记录在package.json与package-lock.json。node-forge、TypeScript及测试直接使用的undici归开发依赖；Cheerio等生产包所需的传递依赖仍按锁文件安装。
