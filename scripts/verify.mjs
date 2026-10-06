import {emitKeypressEvents} from 'node:readline';
import {pathToFileURL} from 'node:url';

const usage = '用法：npm run verify -- <源实例ID> [服务地址] [--password-stdin]\n终端可隐藏输入密码；非交互使用 ADMIN_PASSWORD 或 --password-stdin。';
const fail = (message, exitCode = 1) => Object.assign(new Error(message), {exitCode});

export function promptPassword({input = process.stdin, output = process.stderr} = {}) {
    if (!input.isTTY || typeof input.setRawMode !== 'function') throw fail('终端不支持隐藏输入，请使用 ADMIN_PASSWORD 或 --password-stdin');
    return new Promise((resolve, reject) => {
        let password = '', done = false;
        const wasRaw = !!input.isRaw;
        const finish = error => {
            if (done) return; done = true;
            input.off('keypress', keypress); input.off('end', ended); input.off('error', failed);
            try { input.setRawMode(wasRaw); } catch {} // The terminal may already have disconnected.
            input.pause(); output.write('\n');
            if (error) reject(error); else resolve(password);
        };
        const ended = () => finish(fail('密码输入已取消', 130));
        const failed = () => finish(fail('密码输入失败'));
        const keypress = (text, key = {}) => {
            if (key.ctrl && ['c', 'd'].includes(key.name)) { ended(); return; }
            if (['return', 'enter'].includes(key.name)) { finish(); return; }
            if (key.name === 'backspace') { password = Array.from(password).slice(0, -1).join(''); return; }
            if (key.ctrl || key.meta || !text || text.startsWith('\u001b') || /[\u0000-\u001f\u007f]/.test(text)) return;
            if (Buffer.byteLength(password + text) > 4096) { finish(fail('密码输入超过大小限制')); return; }
            password += text;
        };
        emitKeypressEvents(input);
        input.on('keypress', keypress); input.once('end', ended); input.once('error', failed);
        try { input.setRawMode(true); output.write('管理密码（不回显）：'); input.resume(); }
        catch { failed(); }
    });
}
export async function readPassword({passwordStdin = false, input = process.stdin, output = process.stderr, env = process.env} = {}) {
    let password;
    if (passwordStdin && input.isTTY) password = await promptPassword({input, output});
    else if (passwordStdin) {
        const chunks = []; let size = 0;
        for await (const chunk of input) {
            const bytes = Buffer.from(chunk); size += bytes.length;
            if (size > 4096) throw fail('密码输入超过大小限制');
            chunks.push(bytes);
        }
        // Strip a single line ending, preserving meaningful leading/trailing
        // spaces, Unicode and colons in the actual password.
        password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
    } else if (env.ADMIN_PASSWORD) password = env.ADMIN_PASSWORD;
    else if (input.isTTY) password = await promptPassword({input, output});
    else throw fail('请提供管理密码：设置 ADMIN_PASSWORD 或使用 --password-stdin；终端支持隐藏输入');
    if (!password) throw fail('管理密码不能为空');
    return password;
}

export async function main(args = process.argv.slice(2)) {
    if (args.includes('--help')) { console.log(usage); return; }
    const positional = args.filter(value => value !== '--password-stdin');
    if (!positional[0] || positional.length > 2) throw fail(usage);
    const [source, base = 'http://127.0.0.1:54058'] = positional;
    let server;
    try { server = new URL(base); } catch { throw fail('服务地址须为 HTTP/HTTPS URL'); }
    if (!['http:', 'https:'].includes(server.protocol)) throw fail('服务地址须为 HTTP/HTTPS URL');
    const password = await readPassword({passwordStdin: args.includes('--password-stdin')});
    const headers = {Authorization: `Basic ${Buffer.from(`:${password}`).toString('base64')}`};
    const get = async query => {
        const response = await fetch(`${base.replace(/\/$/, '')}/api/${encodeURIComponent(source)}?${new URLSearchParams(query)}`, {headers});
        let body;
        try { body = await response.json(); } catch { throw fail(`服务返回非 JSON 响应（HTTP ${response.status}）`); }
        if (!response.ok || body?.error) throw fail(body?.error || `HTTP ${response.status}`);
        return body;
    };
    const home = await get({});
    console.log(`首页：${home.class?.length || 0} 个分类，${home.list?.length || 0} 个推荐`);
    let list = home.list;
    if (home.class?.length) { const category = await get({ac: 'list', t: home.class[0].type_id, pg: '1'}); list = category.list; console.log(`分类：${list?.length || 0} 个条目`); }
    if (list?.[0]?.vod_id) { const detail = await get({ac: 'detail', ids: list[0].vod_id}); console.log(`详情：${detail.list?.[0]?.vod_name || '无名称'}，${detail.list?.[0]?.vod_play_url ? '有播放列表' : '无播放列表'}`); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error(error.message); process.exitCode = error.exitCode || 1; });
}
