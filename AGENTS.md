# CokeTV 工作约定

使用中文沟通。用户已澄清（2026-10-04）：drpy-node 能运行的源全部保留，包括 JS、Python、PHP、CatVod 等。OmniBox 只作为界面与交互参考，不增加其 SDK/Runner 适配。产品集中在源执行、TVBox 订阅与源/订阅 GUI，精简外围应用与常驻服务，不裁剪源引擎和必要依赖。

`engine/` 是从原项目抽取的兼容内核与初始源；`src/` 是宿主服务；`web/` 是管理页面；运行文件在 `data/`。不要直接修改用户的运行数据，框架修改进入 `engine/`。

正式文档为 `README.md`、`docs/CONFIGURATION.md`、`docs/DEVELOPMENT.md` 和 `docs/THIRD_PARTY.md`。`docs/local-history/` 是本机调研与旧界面留档，内容可能已过时，不作为当前产品规范。运行数据、工具、截图和调研历史由 Git 忽略，不提交。

源执行接口、代理返回语义和原模块名路径需要保持兼容。框架测试使用 node:test，依赖外部站点的结果不能代替固定样本的协议测试。

修改完成运行 `npm test`、`npm run check` 和 `npm run build`。源文件的诊断沿用原规则协议；当前机器未安装原 drpy-node-coder CLI，不能声称执行过该 CLI。
