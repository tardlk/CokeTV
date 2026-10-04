# 开发与验证

## 工作范围

`src/` 是 CokeTV 宿主，`web/` 是 Vue 页面，`engine/` 保留 drpy-node 执行契约与必要依赖。GUI 显示三种语言，不改变五种引擎的内部标识。

不要修改 `data/runtime/` 来发布内核改动：内核修改应进入 `engine/`。原模块名、源上下文与代理返回语义需要保持兼容。

## 本地检查

```sh
npm run check
npm test
npm run build
```

`npm test` 顺序执行后端 node:test 和 UI Vitest。测试用临时数据目录，不改写现有用户源。

多语言集成测试优先寻找 `.tools/` 下的本机解释器，也可指定：

```sh
TEST_PYTHON="$PWD/.venv/bin/python3" TEST_PHP=php npm test
```

测试实际调用 Python/PHP。未安装解释器时应修复环境，不能用模拟解释器冒充通过。

## 当前验证

本机 macOS arm64 / Node 22 / Python 3.12 / PHP 8.4 已通过 46 项测试、110 个文件语法检查与生产构建。涵盖：

- JS、CatVod、HIPY、PHP、DR2 的首页、分类、搜索、详情、播放与代理协议。
- 实例参数、源级 ENV 隔离、配置持久化、备份与订阅范围。
- 二进制代理、Range/206、HLS 分片与 key 改写。
- 源导入、压缩源编辑、语法检查、版本恢复与同名创建保护。
- 同步死循环回收，后续调用与管理服务可继续运行。
- UI 创建后跳转、重命名、语言筛选、订阅排序、配置表单与退出保护。

这些结果不替代整个第三方源库的持续网络可用性、实际 TVBox 播放、外部插件或 Docker/Linux 验收。GitHub CI 尚未远程运行。

## 源诊断

```sh
npm run verify -- <源实例ID> [服务地址]
```

源的自动诊断沿用原规则协议。本机未安装原 drpy-node-coder CLI，不能声称运行过该工具。

## 执行与前端加载

HTTP 服务启动时不初始化源引擎。执行子进程按需启动，可超时回收；顶层请求串行排队，上限 64。Python 与源辅助服务不额外开放公网端口。

源编辑工作区与 Monaco 代码编辑器独立按需加载。管理列表打开时不加载代码编辑器。

## Git 约定

仓库只提交源码、依赖锁文件、正式文档和配置模板。`data/`、`.tools/`、`.venv/`、`node_modules/`、`dist/`、`.env` 和本地截图/调研历史均忽略。

本地历史资料保存在 `docs/local-history/`，不参与代码构建或发布。原始 drpy-node 源码位于 CokeTV 目录之外，作为对照保留。
