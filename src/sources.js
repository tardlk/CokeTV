import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {execFile} from 'child_process';
import {promisify} from 'util';
import AdmZip from 'adm-zip';
import {ENGINE_DIRS, EXTENSIONS, ROOT} from './paths.js';
import {pathToFileURL} from 'url';
const exec = promisify(execFile);
export const requireImportEngine = () => Object.assign(new Error('无法确定 JS 源的运行格式，请选择对应引擎'), {statusCode: 422, importCode: 'IMPORT_ENGINE_REQUIRED'});
export async function detectSourceEngine(name, code) {
    if (/\.py$/i.test(name)) return 'py';
    if (/\.php$/i.test(name)) return 'php';
    if (!/\.js$/i.test(name)) throw Object.assign(new Error('文件类型不支持'), {statusCode: 400});
    const decoded = await decodeSource('js', code);
    if (/\bexport\s+(?:async\s+)?function\s+__jsEvalReturn\b|\bexport\s*\{[^}]*\b__jsEvalReturn\b/.test(decoded)) return 'cat';
    const lang = decoded.match(/\blang\s*:\s*['"]([^'"]+)['"]/)?.[1]?.toLowerCase();
    if (['cat', 'catvod'].includes(lang)) return 'cat';
    if (['dr2', 'drpy2'].includes(lang)) return 'dr2';
    if (['ds', 'drpys'].includes(lang)) return 'js';
    throw requireImportEngine();
}
export async function decodeSource(engine, code) {
    if (!['js', 'dr2'].includes(engine)) return code;
    const {getOriginalJs} = await import(pathToFileURL(path.join(ROOT, 'engine/libs_drpy/drpyCustom.js')).href);
    return getOriginalJs(code);
}

export async function syntaxCheck(engine, name, code, settings) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-'));
    const file = path.join(dir, name);
    try {
        await fs.writeFile(file, await decodeSource(engine, code));
        if (engine === 'py') await exec(settings.pythonPath, ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8-sig").read())', file], {timeout: 10000});
        else if (engine === 'php') await exec(settings.phpPath, ['-l', file], {timeout: 10000});
        else await exec(process.execPath, ['--check', file], {timeout: 10000});
        return {ok: true};
    } catch (error) {
        if (error.code === 'ENOENT') throw new Error(`找不到 ${engine === 'php' ? 'PHP' : 'Python'} 解释器，请在设置中配置路径`);
        throw Object.assign(new Error((error.stderr || error.stdout || error.message).slice(0, 2500)), {statusCode: 400});
    } finally { await fs.rm(dir, {recursive: true, force: true}); }
}

export async function importBundle(store, engine, bytes) {
    if (engine !== 'auto' && !ENGINE_DIRS[engine]) throw new Error('请选择有效引擎');
    const zip = new AdmZip(bytes);
    const entries = zip.getEntries().filter(entry => !entry.isDirectory);
    if (!entries.length || entries.length > 1000) throw new Error('源包文件数量无效');
    const staged = []; let total = 0;
    for (const entry of entries) {
        const name = entry.entryName.replace(/\\/g, '/');
        if (name.startsWith('/') || name.split('/').some(p => p === '..') || /(^|\/)\./.test(name) || ((entry.attr >>> 16) & 0o170000) === 0o120000) throw new Error('源包包含非法路径');
        total += entry.header.size;
        if (entry.header.size > 8 * 1024 * 1024 || total > 32 * 1024 * 1024) throw new Error('源包解压大小超过限制');
        const code = entry.getData().toString('utf8');
        let relative;
        if (name.startsWith('spider/')) {
            const dir = name.split('/')[1];
            if (![...Object.values(ENGINE_DIRS), 'catLib'].includes(dir)) throw new Error(`源包目录不支持: ${dir}`);
            relative = name;
        } else if (name.startsWith('json/') || name.startsWith('jx/')) relative = name;
        else if (!name.includes('/')) {
            const entryEngine = /\.(py|php)$/i.test(name) ? await detectSourceEngine(name, '') : engine === 'auto' ? (/\.js$/i.test(name) ? await detectSourceEngine(name, code) : 'js') : engine;
            relative = `spider/${ENGINE_DIRS[entryEngine]}/${name}`;
        }
        else throw new Error('源包须使用 spider/<引擎目录>、json/、jx/，或根目录直接放脚本');
        if (!/\.(js|py|php|json|txt|m3u|conf)$/i.test(relative)) throw new Error(`文件类型不支持: ${name}`);
        const sourceEngine = Object.keys(ENGINE_DIRS).find(key => relative.startsWith(`spider/${ENGINE_DIRS[key]}/`));
        if (sourceEngine && code && !path.basename(relative).startsWith('_')) await syntaxCheck(sourceEngine, path.basename(relative), code, store.state.settings);
        staged.push({relative, code, engine: sourceEngine && !path.basename(relative).startsWith('_') && relative.endsWith(EXTENSIONS[sourceEngine]) && relative.split('/').length === 3 ? sourceEngine : null});
    }
    return store.importBundle(staged);
}
