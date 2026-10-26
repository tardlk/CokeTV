import fs from 'fs/promises';
import path from 'path';
import {randomBytes, createHash} from 'crypto';
import {ROOT, ENGINE_DIRS, EXTENSIONS, LEGACY_DIRS, inside, validFilename} from './paths.js';

export const token = () => randomBytes(24).toString('base64url');
const stableId = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
export const metadata = (code, name) => {
    const title = code.match(/(?:title|标题)\s*:\s*['"]([^'"\n]+)['"]/)?.[1] || name;
    return {title, searchable: !/searchable\s*:\s*0/.test(code), filterable: /filterable\s*:\s*(?:1|true)/.test(code),
        navigation: /\bnavigation\s*:\s*(?:true|1)\b/i.test(code)};
};
const defaults = () => ({version: 2, scripts: [], instances: [], subscriptions: [], settings: {
    env: {}, parses: [], lives: [], jsonPublic: false, allowPrivateTargets: true, targetAllowlist: [],
}});

export class Store {
    constructor(directory = process.env.DATA_DIR || path.join(ROOT, 'data')) {
        this.directory = path.resolve(directory);
        this.runtime = path.join(this.directory, 'runtime');
        this.stateFile = path.join(this.directory, 'state.json');
        this.tail = Promise.resolve();
    }
    async init() {
        await fs.mkdir(this.directory, {recursive: true});
        try { this.state = JSON.parse(await fs.readFile(this.stateFile, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw new Error('管理数据损坏，请恢复 data/state.json；不会自动覆盖'); }
        // Back up old data before refreshing any runtime files.
        if (this.state) await this.upgrade();
        await fs.cp(path.join(ROOT, 'engine/libs/drpy3'), path.join(this.runtime, 'libs/drpy3'), {recursive: true});
        for (const dir of ['json', 'jx', 'config', 'data']) await fs.mkdir(path.join(this.runtime, dir), {recursive: true});
        for (const dir of Object.values(ENGINE_DIRS)) await fs.mkdir(path.join(this.runtime, 'spider', dir), {recursive: true});
        await fs.writeFile(path.join(this.runtime, 'package.json'), '{"type":"module"}\n');
        const modules = path.join(this.runtime, 'node_modules'), target = path.join(ROOT, 'node_modules');
        try {
            const stat = await fs.lstat(modules);
            if (stat.isSymbolicLink() && await fs.readlink(modules) !== target) { await fs.unlink(modules); await fs.symlink(target, modules, 'junction'); }
        } catch (error) { if (error.code === 'ENOENT') await fs.symlink(target, modules, 'junction'); else throw error; }
        if (!this.state) {
            this.state = defaults();
            this.state.subscriptions = [{id: stableId('default'), name: '默认订阅', token: token(), enabled: true, instances: []}];
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
    async upgrade() {
        if (this.state.version === 2) return;
        if (this.state.version !== 1) throw new Error('不支持此管理数据版本');
        const backup = path.join(this.directory, 'backups', `before-drpy3-${Date.now()}-${randomBytes(4).toString('hex')}`);
        await fs.mkdir(backup, {recursive: true, mode: 0o700});
        for (const name of await fs.readdir(this.directory)) {
            if (name === 'backups') continue;
            await fs.cp(path.join(this.directory, name), path.join(backup, name), {
                recursive: true, verbatimSymlinks: true,
                filter: file => file !== path.join(this.runtime, 'node_modules'),
            });
        }
        const protect = async directory => {
            await fs.chmod(directory, 0o700);
            for (const item of await fs.readdir(directory, {withFileTypes: true})) {
                const file = path.join(directory, item.name);
                if (item.isSymbolicLink()) continue;
                if (item.isDirectory()) await protect(file);
                else { const mode = (await fs.stat(file)).mode; await fs.chmod(file, mode & 0o100 ? 0o700 : 0o600); }
            }
        };
        await protect(backup);
        await this.mutate(state => {
            state.version = 2;
            state.migration = {from: 1, backup: path.relative(this.directory, backup), at: new Date().toISOString()};
            for (const instance of state.instances) {
                const script = state.scripts.find(s => s.id === instance.scriptId);
                if (script?.engine === 'dr3') continue;
                instance.migrationRequired = true;
                instance.preMigrationEnabled = !!instance.enabled;
                instance.enabled = false;
            }
            for (const key of ['pythonPath', 'phpPath', 'browserPath', 'plugins']) delete state.settings[key];
        });
    }
    async migrateScript(scriptId, name, code) {
        validFilename('dr3', name);
        const original = this.state.scripts.find(s => s.id === scriptId && s.engine !== 'dr3');
        if (!original) throw Object.assign(new Error('未找到待迁移脚本'), {statusCode: 404});
        return this.mutateFiles(async (state, write) => {
            if (!state.instances.some(i => i.scriptId === scriptId)) throw Object.assign(new Error('此脚本没有待迁移实例'), {statusCode: 409});
            const occupied = state.scripts.some(s => s.engine === 'dr3' && s.file === name) || await fs.access(inside(this.runtime, `spider/js_dr3/${name}`)).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; });
            if (occupied) name = `${name.slice(0, -3).slice(0, 160)}-${stableId(scriptId).slice(0, 8)}.js`;
            const next = await this.writeScript(state, write, 'dr3', name, code, {createOnly: true});
            // writeScript creates a new default instance; migration keeps the original identities.
            state.instances = state.instances.filter(i => i.scriptId !== next.id);
            for (const instance of state.instances.filter(i => i.scriptId === scriptId)) {
                instance.scriptId = next.id;
                instance.enabled = instance.preMigrationEnabled ?? false;
                delete instance.migrationRequired;
                delete instance.preMigrationEnabled;
            }
            return next;
        });
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
        const remove = async file => {
            if (files.has(file)) { await fs.rm(file, {recursive: true, force: true}); return; }
            const backup = `${file}.${randomBytes(8).toString('hex')}.rollback`;
            try { await fs.rename(file, backup); files.set(file, {backup}); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        };
        const rollback = async () => {
            const errors = [];
            for (const [file, {backup}] of [...files].reverse()) {
                try { if (backup) await fs.rename(backup, file); else await fs.rm(file, {recursive: true, force: true}); }
                catch (error) { errors.push(error); }
            }
            if (errors.length) {
                rollbackFailed = true;
                throw new AggregateError(errors, '文件回滚失败，已保留 .rollback 备份，请检查数据目录');
            }
        };
        try { return await this.mutate(state => fn(state, write, remove), {rollback}); }
        finally {
            if (!rollbackFailed) for (const {backup} of files.values()) if (backup) await fs.rm(backup, {recursive: true, force: true}).catch(() => {});
        }
    }
    async syncEnvironment() {
        await this.atomic(path.join(this.runtime, 'config/env.json'), JSON.stringify(this.state.settings.env, null, 2), {mode: 0o600});
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
    scriptPath(script) {
        const dir = ENGINE_DIRS[script.engine] || LEGACY_DIRS[script.engine];
        if (!dir || typeof script.file !== 'string' || /[\\/]/.test(script.file) || script.file.includes('..')) throw new Error('脚本路径无效');
        return inside(this.runtime, `spider/${dir}/${script.file}`);
    }
    resolve(id, engine) {
        let instance = this.state.instances.find(s => s.id === id);
        let script = instance && this.state.scripts.find(s => s.id === instance.scriptId);
        if (!instance) {
            script = this.state.scripts.find(s => s.engine === (engine || 'dr3') && s.file === `${id}${EXTENSIONS[s.engine]}`);
            instance = script && this.state.instances.find(s => s.scriptId === script.id && s.enabled);
        }
        if (!script || !instance) throw Object.assign(new Error('源不存在'), {statusCode: 404});
        if (script.engine !== 'dr3' || instance.migrationRequired) throw Object.assign(new Error('此源需要迁移到 drpy3'), {statusCode: 409});
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
        const script = this.registerScript(state, engine, name, code);
        script.updatedAt = new Date().toISOString();
        return script;
    }
    registerScript(state, engine, name, code) {
        const id = stableId(`${engine}:${name}`);
        const info = metadata(code, name.slice(0, -EXTENSIONS[engine].length));
        let script = state.scripts.find(s => s.id === id);
        if (!script) {
            script = {id, engine, file: name, name: info.title, updatedAt: new Date().toISOString()};
            state.scripts.push(script);
        }
        let instance = state.instances.find(item => item.scriptId === id);
        if (!instance) {
            instance = {id, scriptId: id, name: script.name || info.title, params: '', enabled: true, searchable: info.searchable, filterable: info.filterable, navigation: info.navigation};
            state.instances.push(instance);
        } else {
            // navigation is author-declared; refresh it when the script is saved.
            instance.navigation = info.navigation;
        }
        return script;
    }
    async deleteScripts(ids) {
        if (!Array.isArray(ids) || !ids.length || ids.length > 10000 || ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw Object.assign(new Error('删除参数无效'), {statusCode: 400});
        const selected = new Set(ids);
        return this.mutateFiles(async (state, write, remove) => {
            const scripts = state.scripts.filter(script => selected.has(script.id));
            const scriptIds = new Set(scripts.map(script => script.id));
            const instances = state.instances.filter(item => scriptIds.has(item.scriptId));
            const removedIds = new Set(instances.map(item => item.id));
            const remaining = state.instances.filter(item => !removedIds.has(item.id));
            const root = await fs.realpath(this.directory);
            const removeOwned = async file => {
                let parent;
                try { parent = await fs.realpath(path.dirname(file)); }
                catch (error) { if (error.code === 'ENOENT') return; throw error; }
                const relative = path.relative(root, parent);
                if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('拒绝删除数据目录之外的文件');
                await remove(file);
            };
            const envIds = new Set([...removedIds, ...scripts.map(script => script.id).filter(id => !remaining.some(instance => instance.id === id))]);
            for (const id of envIds) {
                await removeOwned(inside(this.runtime, `config/source-env/${id}.json`));
                await removeOwned(inside(this.runtime, `data/drpy3/${createHash('sha256').update(id).digest('hex')}.json`));
            }
            for (const script of scripts) {
                if (script.engine === 'dr3') validFilename(script.engine, script.file);
                await removeOwned(this.scriptPath(script));
                await removeOwned(inside(this.directory, `revisions/${script.id}`));
            }
            state.instances = remaining;
            state.scripts = state.scripts.filter(script => !scriptIds.has(script.id));
            for (const sub of state.subscriptions) sub.instances = sub.instances.filter(id => !removedIds.has(id));
            return {deleted: instances.length, deletedScripts: scripts.length};
        });
    }
    async importBundle(entries) {
        return this.mutateFiles(async (state, write) => {
            const planned = new Map();
            for (const entry of entries) {
                const file = inside(this.runtime, entry.relative);
                let previous;
                try { previous = await fs.readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
                const same = value => Buffer.from(value).equals(Buffer.from(entry.code));
                if ((previous !== undefined && !same(previous)) || (planned.has(file) && !same(planned.get(file).code))) {
                    throw Object.assign(new Error(`源包文件冲突：${entry.relative}，不会覆盖已有文件`), {statusCode: 409});
                }
                planned.set(file, {...entry, exists: previous !== undefined});
            }
            const before = state.instances.length;
            for (const [file, entry] of planned) {
                if (entry.exists) {
                    if (entry.engine) this.registerScript(state, entry.engine, path.basename(file), entry.code);
                    continue;
                }
                if (entry.engine) await this.writeScript(state, write, entry.engine, path.basename(file), entry.code);
                else await write(file, entry.code);
            }
            return {files: entries.length, added: state.instances.length - before};
        });
    }
}
