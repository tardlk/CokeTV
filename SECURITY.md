# 安全策略

## 漏洞报告

请在 [GitHub Issues](https://github.com/tardlk/CokeTV/issues) 报告安全问题；涉及可利用细节时，建议先用 Issue 说明意图，再通过仓库所有者提供的方式私下沟通，避免在修复前公开利用细节。

报告时请提供：受影响的版本/提交或镜像 digest、复现步骤、影响范围，以及（如适用）最小化的 PoC。

## 支持版本

项目按分支/标签发布，`latest` 对应 `main`。安全修复只会合入 `main` 并在此后发布的镜像中体现；旧标签不单独回补。

## 已知信任边界（务必先读）

2026-10-06 接手复核发现尚未修复的缺口：媒体票据载荷可解码出源返回的 Cookie/Authorization；映射 IPv6、检查与连接分离的 DNS 解析、`/http` 自动重定向可以绕过当前出口策略。PHP 异常响应也可包含私有源参数。以下描述是当前设计与已有防护，不能视为完整安全保证；实测证据和修复要求统一记录在 [AI_HANDOFF 第 7.3 节](docs/AI_HANDOFF.md#73-全面接手复核2026-10-06新增发现尚未修复)。

- **源脚本 = 任意代码执行。** 源脚本在服务器上以与 CokeTV **相同的权限**执行：JS 源可直接 `require` Node 模块，Python/PHP 源可访问文件系统与网络。**导入任何第三方源（尤其是来路不明的 TVBox 订阅链接）等价于允许其在你的服务器上执行任意代码。**
- 因此：不要在公网无鉴权暴露本服务；不要导入不可信来源的源；生产部署请参考 `compose.yaml` 的非 root/能力裁剪示例（`USER node`、`cap_drop: [ALL]`、`no-new-privileges`）。
- **管理后台凭据**是唯一的管理入口凭据。请使用独立强口令，并保护好 `data/` 备份（其中含管理凭据的加盐哈希与源 ENV）。
- **首装引导码**：未设密码时，创建管理密码需要一次性引导码（见服务启动日志 / `data/setup-code.txt`），用于防止公网部署在运维设密前被匿名抢占管理员身份。无人值守部署建议直接设置 `ADMIN_PASSWORD`。
- **媒体代理**：浏览器媒体请求使用 12 小时 HMAC 签名票据，媒体票据在 `/watch/media/:ticket` 只抓签名内 URL，并可访问所属源的 `/proxy/:module/*`（该入口只绑定源，不绑定 URL）；分片/转发用的 `proxy` 票据绑定具体 URL。两类票据均不能用于管理接口、源 API 或订阅。代理出口默认允许内网地址（家庭访问 NAS），策略目标是永久拒绝云元数据；当前绕过见接手文档 R3/R4/R6。公网部署建议把 `allowPrivateTargets` 设为 `false`，该开关仍有上述缺口。
- **`/json/` 参数文件**默认不匿名可读（可能含 Cookie/Token），只有管理员、订阅 Token 或源内部请求可读；可用 `jsonPublic` 恢复旧的公开行为，但公网部署不建议。

## 已知依赖漏洞（白名单）

2026-10-06 已把 Fastify 4→5、`@fastify/static` 7→10、`@fastify/multipart` 8→9、`@fastify/formbody` 7→8、`basic-ftp` 5→6、`puppeteer-core` 24→25，`npm audit` 从 13 项降到 **4 项**（其中 3 项为 dev-only）：

| 包 | 严重度 | 影响面 | 处置 |
| --- | --- | --- | --- |
| `node-forge` | high | **运行时**（内核加密/签名）。`GHSA-86w9-cpqp-85rv`：RSA PKCS#1 v1.5 签名校验接受多余嵌套 DigestAlgorithm。本项目对 node-forge 主要用作加密/解密与源自定义的签名逻辑。 | **上游无修复版本**（`fixAvailable: false`）。接受该风险；不要依赖 node-forge 做不可信来源的签名校验。等待上游修复后升级。 |
| `vitest` | critical | **dev-only**（测试运行器），不进镜像运行路径。 | 需升级到 vitest 5（主版本）。 |
| `tinypool` | critical | **dev-only**（vitest 的线程池依赖），不进镜像运行路径。 | 随 vitest 主版本升级一并解决。 |
| `@vitest/mocker` | moderate | **dev-only**，不进镜像运行路径。 | 随 vitest 主版本升级一并解决。 |

即：唯一进入运行时的是 `node-forge`，且无上游修复版本；其余 3 项都在 `devDependencies`，**镜像运行路径不包含它们**（Dockerfile 只 `npm prune --omit=dev` 后复制生产依赖）。

发布前重新执行 `npm audit` 并在本文件更新该表。

## 限流与反代前提

- 公开接口（`/watch/*`、`/mediaProxy`、`/proxy/*`、`/req/*`、`/m3u8-proxy/*`、`/subscription/*`、`/config`）按来源 IP 限流，默认 `RATE_LIMIT_PER_MINUTE=1200`/分钟；仅 GET/HEAD 媒体转发路由（`/mediaProxy`、`/req/*`、`/m3u8-proxy/{playlist,ts,proxy}`、`/unified-proxy/proxy`、`/file-proxy/proxy`）中，签名有效且绑定当前目标 URL 的 **`proxy` 票据**豁免，以保留同一 NAT 后多观众的 HLS 分片/key 请求余量。`/proxy/:module/*` 会执行源逻辑，媒体票据在该入口只绑定源，因此即使带有效票据也照常限流；将票据放到其他路由或更换目标 URL 同样不豁免。限流按匹配到的路由判断，覆盖编码路径与 absolute-form 请求。
- `/admin/*` 同样按 IP 限流，并对**鉴权失败**单独计数，默认 `ADMIN_AUTH_FAIL_PER_MINUTE=20`；耗尽后该 IP 在一分钟窗口内一律 429（包含随后给出的正确密码），用于抵御在线爆破。两个阈值都可用同名环境变量调整。
- `TRUST_PROXY=1` 时 `request.ip` 取自 `X-Forwarded-For`。**必须确保前置反向代理可信且会覆写该头**；否则攻击者可伪造 IP 绕过限流。
- 密码校验使用 scrypt（`N=16384`）且为**异步**实现（跑在 libuv 线程池），未鉴权请求无法阻塞主事件循环；仍建议用限流把并发 KDF 成本压在可控范围。

## 部署建议清单

1. 设置 `ADMIN_PASSWORD` 或及时用引导码创建强口令。
2. 公网部署把 `allowPrivateTargets` 设为 `false`，必要时配置 `targetAllowlist`。
3. 保持容器非 root 并限制能力；不要把 `data/` 暴露给不可信进程。
4. 若放在反向代理后，谨慎开启 `TRUST_PROXY`，并确保代理本身已鉴权/限流。
5. 定期更新镜像；关注 `npm audit` 与发布说明。
