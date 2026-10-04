import path from 'path';
import {fileURLToPath} from 'url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ENGINE_DIRS = {js: 'js', dr2: 'js_dr2', py: 'py', php: 'php', cat: 'catvod'};
export const EXTENSIONS = {js: '.js', dr2: '.js', py: '.py', php: '.php', cat: '.js'};
export function inside(root, relative) {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('路径无效');
    const target = path.resolve(root, relative);
    const rel = path.relative(root, target);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('路径越界');
    return target;
}
export function validFilename(engine, name, {library = false} = {}) {
    if (!EXTENSIONS[engine] || typeof name !== 'string' || name.length > 180 || /[\\/\x00-\x1f]/.test(name) || name.includes('..') || !name.endsWith(EXTENSIONS[engine])) throw new Error('源文件名或引擎无效');
    if (!library && name.startsWith('_')) throw new Error('下划线开头的文件作为辅助库上传');
    return name;
}

