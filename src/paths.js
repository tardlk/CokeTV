import path from 'path';
import {fileURLToPath} from 'url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ENGINE_DIRS = {dr3: 'js_dr3'};
export const EXTENSIONS = {dr3: '.js'};
export const LEGACY_DIRS = Object.freeze({js: 'js', dr2: 'js_dr2', py: 'py', php: 'php', cat: 'catvod'});
export const sourceAvailable = (state, instance) => !!instance?.enabled && !instance.migrationRequired && state.scripts.some(s => s.id === instance.scriptId && s.engine === 'dr3');
export function inside(root, relative) {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('路径无效');
    const target = path.resolve(root, relative);
    const rel = path.relative(root, target);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('路径越界');
    return target;
}
export function validFilename(engine, name, {library = false} = {}) {
    const extension = typeof name === 'string' && (name.endsWith(EXTENSIONS[engine]) || (library && engine === 'dr3' && /\.(?:mjs|cjs|wasm|bin|dat)$/.test(name)));
    if (!EXTENSIONS[engine] || typeof name !== 'string' || name.length > 180 || /[\\/\x00-\x1f]/.test(name) || name.includes('..') || !extension) throw new Error('源文件名或引擎无效');
    if (!library && name.startsWith('_')) throw new Error('下划线开头的文件作为辅助库上传');
    return name;
}

