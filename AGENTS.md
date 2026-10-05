# CokeTV 工作约定

使用中文沟通。用户已澄清（2026-10-04）：drpy-node 能运行的源全部保留，包括 JS、Python、PHP、CatVod 等。OmniBox 只作为界面与交互参考，不增加其 SDK/Runner 适配。产品集中在源执行、TVBox 订阅与源/订阅 GUI，精简外围应用与常驻服务，不裁剪源引擎和必要依赖。

用户确认（2026-10-05）：首页直接进入公开观影，浏览、搜索、详情和播放不要求密码；只有管理后台（`/admin`）和源编辑需要管理密码。首次部署在首次进入管理后台时创建密码。公开接口不得返回源参数、ENV、脚本、订阅 Token 或运行设置，TVBox 订阅仍保留原 Token 鉴权。

用户确认（2026-10-05）：源导入支持 TVBox 配置链接。预览提取兼容脚本及 JSON/XML 采集接口，再选择导入；保留本地文件/ZIP 入口。不引入 Android JAR 运行器，不覆盖用户原脚本、实例或订阅。

开始接手先读本文件和 `docs/AI_HANDOFF.md`。用户确认（2026-10-05）：发行源码与 Docker 镜像必须是空壳，零预置站点脚本、解析脚本和站点资源；保留全部引擎及兼容辅助库。不得通过扫描、默认导入或下载恢复原300多源。GitHub Actions发布 `linux/amd64` 到 `ghcr.io/tardlk/coketv`，检查和容器验收通过后才能发布镜像。

本机忽略的 `HANDOFF.md` 可能含私密调试信息，只供本机阅读，不能提交；公开交接维护 `docs/AI_HANDOFF.md`。

`engine/` 是从原项目抽取的兼容内核和辅助库；`src/` 是宿主服务；`web/` 是管理页面；运行文件在 `data/`。不要直接修改用户的运行数据，框架修改进入 `engine/`。

正式文档为 `README.md`、`docs/CONFIGURATION.md`、`docs/DEVELOPMENT.md` 和 `docs/THIRD_PARTY.md`。`docs/local-history/` 是本机调研与旧界面留档，内容可能已过时，不作为当前产品规范。运行数据、工具、截图和调研历史由 Git 忽略，不提交。

源执行接口、代理返回语义和原模块名路径需要保持兼容。框架测试使用 node:test，依赖外部站点的结果不能代替固定样本的协议测试。

修改完成运行 `npm test`、`npm run check` 和 `npm run build`。源文件的诊断沿用原规则协议；当前机器未安装原 drpy-node-coder CLI，不能声称执行过该 CLI。
