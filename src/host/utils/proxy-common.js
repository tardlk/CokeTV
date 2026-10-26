/**
 * 代理控制器公共纯函数集 (P2 公共层抽取)
 */

/**
 * 解析 HTTP Range 头（bytes=<start>-[<end>]）
 *
 * 收敛自 webdav-proxy / ftp-proxy / m3u8-proxy(HEAD) 中逐字重复的解析片段；
 * 仅负责语法拆解，越界(416)判断仍由调用方结合资源总长自行处理——与原实现一致。
 *
 * @param {string|undefined} rangeHeader - 请求中的 Range 头
 * @param {number} totalSize - 资源总大小（用于缺省 end = size-1）
 * @returns {{start: number, end: number}|null} 无 Range 头时返回 null
 */
export function parseRangeHeader(rangeHeader, totalSize) {
    if (!rangeHeader) return null;

    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

    return {start, end};
}
