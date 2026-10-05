import axios from 'axios';
import JSON5 from 'json5';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {builtinModules} from 'node:module';
import {detectSourceEngine, decodeSource, syntaxCheck} from './sources.js';
import {EXTENSIONS, ROOT} from './paths.js';
import {cmsScript, parseCmsResponse} from '../engine/utils/tvbox-cms.js';

const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const MAX_BYTES = 32 * 1024 * 1024;
export function remoteUrl(value, base) {
    if (typeof value !== 'string' || !value.trim() || value.length > 10000) throw fail('链接无效');
    const raw = value.trim().split(';md5;')[0];
    if (base && !/^(https?:|\.\.?\/|\/)/i.test(raw)) throw fail('引用不是可下载的 HTTP/HTTPS 地址');
    let url; try { url = new URL(raw, base); } catch { throw fail('请填写 HTTP/HTTPS 链接'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail('只支持不含账号密码的 HTTP/HTTPS 链接');
    url.hash = ''; return url.href;
}
const decode = bytes => {
    try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes).replace(/^\uFEFF/, ''); }
    catch { throw fail('配置或脚本不是 UTF-8 文本'); }
};
async function download(url, budget, limit = 2 * 1024 * 1024) {
    if (budget.signal.aborted) throw fail('读取超时，请减少站点后重试');
    const response = await axios.get(remoteUrl(url), {responseType: 'arraybuffer', timeout: 8000, signal: budget.signal,
        maxRedirects: 5, maxContentLength: limit, maxBodyLength: limit, headers: {'User-Agent': 'Mozilla/5.0', Accept: '*/*'}});
    const bytes = Buffer.from(response.data);
    budget.bytes += bytes.length;
    if (budget.bytes > MAX_BYTES) throw fail('链接资源总大小超过 32MB');
    const finalUrl = remoteUrl(response.request?.res?.responseUrl || url);
    return {code: decode(bytes), url: finalUrl};
}
function parameters(ext, base) {
    if (ext === undefined || ext === null) return '';
    if (typeof ext === 'object') {
        const resolve = value => typeof value === 'string' && /^\.\.?\//.test(value) ? remoteUrl(value, base) : Array.isArray(value) ? value.map(resolve) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)])) : value;
        return JSON.stringify(resolve(ext));
    }
    if (typeof ext !== 'string') throw fail('扩展参数格式不支持');
    if (/^(https?:|\.\.?\/|\/)/i.test(ext)) return remoteUrl(ext, base);
    return ext;
}
function scriptReference(site, base) {
    const api = typeof site.api === 'string' ? site.api : '';
    const ext = typeof site.ext === 'string' ? site.ext : '';
    const scriptSuffix = value => /\.(js|py|php)(?:[?;#]|$)/i.test(value);
    if (/^csp_(?:Drpy|Py|Python|Hip[y]?|Cat|JS)/i.test(api) && scriptSuffix(ext)) {
        return {url: remoteUrl(ext, base), params: '', hint: /^csp_Drpy/i.test(api) ? 'dr2' : null};
    }
    if (scriptSuffix(api) && (Number(site.type) === 3 || /\.(js|py)(?:[?;#]|$)/i.test(api))) {
        if (/drpy(?:2)?(?:\.min)?\.js(?:[?;#]|$)/i.test(api) && /\.js(?:[?;#]|$)/i.test(ext)) return {url: remoteUrl(ext, base), params: '', hint: 'dr2'};
        return {url: remoteUrl(api, base), params: parameters(site.ext, base), hint: null};
    }
    return null;
}
const imports = code => [...code.matchAll(/\b(?:import\s+(?:[^;'"\n]*?\s+from\s*)?|export\s+[^;'"\n]*?\s+from\s*|import\s*\(\s*)['"]([^'"\n]+)['"]/g)];
async function stageCatDependencies(store, resource, budget, files = new Map(), depth = 0) {
    if (depth > 6 || files.size > 24) throw fail('脚本依赖超过 24 个文件或 6 层');
    let code = resource.code;
    for (const match of imports(code)) {
        const specifier = match[1];
        if (specifier.startsWith('assets://js/lib/')) {
            const relative = specifier.slice('assets://js/lib/'.length);
            if (relative.split('/').includes('..') || path.isAbsolute(relative)) throw fail('脚本辅助库路径无效');
            try { await fs.access(path.join(store.runtime, 'spider/catLib', relative)); } catch { throw fail(`缺少 CatVod 辅助库：${relative}`); }
            continue;
        }
        if (/^\.?\.?\/|^https?:\/\//.test(specifier)) {
            const url = remoteUrl(specifier, resource.url);
            if (!/\.(m?js)(?:\?|$)/i.test(url)) throw fail(`不支持的脚本依赖：${specifier}`);
            const filename = `_tvbox-${digest(url)}.js`;
            if (!files.has(url)) {
                files.set(url, {file: filename, code: ''});
                const child = await download(url, budget);
                const result = await stageCatDependencies(store, child, budget, files, depth + 1);
                await syntaxCheck('cat', filename, result.code, store.state.settings);
                files.set(url, {file: filename, code: result.code});
            }
            code = code.replace(match[0], match[0].replace(specifier, `./${filename}`));
        } else {
            const name = specifier.replace(/^node:/, '').split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
            if (!builtinModules.includes(name)) {
                try { await fs.access(path.join(ROOT, 'node_modules', name, 'package.json')); } catch { throw fail(`缺少脚本依赖：${name}`); }
            }
        }
    }
    return {code, dependencies: [...files.values()]};
}
async function classify(store, site, index, base, budget) {
    const entry = {id: String(index), key: String(site?.key || index), name: String(site?.name || site?.key || `站点 ${index + 1}`).slice(0, 200)};
    try {
        if (!site || typeof site !== 'object' || typeof site.api !== 'string') throw fail('站点缺少 API 地址');
        const ref = scriptReference(site, base);
        if (ref) {
            const resource = await download(ref.url, budget);
            const suffix = new URL(ref.url).pathname.match(/\.(js|py|php)$/i)?.[1]?.toLowerCase() || 'js';
            let engine;
            try { engine = await detectSourceEngine(`source.${suffix}`, resource.code); }
            catch (error) { if (error.importCode !== 'IMPORT_ENGINE_REQUIRED') throw error; engine = ['js', 'dr2', 'cat'].includes(site.engine) ? site.engine : ref.hint; }
            if (engine === 'py' && !/class\s+Spider\b/.test(resource.code)) throw fail('Python 文件没有 Spider 入口');
            if (engine === 'php' && !/class\s+Spider\b/.test(resource.code)) throw fail('PHP 文件没有 Spider 入口');
            const decoded = suffix === 'js' ? await decodeSource('js', resource.code) : resource.code;
            if (suffix === 'js' && !/\b(?:var|let|const)\s+rule\s*=|__jsEvalReturn/.test(decoded)) throw fail('JS 文件没有兼容的 rule 或 CatVod 入口');
            const filename = `tvbox-${digest(ref.url)}.${suffix}`;
            await syntaxCheck(engine || 'js', filename, resource.code, store.state.settings);
            const dependencies = engine === 'cat' ? await stageCatDependencies(store, resource, budget) : {code: resource.code, dependencies: []};
            return {...entry, kind: 'script', status: engine ? 'ready' : 'needsEngine', engine: engine || null, url: ref.url,
                file: filename, code: dependencies.code, dependencies: dependencies.dependencies, params: ref.params,
                searchable: site.searchable === undefined ? true : Number(site.searchable) > 0,
                filterable: Number(site.filterable) > 0,
                reason: engine ? '脚本已下载，语法检查通过' : '请选择 JS 运行格式'};
        }
        if ([0, 1].includes(Number(site.type))) {
            const api = remoteUrl(site.api, base);
            const response = await download(api, budget);
            parseCmsResponse(response.code, site.type);
            const config = {api, type: Number(site.type), categories: Array.isArray(site.categories) ? site.categories.filter(item => typeof item === 'string') : []};
            return {...entry, kind: Number(site.type) === 0 ? 'cmsXml' : 'cmsJson', status: 'ready', engine: 'cat', file: `tvbox-cms-${digest(JSON.stringify(config))}.js`,
                code: cmsScript(config), dependencies: [], params: parameters(site.ext, base), searchable: site.searchable === undefined ? true : Number(site.searchable) > 0,
                filterable: false, reason: '采集协议读取通过，将生成源脚本'};
        }
        throw fail(/^csp_/i.test(site.api) ? '此站点依赖 Android JAR，服务器不能运行' : Number(site.type) === 4 ? '此项是远程 T4 服务，没有可下载脚本' : '此站点没有兼容的脚本或采集接口');
    } catch (error) {
        const message = error.response ? `读取失败：HTTP ${error.response.status}` : error.code === 'ECONNABORTED' || error.code === 'ERR_CANCELED' ? '读取超时' : /TLS|secure|socket|ENOTFOUND|ECONNRESET|ECONNREFUSED/i.test(error.message) ? '网络连接失败，请稍后重试' : error.message;
        return {...entry, status: 'skipped', reason: message.slice(0, 500)};
    }
}
export function createTvboxImporter(store, {now = Date.now} = {}) {
    const previews = new Map();
    const prune = () => { for (const [id, item] of previews) if (item.expires < now()) previews.delete(id); };
    return {
        async preview(url) {
            prune();
            const budget = {bytes: 0, signal: AbortSignal.timeout(120000)};
            const config = await download(remoteUrl(url), budget, 8 * 1024 * 1024);
            let value; try { value = JSON5.parse(config.code); } catch { throw fail('链接没有返回有效的 TVBox JSON 配置'); }
            if (!Array.isArray(value?.sites) || value.sites.length < 1 || value.sites.length > 500) throw fail('TVBox 配置需要包含 1–500 个 sites 站点');
            const entries = new Array(value.sites.length); let cursor = 0;
            await Promise.all(Array.from({length: 4}, async () => {
                while (cursor < value.sites.length) { const index = cursor++; entries[index] = await classify(store, value.sites[index], index, config.url, budget); }
            }));
            const id = randomBytes(24).toString('base64url');
            while (previews.size >= 4) previews.delete(previews.keys().next().value);
            previews.set(id, {entries, expires: now() + 15 * 60000, used: false});
            return {previewId: id, total: entries.length, ready: entries.filter(item => item.status === 'ready').length,
                entries: entries.map(({code, dependencies, params, ...entry}) => ({...entry, dependencyCount: dependencies?.length || 0}))};
        },
        async commit({previewId, ids, engines = {}} = {}) {
            prune(); const preview = previews.get(previewId);
            if (!preview || preview.used) throw fail('预览已过期或已导入，请重新读取链接', 409);
            if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw fail('请选择需要导入的源');
            const selected = [...new Set(ids)].map(id => preview.entries.find(item => item.id === String(id)));
            if (selected.some(item => !item || item.status === 'skipped')) throw fail('选择包含不可导入的站点');
            preview.used = true;
            try {
                const staged = [];
                for (const entry of selected) {
                    const engine = entry.engine || engines[entry.id];
                    if (!Object.keys(EXTENSIONS).includes(engine) || (!entry.engine && !['js', 'dr2', 'cat'].includes(engine))) throw fail(`请选择“${entry.name}”的 JS 运行格式`);
                    const file = entry.file.replace(/\.[^.]+$/, EXTENSIONS[engine]);
                    await syntaxCheck(engine, file, entry.code, store.state.settings);
                    if (entry.status === 'needsEngine' && engine === 'cat') throw fail(`“${entry.name}”没有 CatVod 导出，请选择 drpyS 或 DR2`);
                    staged.push({...entry, engine, file});
                }
                const result = await store.importSources(staged); previews.delete(previewId); return result;
            } catch (error) { preview.used = false; throw error; }
        },
    };
}
