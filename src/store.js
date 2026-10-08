import fs from 'fs/promises';
import path from 'path';
import {randomBytes, createHash} from 'crypto';
import {ROOT, ENGINE_DIRS, EXTENSIONS, inside, validFilename} from './paths.js';
import {SPIDER_FRAMEWORK_FILES} from './runtime-files.js';

export const token = () => randomBytes(24).toString('base64url');
const stableId = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
export const metadata = (code, name) => {
    const title = code.match(/(?:title|标题)\s*:\s*['"]([^'"\n]+)['"]/)?.[1] || name;
    return {title, searchable: !/searchable\s*:\s*0/.test(code), filterable: /filterable\s*:\s*(?:1|true)/.test(code)};
};
const defaults = () => ({version: 1, scripts: [], instances: [], subscriptions: [], settings: {
    publicUrl: '', timeout: 30000, pythonPath: process.env.PYTHON_PATH || 'python3', phpPath: process.env.PHP_PATH || 'php', browserPath: process.env.CHROME_PATH || '',
    env: {}, plugins: [], parses: [], lives: [], jsonPublic: false, allowPrivateTargets: true, targetAllowlist: [],
}});

export class Store {
    constructor(directory = process.env.DATA_DIR || path.join(ROOT, 'data')) {
        this.directory = path.resolve(directory);
        this.runtime = path.join(this.directory, 'runtime');
        this.stateFile = path.join(this.directory, 'state.json');
        this.tail = Promise.resolve();
    }
    async init({seed = true} = {}) {
        await fs.mkdir(this.directory, {recursive: true});
        // 代码随版本更新，源与用户配置只在第一次复制。
        for (const name of ['libs', 'libs_drpy', 'utils', 'controllers']) {
            await fs.cp(path.join(ROOT, 'engine', name), path.join(this.runtime, name), {recursive: true});
        }
        for (const name of ['spider', 'json', 'jx', 'config', 'data']) {
            const target = path.join(this.runtime, name);
            try { await fs.access(target); }
            catch { await fs.cp(path.join(ROOT, 'engine', name), target, {recursive: true}); }
        }
        // 已有 spider 目录也必须升级桥接/基类/辅助库；只覆盖发行清单中的
        // 框架保留路径，不能递归覆盖用户源、用户辅助文件或配置目录。
        for (const relative of SPIDER_FRAMEWORK_FILES) {
            await this.atomic(inside(this.runtime, relative), await fs.readFile(path.join(ROOT, 'engine', relative)));
        }
        for (const dir of Object.values(ENGINE_DIRS)) await fs.mkdir(path.join(this.runtime, 'spider', dir), {recursive: true});
        await fs.writeFile(path.join(this.runtime, 'package.json'), '{"type":"module"}\n');
        // DATA_DIR 可挂载到任意位置；引擎依赖始终使用发行包的安装结果。
        const modules = path.join(this.runtime, 'node_modules');
        const target = path.join(ROOT, 'node_modules');
        try {
            const stat = await fs.lstat(modules);
            if (stat.isSymbolicLink() && await fs.readlink(modules) !== target) { await fs.unlink(modules); await fs.symlink(target, modules, 'junction'); }
        } catch (error) { if (error.code === 'ENOENT') await fs.symlink(target, modules, 'junction'); else throw error; }
        try { this.state = JSON.parse(await fs.readFile(this.stateFile, 'utf8')); }
        catch (error) {
            if (error.code !== 'ENOENT') throw new Error('管理数据损坏，请恢复 data/state.json；不会自动覆盖');
            this.state = defaults();
            this.state.subscriptions = [{id: stableId('default'), name: '默认订阅', token: token(), enabled: true, instances: []}];
            if (seed) await this.scan();
            await this.persist();
        }
        await this.refreshEnvironment();
        await this.syncEnvironment();
        return this;
    }
    async atomic(file, content, {mode} = {}) {
        await fs.mkdir(path.dirname(file), {recursive: true});
        const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
        try { await fs.writeFile(temporary, content, {flag: 'wx', ...(mode === undefined ? {} : {mode})}); await fs.rename(temporary, file); }
        finally { await fs.rm(temporary, {force: true}); }
    }
    async persist() { await this.atomic(this.stateFile, JSON.stringify(this.state, null, 2), {mode: 0o600}); }
    async mutate(fn, {rollback} = {}) {
        const job = this.tail.then(async () => {
            const before = structuredClone(this.state);
            try { const value = await fn(this.state); await this.persist(); return value; }
            catch (error) { this.state = before; if (rollback) await rollback(); throw error; }
        });
        this.tail = job.catch(() => {});
        return job;
    }
    async mutateFiles(fn) {
        const files = new Map();
        let rollbackFailed = false;
        const write = async (file, content, options) => {
            if (!files.has(file)) {
                await fs.mkdir(path.dirname(file), {recursive: true});
                const backup = `${file}.${randomBytes(8).toString('hex')}.rollback`;
                try {
                    // Reserve the old content before replacement. Recovery uses
                    // rename, so it needs no second copy when the disk is full.
                    await fs.copyFile(file, backup, fs.constants.COPYFILE_EXCL);
                    files.set(file, {backup});
                } catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                    files.set(file, {backup: null});
                }
            }
            await this.atomic(file, content, options);
        };
        const rollback = async () => {
            const errors = [];
            for (const [file, {backup}] of [...files].reverse()) {
                try { if (backup) await fs.rename(backup, file); else await fs.rm(file, {force: true}); }
                catch (error) { errors.push(error); }
            }
            if (errors.length) {
                rollbackFailed = true;
                throw new AggregateError(errors, '文件回滚失败，已保留 .rollback 备份，请检查数据目录');
            }
        };
        try { return await this.mutate(state => fn(state, write), {rollback}); }
        finally {
            if (!rollbackFailed) for (const {backup} of files.values()) if (backup) await fs.rm(backup, {force: true}).catch(() => {});
        }
    }
    async syncEnvironment() {
        await this.atomic(path.join(this.runtime, 'config/env.json'), JSON.stringify(this.state.settings.env, null, 2), {mode: 0o600});
        await this.atomic(path.join(this.runtime, '.plugins.js'), `export default ${JSON.stringify(this.state.settings.plugins)};\n`, {mode: 0o600});
    }
    async refreshEnvironment() {
        let value;
        try { value = JSON.parse(await fs.readFile(path.join(this.runtime, 'config/env.json'), 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return; throw new Error('源运行 ENV 配置损坏，不会自动覆盖'); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('源运行 ENV 配置须为对象');
        if (JSON.stringify(value) !== JSON.stringify(this.state.settings.env)) await this.mutate(state => { state.settings.env = value; });
    }
    sourceEnvPath(id) {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('源实例 ID 无效');
        if (!this.state.instances.some(instance => instance.id === id)) throw new Error('源实例不存在');
        return inside(this.runtime, `config/source-env/${id}.json`);
    }
    async readSourceEnvironment(id) {
        const file = this.sourceEnvPath(id);
        try { return JSON.parse(await fs.readFile(file, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    }
    scriptPath(script) { return inside(this.runtime, `spider/${ENGINE_DIRS[script.engine]}/${script.file}`); }
    async scan() {
        let added = 0;
        for (const [engine, dir] of Object.entries(ENGINE_DIRS)) {
            for (const name of await fs.readdir(path.join(this.runtime, 'spider', dir))) {
                if (name.startsWith('_') || !name.endsWith(EXTENSIONS[engine])) continue;
                const file = path.join(this.runtime, 'spider', dir, name);
                if (!(await fs.stat(file)).isFile()) continue;
                const code = await fs.readFile(file, 'utf8');
                if (engine === 'py' && !/class\s+Spider\b/.test(code)) continue;
                if (engine === 'php' && !/class\s+Spider\b/.test(code)) continue;
                const id = stableId(`${engine}:${name}`);
                if (this.state.scripts.some(s => s.id === id)) continue;
                const info = metadata(code, name.slice(0, -EXTENSIONS[engine].length));
                this.state.scripts.push({id, engine, file: name, name: info.title, updatedAt: new Date().toISOString()});
                const instance = {id, scriptId: id, name: info.title, params: '', enabled: true, searchable: info.searchable, filterable: info.filterable};
                this.state.instances.push(instance);
                this.state.subscriptions[0]?.instances.push(id);
                added++;
            }
        }
        let mapping = '';
        try { mapping = await fs.readFile(path.join(this.runtime, 'config/map.txt'), 'utf8'); } catch {}
        for (const line of mapping.split(/\r?\n/)) {
            if (!line.trim() || line.startsWith('#')) continue;
            const [moduleName, rawParams, alias] = line.split('@@');
            if (!rawParams) continue;
            const script = this.state.scripts.find(s => s.file === moduleName + EXTENSIONS[s.engine]);
            if (!script) continue;
            const query = rawParams.startsWith('?') ? new URLSearchParams(rawParams.slice(1)) : null;
            const params = query?.get('type') === 'url' ? query.get('params') || '' : rawParams;
            const id = stableId(`${script.id}:${params}:${alias || moduleName}`);
            if (this.state.instances.some(s => s.id === id)) continue;
            const original = this.state.instances.find(s => s.scriptId === script.id);
            this.state.instances.push({enabled: true, searchable: true, filterable: false, ...original, id, scriptId: script.id, params, name: alias || moduleName, migrated: true});
            this.state.subscriptions[0]?.instances.push(id);
            added++;
        }
        return added;
    }
    resolve(id, engine) {
        let instance = this.state.instances.find(s => s.id === id);
        let script = instance && this.state.scripts.find(s => s.id === instance.scriptId);
        if (!instance) {
            script = this.state.scripts.find(s => s.engine === (engine || 'js') && s.file === `${id}${EXTENSIONS[s.engine]}`);
            instance = script && this.state.instances.find(s => s.scriptId === script.id && s.enabled);
        }
        if (!script || !instance) throw Object.assign(new Error('源不存在'), {statusCode: 404});
        if (!instance.enabled) throw Object.assign(new Error('源已停用'), {statusCode: 403});
        return {script, instance, file: this.scriptPath(script)};
    }
    async saveScript(engine, name, code, {createOnly = false} = {}) {
        validFilename(engine, name);
        return this.mutateFiles((state, write) => this.writeScript(state, write, engine, name, code, {createOnly}));
    }
    async writeScript(state, write, engine, name, code, {createOnly = false} = {}) {
        validFilename(engine, name);
        const id = stableId(`${engine}:${name}`);
        const file = inside(this.runtime, `spider/${ENGINE_DIRS[engine]}/${name}`);
        let previous = null;
        try { previous = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (createOnly && (previous !== null || state.scripts.some(script => script.id === id))) throw Object.assign(new Error('同类型的脚本名已存在，请换一个名称'), {statusCode: 409});
        if (previous !== null) await write(path.join(this.directory, 'revisions', id, `${Date.now()}-${randomBytes(3).toString('hex')}.txt`), previous);
        await write(file, code);
        let script = state.scripts.find(s => s.id === id);
        if (!script) {
            const info = metadata(code, name.slice(0, -EXTENSIONS[engine].length));
            script = {id, engine, file: name, name: info.title};
            state.scripts.push(script);
            state.instances.push({id, scriptId: id, name: info.title, params: '', enabled: true, searchable: info.searchable, filterable: info.filterable});
        }
        script.updatedAt = new Date().toISOString();
        return script;
    }
    async importBundle(entries) {
        return this.mutateFiles(async (state, write) => {
            const planned = new Map();
            for (const entry of entries) {
                const file = inside(this.runtime, entry.relative);
                let previous;
                try { previous = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
                if ((previous !== undefined && previous !== entry.code) || (planned.has(file) && planned.get(file).code !== entry.code)) {
                    throw Object.assign(new Error(`源包文件冲突：${entry.relative}，不会覆盖已有文件`), {statusCode: 409});
                }
                planned.set(file, {...entry, exists: previous !== undefined});
            }
            const before = state.instances.length;
            for (const [file, entry] of planned) {
                if (entry.exists) continue;
                if (entry.engine) await this.writeScript(state, write, entry.engine, path.basename(file), entry.code);
                else await write(file, entry.code);
            }
            await this.scan();
            return {files: entries.length, added: state.instances.length - before};
        });
    }
    async importSources(entries) {
        const createdFiles = [];
        return this.mutate(async state => {
            const writes = new Map(), imported = [], existing = [];
            const prepare = async (engine, file, code, library = false) => {
                validFilename(engine, file, {library});
                const target = inside(this.runtime, `spider/${ENGINE_DIRS[engine]}/${file}`);
                let current;
                try { current = await fs.readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
                if (current !== undefined && current !== code) return false;
                if (writes.has(target) && writes.get(target) !== code) return false;
                if (current === undefined) writes.set(target, code);
                return true;
            };
            try {
                for (const entry of entries) {
                    let filename = entry.file;
                    if (!await prepare(entry.engine, filename, entry.code)) {
                        filename = filename.replace(/\.[^.]+$/, `-${stableId(entry.code).slice(0, 8)}${EXTENSIONS[entry.engine]}`);
                        if (!await prepare(entry.engine, filename, entry.code)) throw new Error(`脚本文件冲突：${entry.name}`);
                    }
                    for (const dependency of entry.dependencies || []) {
                        if (!await prepare(entry.engine, dependency.file, dependency.code, true)) throw new Error(`辅助库已有不同内容：${dependency.file}，不会覆盖`);
                    }
                    const scriptId = stableId(`${entry.engine}:${filename}`);
                    if (!state.scripts.some(item => item.id === scriptId)) state.scripts.push({id: scriptId, engine: entry.engine, file: filename, name: entry.name, updatedAt: new Date().toISOString()});
                    const identity = stableId(`tvbox:${scriptId}:${entry.key}:${entry.params}`);
                    const found = state.instances.find(item => item.id === identity);
                    if (found) { existing.push({id: found.id, name: found.name}); continue; }
                    const instance = {id: identity, scriptId, name: entry.name, params: entry.params, enabled: true, searchable: entry.searchable, filterable: entry.filterable};
                    state.instances.push(instance); imported.push({id: identity, name: entry.name});
                }
                // Validate the entire selection and collisions before creating files.
                for (const [target, code] of writes) {
                    await fs.mkdir(path.dirname(target), {recursive: true});
                    try { await fs.writeFile(target, code, {flag: 'wx'}); createdFiles.push(target); }
                    catch (error) { if (error.code !== 'EEXIST' || await fs.readFile(target, 'utf8') !== code) throw error; }
                }
                return {imported: imported.length, existing: existing.length, sources: imported, duplicates: existing};
            } catch (error) {
                for (const target of createdFiles) await fs.rm(target, {force: true});
                throw error;
            }
        }, {rollback: async () => { for (const target of createdFiles) await fs.rm(target, {force: true}); }});
    }
}
