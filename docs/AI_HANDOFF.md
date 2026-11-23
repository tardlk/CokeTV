# CokeTV 接手记录

更新：2026-11-23。当前源码版本 **0.2.5**，用户已明确 **只保留 drpy3 一个源执行引擎**；工作方式继续直接在 `main` 工作，不主动创建分支或 PR。

## 0. 当前接手入口（先看本节）

- **先读顺序**：`AGENTS.md`（用户已确认的产品与安全决定）→ 本文件 → `README.md`、`SECURITY.md`；写站点源时读 `docs/SOURCE_DEVELOPMENT.md`。原 CONFIGURATION/DEVELOPMENT/NETDISK_DEVELOPMENT/THIRD_PARTY 已并入 README 与本文件后删除。
- **当前验证**（2026-11-23，macOS arm64 / Node 22.23.5）：`npm run check`、`npm run build` 通过；`npm test` 为后端 292 项（281 通过，11 项 data 目录站点脚本回归在空壳环境按设计跳过）+ 界面 90 项，共 382 项。本地 Node 位于忽略的 `.tools/`，`start.sh` 可自动发现。
- **当前 latest（2026-11-23 豆瓣图片 UA 修复）**：`ghcr.io/tardlk/coketv:latest` 与 `:sha-835b601`，manifest digest `sha256:ba2530d2218c548450f3516567656203fb6be8308229667959c2be3dad094d9a`，image ID `sha256:4014b8ec74c634a6eb6fc8b17c61de698e7e460a2457fbac1042e5edd6472bcc`，源码提交 `835b6014f3635e6b5f9f618f489120593f095652`，版本 0.2.5，`linux/amd64`。[Verify](https://github.com/tardlk/CokeTV/actions/runs/45106029342) 与 [容器验收并发布](https://github.com/tardlk/CokeTV/actions/runs/45106029360) 成功，14 项容器检查和容器内 280 项后端回归通过。latest 与 sha 标签匿名 manifest/config digest 一致并匹配验收镜像。本机无 Docker，未实际 pull。NAS 待用户更新镜像，豆瓣脚本无需重新导入。
- **导航脚本轮播构建（2026-11-23 导航脚本轮播/图片）**：`ghcr.io/tardlk/coketv:latest` 与 `:sha-32e0384`，manifest digest `sha256:742cc12663df8846110615a42cfca06e7f5ee938e3bade9aea1c28aa57130258`，image ID `sha256:b4ef57196f859d2d71d64b96ce876477d422352871e8b7f721cd23228a5f5577`，源码提交 `32e0384d70665d4f166e00823deac76d11ad0b38`，版本 0.2.5，`linux/amd64`。[Verify](https://github.com/tardlk/CokeTV/actions/runs/45104480537) 与 [容器验收并发布](https://github.com/tardlk/CokeTV/actions/runs/45104480512) 成功，14 项容器检查和容器内 279 项后端回归通过。latest 与 sha 标签匿名 manifest/config digest 一致并匹配验收镜像。本机无 Docker，未实际 pull。豆瓣脚本单独交付供导入，NAS 需用户升级。
- **首页轮播初版（2026-11-23 首页热播轮播）**：`ghcr.io/tardlk/coketv:latest` 与 `:sha-250a440`，manifest digest `sha256:72a0b1305dc0a65743a084b6cf88455e52ce19e276141f57d407f7e5a94560c7`，image ID `sha256:eccc9441472f250f5641b4ebef3006a4c77f5b7611069909505ce034f2a7e629`，源码提交 `250a440f32e935b69ae0eead6cde02d565cef87d`，版本号仍为 0.2.5，平台 `linux/amd64`。[Verify](https://github.com/tardlk/CokeTV/actions/runs/45102476208) 与 [容器验收并发布](https://github.com/tardlk/CokeTV/actions/runs/45102476218) 成功，14 项容器检查、容器内 277 项后端回归通过。latest 与 sha 标签匿名 manifest 摘要、config digest 相同且匹配已验收镜像。本机无 Docker，未实际 pull。实机对照和本地浏览器验收见下文轮播架构条目；生产依赖审计 0 项，全量 11 项开发依赖告警保持原范围。NAS 容器需用户更新，未部署此构建。
- **脚本声明搜索/筛选构建（2026-11-20）**：`ghcr.io/tardlk/coketv:latest` 与 `:sha-8c678e7`，manifest digest `sha256:e7386c0b405da1526aa0dea5b242f0ce0e61501595cca1ceb37e2f432b13521c`，image ID `sha256:e794607f91de6484c1bf531aad8bfaa5479e728a61a9834c0b4f3711e929f799`，源码提交 `8c678e7490304c61b12dca791506c1ac7adcd862`，版本号仍为 0.2.5，平台 `linux/amd64`。[Verify](https://github.com/tardlk/CokeTV/actions/runs/44669407566) 与 [容器验收并发布](https://github.com/tardlk/CokeTV/actions/runs/44669407547) 成功，14 项容器检查、容器内 273 项后端回归通过。latest 与 sha 标签匿名 manifest 摘要、config digest 相同且匹配已验收镜像。能力由脚本声明自动同步，管理列表改为只读；兼容修复生产依赖补丁，`npm audit --omit=dev` 为 0，全量开发依赖审计见 SECURITY。NAS 容器需用户更新，尚未部署此构建。
- **移除首页刷新按钮构建（2026-11-20）**：`ghcr.io/tardlk/coketv:latest` 与 `:sha-7adc8d4`，manifest digest `sha256:2c14c301794c704a9c576486ae66e6060ecf26695515b347e4d90b781f6cb558`，image ID `sha256:b74223c19d095c3482dafcd4c5dc8038cb49d97186016e41228a73e7de32853a`，源码提交 `7adc8d41a35414cf99bfa7a4e4e26f94f94b5214`，版本号仍为 0.2.5，平台 `linux/amd64`。[Verify](https://github.com/tardlk/CokeTV/actions/runs/44662963061) 与 [容器验收并发布](https://github.com/tardlk/CokeTV/actions/runs/44662963051) 成功，14 项容器检查、容器内 268 项后端回归通过。latest 与 sha 标签匿名 manifest 摘要、config digest 相同且匹配已验收镜像。用户要求去掉首页刷新按钮，已删除按钮/图标/处理逻辑/专属样式及失效的 UI 用例；保留 5 分钟到期后的按需更新，不增加后台定时抓站点。NAS 容器需用户更新。
- **首页缓存初版（2026-11-20）**：`:sha-0c8f927`，manifest digest `sha256:d0dec240c7414b00ef3b112cefd4554836c04c3cb2d4b1dd22a4ea068262b192`，image ID `sha256:de1db7a47c5cc80a10da0c05496e66e3501e068c877c18a6b6716b1422d3f7a1`，源码提交 `0c8f927ef35beb41a14bcb9fcc9a8b5fcdf56c61`，版本号仍为 0.2.5，平台 `linux/amd64`。[Verify](https://github.com/tardlk/CokeTV/actions/runs/44660986599) 与 [候选镜像验收并发布](https://github.com/tardlk/CokeTV/actions/runs/44660986575) 成功；14 项容器检查与容器内 268 项后端回归通过，发布复用同一已验收 image ID。两个标签的匿名 manifest 读取、摘要和 config digest 核对通过；本机无 Docker，未实际 pull。桌面及 390px 手机页面检查通过，临时样本验证主动更新后刷新网页继续复用首页。临时预览已停止并清理数据；NAS 容器待用户更新。
- **默认双栈构建（2026-11-20）**：`:sha-436df3f`，manifest digest `sha256:7e36e35c257b8b0297db72ce7a4456d002ab19495126e4b6988e2316c9c4a5b8`，image ID `sha256:30e8386a4be23593f5c8a5c92ab26089c7b953fc70848e24b9acab02c6331410`，源码提交 `436df3fcd8eb4f263377d8285ab5e8fc029cea49`，版本号仍为 0.2.5，平台 `linux/amd64`。[Verify](https://github.com/tardlk/CokeTV/actions/runs/44651632129) 与 [候选镜像验收并发布](https://github.com/tardlk/CokeTV/actions/runs/44651632121) 成功；容器内 262 项后端回归、host 网络双栈/自定义端口/实际健康检查、禁用 IPv6 的 IPv4 启动兼容均通过，发布复用同一已验收 image ID。两个标签的匿名 manifest 读取、摘要与 config digest 核对通过；本机无 Docker，未实际 pull。用户已更新双栈镜像并反馈目前使用 IPv6；首页缓存构建待用户再次更新。
- **活动日志构建（2026-11-19）**：`:sha-ac02861` 保持 manifest digest `sha256:935e2dd005e2dd88174ed93f74d8e0d7d2597709ee88dfcd10b86110cc55b3df`，image ID `sha256:4ff9bbc5b2413b807ad08cb08df54b7720fcd0b627548a56aaba0a1357ea6d4a`，源码提交 `ac028617febbef54eda2a0240932203d9c64ab6c`。[Verify](https://github.com/tardlk/CokeTV/actions/runs/44485967465) 与 [候选镜像验收并发布](https://github.com/tardlk/CokeTV/actions/runs/44485967469) 成功，容器内 259 项后端回归通过。NAS 已由用户升级到此构建并确认新日志实际出现；其默认仍仅监听 IPv4。
- **固定版本镜像（2026-11-18 重建发布）**：`ghcr.io/tardlk/coketv:0.2.5`、`:0.2`、`:sha-d9f0ce8` 保持旧版 manifest digest `sha256:929bfc017c7ed0e716d5fc3246b1152813ab635dc059f03a21857a3efae8bd09`（image ID `sha256:7a858ab85381d1dcee8572adedf7516eb0277490b629faffc863354123775148`），源码提交 `d9f0ce8`，平台 `linux/amd64`。[GitHub Packages](https://github.com/tardlk/CokeTV/pkgs/container/coketv) 已显示 Public，当时发布的四个标签（含当时 latest）匿名清单/配置读取与摘要核对通过。[重建发布记录](https://github.com/tardlk/CokeTV/actions/runs/44215391262) 的源码检查、构建、测试、12 项容器检查及容器内 254 项后端回归均通过，然后发布同一已验收镜像。GitHub Release：https://github.com/tardlk/CokeTV/releases/tag/v0.2.5 。
- **删除与恢复背景**：用户确认此前删除了镜像，仓库也删除后恢复，恢复时 Actions 被禁用；2026-11-18 经用户授权重新启用并恢复发布。旧 0.2.5 digest `sha256:dd7474ac9353793f93ed45455b8873d22ecd401f21ea888fb62415441949bbf3` 只作历史记录，不再作为当前镜像身份。0.2.4 及更早镜像本轮未恢复；旧 Actions 记录也未恢复。另有 [main 重建记录](https://github.com/tardlk/CokeTV/actions/runs/44214809779)，发布 `:sha-da4a34f`，digest 为 `sha256:209b722d7c7c61815b3132d2194eeb9ecb237b9991e0e9d153aefc3e7b84d7c4`；随后 v0.2.5 发布将 `latest` 更新为上条固定版本镜像。
- **发布门禁**：推送 `main`/`v*` 触发 `.github/workflows/docker.yml`；候选镜像先在原生 amd64 跑容器矩阵，再用同一镜像（不重建）发布 GHCR。本机没有 Docker，容器结论只能来自 Actions。
- **本机私有**：`HANDOFF.md`、`.tools/`、`data/` 不入库；不要拿正式用户 data 做删除、迁移或恢复实验。
- **Compose 简化（2026-11-18，用户确认）**：删除 `stop_grace_period`、`security_opt`、`cap_drop`、`cap_add` 及对应注释，采用 Docker 默认停止等待时间和容器权限。PUID/PGID 默认仍为 1000:1000；镜像入口继续初始化 data 权限，再切换普通用户、清除全部能力并设置 no-new-privileges。本次仅修改部署配置和说明，继续使用上面已验收发布的镜像。
- **客户端、播放与爬虫日志（2026-11-19）**：`src/activity.js` 关联匹配路由、客户端 IP/UA/Emby 设备、源与订阅名称、影片/分集及请求编号；记录 HTTP 状态/耗时、取链传输方式、worker 开始/推荐阶段/完成/错误/排队/条数及源输出。媒体和源代理首条立即记录，后续按 30 秒汇总且内存有界，错误即时记录；流错误与客户端取消分别记录。后台按客户端/播放/爬虫/系统筛选、搜索并每 5 秒刷新，可暂停，离开页面清理轮询。仅记录白名单元数据，匹配路由不含凭据值；参数、ENV、原始 URL、请求体与播放 ID 不进入新增元数据。客户端名称为自报标识，直连后流量及实际解码无法观测，不是在线设备统计。2026-11-20 用户自行升级 Docker 后，NAS 已实际出现新增日志；切换 host 网络后记录到公网 IPv4 来源，之前为 Docker 网桥地址。只读核对未修改 NAS 配置。
- **默认双栈监听（2026-11-20）**：用户反馈 host 网络下 IPv6 不通，原因是旧镜像和启动代码默认 `HOST=0.0.0.0`。`src/listen.js` 与镜像改为 `::`、`ipv6Only:false`；仅 IPv6 不可用的三类绑定错误回退 IPv4 并记日志，端口占用仍报错，显式 IPv4 监听保留。启动日志显示实际绑定地址；Docker 健康检查跟随 PORT。IPv4 映射地址在活动日志中显示为普通 IPv4。新增真实双栈 socket/IPv6 订阅与原生及网页 HLS/流量日志、禁用 IPv6 的回退与端口占用回归。容器矩阵增加真实 host 网络双栈、非默认端口与原版健康检查，以及禁用 IPv6 场景；后端回归容器显式启用自身 IPv6 loopback。已有容器若显式保存旧 `HOST=0.0.0.0`，需用户移除或改 `::` 并重建；host 模式本身不会改变应用监听。用户已自行更新此修复，并确认目前均走 IPv6。

## 当前架构

- **豆瓣部分海报 403 修复（2026-11-23）**：用户反馈《两京十五日》海报缺失；NAS 日志及对应图片请求确认该图源返回 403，而其他分片图片可用。原 source-images.js 只绑定 Referer，原生 streamMedia 请求不带 UA；同一张图片通过原生 HTTPS 验证，无 UA 为 403，加入 Mozilla/5.0 为 206。修复在图片票据中绑定固定 UA，保留公开出口/目标/源/Range 约束，不转发客户端 Cookie/Authorization。新增真实 HTTP 端到端回归，以同时要求来源头和 UA 的模拟图源验证首页转换、票据、媒体转发、Range、二进制及篡改拒绝。脚本无需重新导入，NAS 需用户更新镜像后刷新页面。

- **导航脚本轮播与图片来源头（2026-11-23）**：用户要求转换 OmniBox 豆瓣推荐脚本；单文件与 ZIP 位于忽略的 releases，不进入源码或镜像。meta.navigation=true、searchable=0、filterable=1，保留六分类/全部筛选、腾讯轮播和豆瓣推荐，不带原脚本的 Cookie/标识；真实临时运行得到 6 分类/5 轮播/20 推荐，全部分类和翻页/筛选通过。框架选中导航源时读取该源 home.banner（与源 ID 关联），禁用内置轮播请求；空 banner 不混入内置推荐，普通源保持已有机制；修复空成功内置轮播重复请求。source-images.js 为带 @Referer= 声明的 vod_pic 铸造随机目标/源绑定图片票据，公开出口，不改变源首页缓存原值，不暴露订阅或管理凭据；处理位于共享内容查询层。图片上游无 Referer 返回 418，有 Referer 实际返回 206。新增来源/空轮播/切源/图片票据范围测试。NAS 未新增豆瓣源，需用户更新镜像后导入并在影视站选择；导航源不加入视频订阅。

- **OmniBox 同款首页轮播（2026-11-23，用户确认）**：`web/WatchCarousel.vue` 独立实现同款全宽、三层遮罩、响应式字号/高度/容器/箭头/圆点，Embla Vue 8.6.0（仅开发依赖，前端打包）与参照相同的滚动交互；五秒切图、可拖动/键盘/圆点，页面隐藏或减少动态效果时暂停自动切换，卸载清理定时器。`/watch/banner` 固定请求腾讯公开推荐接口，不接受调用方 URL/头/请求体，无 Cookie 或账号标识，无重定向和任意代理；最多五张，五分钟按需缓存与并发复用，失败一分钟退避并保留一天内旧成功结果，首轮失败隐藏横幅。图片只接受 HTTPS tv.puui.qpic.cn 且无端口/凭据，由浏览器直接读取，沿用 no-referrer。点击走现有 `/watch/search` 聚合搜索（最多 12 个可搜索源），不改变源/订阅/播放和源首页缓存。首次进首页单独加载轮播，分类/搜索/播放/我的不显示，返回首页复用。实测 1105×865 横幅 y=60/h=346、标题 x=56.5/y=153/48px、箭头 32px、圆点位置与参照一致；390×844 横幅高 200px、标题 20px、无横向溢出，五张实际图片均加载，点击搜索和拖动已验收。截图在忽略的 `.tools/carousel/`，临时预览已停止并清理数据。NAS 容器需用户升级，未修改 OmniBox 或用户源数据。

- **脚本声明搜索/筛选（2026-11-20，用户确认）**：移除管理列表的手动能力开关，改为只读展示。`source-capabilities.js` 使用生产依赖 Acorn 8.19 静态读取 default 导出的 rule/meta 声明（rule 优先），支持数字/布尔/常量引用/对象展开，忽略注释、示例字符串和无关对象，不执行脚本。未声明或无法静态判断时兼容搜索开、筛选关，建议明确填写常量。Store 导入/保存同步同脚本所有实例；旧引擎转换同步新声明，升级启动同步既有实例并跳过缺失/不可读脚本；不改变名称、启用、参数、ENV、订阅和原脚本内容。PUT 实例接口忽略旧客户端 searchable/filterable 字段，禁止恢复独立覆盖。新增声明解析、静态不执行、保存/重启保留用户数据、API 与网页/TVBox 同步回归。此前 NAS ivdy 脚本声明两项均为 1，但实例搜索/筛选均为 false；用户反馈后仅通过现有管理 API 打开搜索，实测返回 20 条；新自动同步机制仍需更新镜像后生效。

- **首页复用与缓存（2026-11-20）**：用户在查看 OmniBox 后授权沿用首页数据复用流程。`src/home-cache.js` 在源执行服务层缓存 home/homeVod 的合并结果 5 分钟，100 条/32 MiB/单条 2 MiB，合并同键在途请求；只缓存成功首页，结果逐请求反序列化，失败不覆盖旧成功缓存，失效后在途结果不重新填充。键使用源/脚本/ENV内容指纹、参数、origin/代理凭据、协议/UA、filter 的摘要，原始密钥不入日志。管理变更和 worker 重置清空缓存，公开 homeRevision 为随机启动标识+计数，不能含配置或凭据。网页内首页按服务端剩余 TTL 复用；分类、翻页、返回首页不重复请求首页，用户随后要求去掉网页“更新首页”按钮，当前界面已移除该按钮及处理逻辑，缓存到期后下次加载自动获取，不增加后台定时轮询。首页失败保留原有“重试”，`homeRefresh` API 和十秒合并窗口保留兼容。缓存命中/合并写 spider.cache，不伪造执行日志。播放取链继续按需，源检查接口直接执行以便诊断；原有聚合搜索缓存独立。NAS 尚未部署此功能；用户已确认此前双栈镜像更新后正常使用 IPv6。

- `engine/libs/drpy3/`：上游 e5b89fd779de2a7552feec74d5bd020962ccd2f2 四文件原包，MIT；engine/UPSTREAM.json 登记哈希。内置 load2x 保持原样，CokeTV 不提供独立 DR2 入口。
- `src/drpy3.js`、`drpy3-loader.mjs`：HostEnv、标准库投影、ESM/CJS 和字节资产、持久 KV、多个详情 ID 聚合、多清晰度默认地址。源调用自己的服务地址时改走内部回环，重定向移除内部凭据。
- `src/worker.js` / `runner.js`：按需 drpy3 worker 池（`SOURCE_WORKERS`，默认 2）、每源串行、超时回收与脱敏日志；worker 0 保留网关/WS，无 Python 守护或旧插件启动。FTP/WebDAV 和源自定义 WS 仍按需提供宿主能力。
- `src/host/`：独立 HTML 解析、JSONPath、ENV 及网关辅助；来源与本地哈希在 UPSTREAM。宿主修改进入 src，不修改官方引擎原包。
- `src/store.js`：数据版本 v2、事务/历史、v1 预备份与旧源标记、显式代码迁移；源保存时解析 `meta.navigation` 并更新实例标记。数据只在 data，发行始终零预置源。
- `src/logging.js`、`src/backups.js`：stdio + 轮转文件日志（脱敏）、data 快照（定时/手动、保留份数、下载）；快照 zip 由 `worker_threads` 生成，避免阻塞主事件循环。
- 网页、TVBox、猫影视、Emby 和 115/光鸭继续通过统一内容服务。CatVod 执行器已删除，猫影视连接程序保留；TVBox 配置链接导入和采集 JSON/XML 脚本生成器已移除。导航源由 `meta.navigation: true` 标记，网页点击条目走 `/watch/search` 聚合搜索（最多 12 个可搜索源、单源 6 秒超时、30 秒缓存）；TVBox/Emby 不承担跨源交互。

## 网盘开发契约

CokeTV 只有 drpy3 源引擎；网盘账号、分享展开与取播放地址由独立宿主服务管理。源负责搜索和返回用户有权访问的分享链接，宿主负责按账号读取目录和获取临时媒体地址。

drpy3 详情返回标准分享即可：

```js
export default {
    meta: {title: '我的资源源', lang: 'dr3'},
    rule: {},
    async detail(ctx, id) {
        return {list: [{
            vod_id: id,
            vod_name: '资源名称',
            vod_play_from: '网盘',
            vod_play_url: '分享$' + id,
        }]};
    },
};
```

支持 115 与光鸭的标准分享链接，以及既有 `push://` 编码分享形式。不要将账号 Cookie 或 Token 塞入播放地址、vod_id、图片 URL 或日志。详情返回分享后，宿主展开为作用域内的分集引用；`coketv-netdisk:` 等内部引用由宿主处理，不重新交给源拼接。

账号通过管理后台配置，存放在 `data/netdisk`，文件 0600。网页、TVBox、猫影视和 Emby 复用宿主账号，源无需实现平台登录或将凭据下发客户端；账号更新/移除后旧引用失效。115 默认使用与客户端匹配的 User-Agent 取临时地址，Cookie 不下发；光鸭保留平台账号权限与流量限制。网页视频元素不能随意设置 User-Agent，跨浏览器/IP/客户端应分别验证。

默认由客户端直连临时地址。`delivery: 'proxy'` 是显式中转模式，仍需符合票据和出口权限；失败不自动回退代理。光鸭按需转存默认关闭，开启后只在 CokeTV 专用目录添加所选视频副本并复用，不移动、删除或覆盖原内容。

调试与验收使用独立临时数据目录，不拿正式账号文件做删除实验；固定样本覆盖分页、目录、临时地址、平台错误、账号撤销、引用作用域和播放权限。可用 `node scripts/netdisk-verify.mjs` 启动本机临时验证入口，按脚本要求设置独立 `NETDISK_TEST_DIR`、`NETDISK_TEST_PASSWORD` 和可选端口；不要公开该调试服务或在日志里记录账号凭据。

## 旧数据处理

v1 首次启动先备份原数据至 backups/before-drpy3-*（排除备份本身与依赖链接），再刷新运行库。旧源停止执行、标记待迁移，原脚本/历史/ENV/参数和订阅引用保留。公开/订阅目录过滤旧源，API 不能重新启用旧引擎。

后台读取旧代码后人工改写，保存为 drpy3；保持共享该脚本的原实例 ID、ENV、参数与订阅引用，并恢复原启用状态。文件名冲突自动采用独立名称，不覆盖已有源；迁移失败回滚文件和状态。回退应停止服务并成对恢复旧代码及升级前 data 备份，不让两个版本同时写同一目录。

升级与协议回归在临时目录完成。历史本机预览曾初始化 data 并导入站点脚本，但这些运行数据不随仓库分发；实际源、账号与配置以部署机的磁盘数据为准，不能自动覆盖或清空。站点脚本与本机调试资料不进入发行树。2026-11-20 NAS 已由用户升级活动日志和双栈监听构建（版本号仍为 0.2.5），自行改为 host 网络并确认使用 IPv6；首页缓存构建尚待更新。

## 已完成实现

移除 drpyS、独立 DR2 客户端库、CatVod、HIPY、PHP 执行器、桥接及旧源专用库；移除旧基线对照脚本与专项测试，保留并迁移公共协议/安全回归。后台新建/导入固定 drpy3，设置中不再出现 Python/PHP/浏览器路径或旧引擎插件。本地 JS/ZIP 导入支持模块和 WASM；旧格式明确拒绝。TVBox 链接导入页面、预览/提交 API、远程依赖下载、CMS 生成器及 coketv/cms 别名已删除，直接 JSON5 生产依赖已移除。新建与上传不再自动识别或选择引擎；观影和订阅选择器删除引擎筛选，管理列表只在有旧源时提供迁移状态筛选，不再重复显示引擎类型列。删除旧 map.txt 自动导入，保留版本升级备份与待迁移代码读取。本地解析器固定使用 drpy3，并覆盖网页播放和 /parse 入口。

2026-10-25：删除整个“连接与运行”设置模块及 `/admin/dependencies`，移除可配置对外地址和执行超时。订阅窗口直接使用 window.location.origin，TVBox/猫影视/Emby 一致；后端使用 Fastify 请求 protocol/host 生成接口与代理地址，默认忽略转发头，显式 TRUST_PROXY=1 时按可信代理转发头还原地址。同源保护使用同一来源规则，旧 publicUrl 不再额外放行其他 Origin。旧数据中的 publicUrl/timeout 不再影响运行，保存设置时不再写入；未手动修改现有用户配置。普通源操作默认 30 秒，action 60 秒；保留超时回收保护。

同日删除“代理与参数安全”整个界面与前端表单状态，当时设置页仅保留全局默认 ENV 及订阅扩展。后台策略与高级配置兼容保留；保存其他设置时，不重置被隐藏的 jsonPublic/allowPrivateTargets/targetAllowlist。用户 data 保持不变。

随后按用户要求删除整个设置页面和侧栏入口，以及其前端状态、保存逻辑与专属样式。后台运行配置/高级管理接口保留兼容，已有全局 ENV、解析器、直播及安全策略不清空；本源参数和 ENV 仍在源编辑页管理。

本轮按用户要求改为脚本级真删除：DELETE /admin/scripts/:id 和 /admin/scripts/batch 调用 Store.deleteScripts，实际删除脚本/历史/全部关联源 ENV 与持久 KV 并移除订阅引用，事务失败回滚。共享脚本的全部源一并删除，确认框明确提示数量；遗留孤立脚本进入管理列表可删除。移除实例新建与目录扫描入口/API，以及旧实例删除 API 和软删除选项，不再内部扫描；导入/新建脚本自动注册对应源。现有运行脚本仍留给用户确认删除，未自动清理 s.js 或爱看机器人。

网页观影对没有分类和首页影片、但可以搜索的源显示“请搜索影片”与直接聚焦搜索框的按钮，不再一律显示“暂无影片”。首页/搜索响应可选的 notice 仅按纯文本显示（最多 500 字符），用于说明站点浏览限制；切换查询时清除旧提示，不修改官方引擎。站点脚本和登录资料仍仅保存在忽略的本机运行目录。

2026-10-26（0.2.4，并发与备份线程化）：源执行从全局单队列改为 worker 池（`SOURCE_WORKERS`，1–4，默认 2）；每个源固定一个 worker 且串行，不同源可并行，任一 worker 超时/崩溃只回收该 worker，worker 0 保留网关/WS，含 `fServer`/`ws` 的源固定到 worker 0。备份 zip 改由 `worker_threads` 生成，主进程只做目录遍历、容量校验与原子重命名；Emby `VACUUM INTO` 副本以文件路径交给压缩线程并在结束后清理。新增 runner-pool 并发/同源串行回归。

2026-10-26（0.2.3，冗余清理）：移除 `src/host/utils/` 中无调用方的 457 行死代码（proxy-util 的 verifyAuth/decodeParam/makeRemoteRequest 链/isInternalIp 等、proxy-common 的 rewriteM3u8、两个 client 工厂、pathHelper 的 resolvePath/isSafePath），同步更新 `engine/UPSTREAM.json` 的宿主文件哈希；运行时版本改为从 `package.json` 读取（`src/version.js`），前端由 Vite/Vitest `define` 注入 `__APP_VERSION__`，消除服务端/前端/侧栏的版本号重复。复核网关日志：worker 已在入口把 `console.log/warn/error` 重定向为 IPC 日志，实际进入统一 sink，无需再改 host log.js。

2026-10-26（0.2.2，安全修复）：图片上传收紧为管理员/源内部，仅接受 PNG/JPEG/GIF/WebP 并按魔数校验，SVG 与订阅 Token 上传被拒绝，/image 响应加 CSP；WebDAV/FTP 网关的 /config 测试接口只允许管理员/源内部，其他请求剥离 body 中的 config，堵住订阅 Token 驱动的内网 SSRF；数据快照补 `netdisk/` 与 Emby `VACUUM INTO` 一致副本；日志脱敏覆盖 JSON 形态的 token/password/cookie/authorization，并在内存日志入口统一脱敏；`/api`、`/parse`、`/image`、`/json`、`/webdav`、`/ftp` 纳入公开限流；实现文档中的 `LOG_STDOUT=0`。生产依赖执行 `npm audit fix --omit=dev`（undici 7.30.1、fastify 5.12.7、fast-uri 4.2.3），`npm audit --omit=dev` 为 0；开发依赖仍有 vitest/tinypool 等 6 项，见 SECURITY。新增 hardening 回归，补充快照/Emby 备份/脱敏/限速测试。

2026-10-26（0.2.5，导航源与聚合搜索）：新增导航源标记（`meta.navigation: true`，保存时解析、管理列表显示“导航”）；网页观影支持点击导航源条目后对全部启用且可搜索的非导航源执行 `/watch/search` 聚合搜索，结果按源分组并可切换到结果所属源播放；单次最多 12 个源、单源 6 秒超时、每组最多 50 条、30 秒缓存，失败/超时返回部分结果。TVBox/Emby 不提供跨源交互。新增后端导航聚合与网页导航源回归。

2026-10-26（文档收敛）：README 吸收配置与使用、开发与验证、第三方与许可；网盘开发契约并入本文件；删除 CONFIGURATION/DEVELOPMENT/NETDISK_DEVELOPMENT/THIRD_PARTY 四个独立文档，当前保留 README、SECURITY、AGENTS、AI_HANDOFF 与源开发指南 SOURCE_DEVELOPMENT。

2026-10-26（0.2.1）：运行日志改为 stdio 单行 JSON + `data/logs/coketv.log`（0600，5 MiB × 3 个历史文件），写入前隐藏 URL token、Authorization/Cookie 与 password 类赋值；后台新增“运行维护”页，可看最近 400 条、按级别过滤、下载日志。新增进程内数据快照：启动 60 秒后检查，默认每 24 小时创建、保留 7 份，zip 0600，包含状态/凭据/脚本与历史/ENV/KV/参数文件/解析脚本，不含运行库；后台可立即创建与下载；删除脚本、批量迁移、导入配置前自动补快照（10 分钟节流，失败不阻断）。恢复步骤写入 README「数据快照与恢复」。静态资源启用 gzip/br（阈值 1 KiB）与一年 immutable 缓存，HTML 统一 no-cache。版本升至 0.2.1；新增 logging/backups/maintenance-api/static-delivery 测试与运行维护 UI 测试。

生产依赖只保留宿主所需包，前端构建工具和测试库归开发依赖；新增 `@fastify/compress` 为生产依赖。Docker 不安装 Python/PHP、浏览器或 ffmpeg，保留证书和权限初始化工具。GitHub Verify 与原生 amd64 候选矩阵已同步；发布仍须核对同一 artifact/image ID/revision，不能重建后直接发布。

## 验证与发行边界

2026-11-18 本机为 macOS arm64 / Node 22.23.5。最新 0.2.5 的 `npm test` 为后端 266 项（255 通过、11 项 data 站点脚本在空壳下跳过）+ 界面 78 项，合计 344 项；0.2.4 历史为 265 项（254 通过）+ 77 项 = 342 项；`npm run check` 与 `npm run build` 均通过。新增回归覆盖图片上传权限/SVG/魔数、WebDAV/FTP 配置越权阻断、日志 JSON 脱敏与 stdout 开关、快照含网盘凭据与 Emby 一致副本、`/api` 限流、worker 池并发/同源串行、导航源聚合分组/换源，以及原有日志/快照/维护接口/静态资源用例。

2026-10-26 的 `70bcf98` 已在 GitHub Actions 原生 Linux amd64 上通过 Verify 与 Docker 候选矩阵（12 项容器检查、容器内 237 项回归 fail 0 / skipped 0），并用同一镜像发布 `ghcr.io/tardlk/coketv:latest` 与 `:sha-70bcf98`（manifest digest 见 §0）。0.2.1 的 `cce9666`、0.2.2 的 `40b1303`、0.2.3 的 `a4f972b` 均在 Verify 与 Docker amd64 上全绿。0.2.4 的 `cc3cb77` 与 `v0.2.4` 的 Verify/Docker amd64 均成功；0.2.5 的 `d9f0ce8` 与 `v0.2.5` 也已全绿。本机仍无 Docker 及原生 amd64 环境，真实站点、真实 WASM 解密、异地客户端和 NAS 实机不在本轮验证范围。

上游百忙无果1、央视频-1 仅在临时目录经 CokeTV HTTP 接口运行上游固定响应；六环节、多清晰度、m3u8 与 WASM 桩 TS 代理通过，示例未进入发行树。完整真实 GET/HEAD/Range/HLS/二进制代理、CLI 和重启持久化脚本也在本机服务验证；另以仅安装生产依赖的独立临时副本复验。以上不等于原生 Linux amd64 Docker 验收、真实站点/真实 WASM 解密或异地客户端验收。

历史版本的 NAS 部署、镜像 digest 和过程记录留在 Git 历史。当前正式说明为 `README.md`、`SECURITY.md`、`docs/SOURCE_DEVELOPMENT.md`、`docs/AI_HANDOFF.md` 与代理约定 `AGENTS.md`；私密 HANDOFF 和 .tools 不提交。
