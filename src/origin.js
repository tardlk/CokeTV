// 统一的管理写接口「跨站请求」防护。
//
// 设计目标（见 SECURITY.md「管理接口」一节）：
//   * 所有 /admin/* 的非安全方法（POST/PUT/PATCH/DELETE）走同一套来源判定，
//     不再让 netdisk / emby 各维护一份。
//   * 规则固定为三档：
//       Sec-Fetch-Site: cross-site        → 一律拒绝
//       带 Origin                         → 必须精确等于同源
//       不带 Origin                       → 放行（CLI / 原生客户端 / 自动化兼容）
//   * 刻意不要求所有写请求都必须带 Origin：curl、脚本、TVBox 等客户端普遍不带，
//     强制要求会制造新的兼容性问题。
const fail = (message, statusCode = 403) => Object.assign(new Error(message), {statusCode});
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// 反代场景下 request.protocol 可能退化为 http（TRUST_PROXY 默认关闭），
// 提示运维检查配置，而不是自动信任未受信来源的 X-Forwarded-*。
const CROSS_SITE_MESSAGE = '不允许跨站修改；如使用 HTTPS 反向代理，请检查 TRUST_PROXY 和反向代理的转发头配置';

export const requestOrigin = request => new URL(`${request.protocol}://${request.host}`).origin;

export function checkUnsafeRequestOrigin(request) {
    if (SAFE_METHODS.has(String(request.method || 'GET').toUpperCase())) return;
    const headers = request.headers || {};
    if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') throw fail(CROSS_SITE_MESSAGE);
    const raw = headers.origin;
    // 无 Origin：无法证明是跨站浏览器请求，按 CLI/自动化放行（仍受管理密码保护）。
    if (!raw) return;
    // 两侧都归一化后再比较：new URL('http://host:80').origin 会去掉默认端口，
    // 直接用原始头字符串比较会把「显式写了默认端口」的同源请求误判为跨站。
    let origin, ownOrigin;
    try { origin = new URL(raw).origin; ownOrigin = requestOrigin(request); }
    catch { throw fail(CROSS_SITE_MESSAGE); }
    if (origin !== ownOrigin) throw fail(CROSS_SITE_MESSAGE);
}
