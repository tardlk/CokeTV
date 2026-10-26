import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import AdmZip from 'adm-zip';
const exec = promisify(execFile);
const unsupported = () => Object.assign(new Error('只支持 drpy3 源，请先迁移旧脚本'), {statusCode: 422, importCode: 'IMPORT_DRPY3_REQUIRED'});
export function isDrpy3Source(code) {
    return /\blang\s*:\s*['"](?:dr3|drpy3)['"]/i.test(code)
        || /\b(?:from\s*|require\s*\(\s*)['"]drpy3['"]/.test(code)
        || (/\bexport\s+default\b/.test(code) && /\b(?:rule|meta)\s*[:,]/.test(code));
}
export async function syntaxCheck(engine, name, code, settings, {module = false} = {}) {
    if (engine !== 'dr3') throw unsupported();
    if (!module && !name.startsWith('_') && !isDrpy3Source(code)) throw unsupported();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-check-'));
    try {
        const file = path.join(dir, name.endsWith('.cjs') ? 'source.cjs' : 'source.mjs');
        await fs.writeFile(file, code);
        await exec(process.execPath, ['--check', file], {timeout: 10000});
        return {ok: true};
    } catch (error) { throw Object.assign(new Error((error.stderr || error.message).slice(0, 2500)), {statusCode: 400}); }
    finally { await fs.rm(dir, {recursive: true, force: true}); }
}
export async function importBundle(store, bytes) {
    const zip = new AdmZip(bytes), entries = zip.getEntries().filter(e => !e.isDirectory);
    if (!entries.length || entries.length > 1000) throw new Error('源包文件数量无效');
    const staged = []; let total = 0;
    for (const entry of entries) {
        const name = entry.entryName.replace(/\\/g, '/');
        if (name.startsWith('/') || name.split('/').some(p => p === '..') || /(^|\/)\./.test(name) || ((entry.attr >>> 16) & 0o170000) === 0o120000) throw new Error('源包包含非法路径');
        total += entry.header.size;
        if (entry.header.size > 8 * 1024 * 1024 || total > 32 * 1024 * 1024) throw new Error('源包解压大小超过限制');
        const binary = /\.(wasm|bin|dat)$/i.test(name);
        const code = binary ? entry.getData() : entry.getData().toString('utf8');
        let relative;
        if (name.startsWith('spider/js_dr3/') || name.startsWith('json/') || name.startsWith('jx/')) relative = name;
        else if (!name.includes('/')) relative = `spider/js_dr3/${name}`;
        else throw new Error('源包须使用 spider/js_dr3/、json/、jx/，或在根目录放脚本');
        if (!/\.(js|mjs|cjs|wasm|bin|dat|json|txt|m3u|conf)$/i.test(relative)) throw new Error(`文件类型不支持: ${name}`);
        if (binary && !relative.startsWith('spider/js_dr3/')) throw new Error('二进制资源须放在 drpy3 源目录');
        const source = relative.startsWith('spider/js_dr3/') && relative.split('/').length === 3 && relative.endsWith('.js') && !path.basename(relative).startsWith('_');
        if (/\.[cm]?js$/i.test(relative)) await syntaxCheck('dr3', path.basename(relative), code, store.state.settings, {module: !source && !relative.startsWith('jx/')});
        staged.push({relative, code, engine: source ? 'dr3' : null});
    }
    return store.importBundle(staged);
}
