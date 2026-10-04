import fs from 'fs/promises';
import path from 'path';
import {randomBytes, createHash} from 'crypto';
import {ROOT, ENGINE_DIRS, EXTENSIONS, inside, validFilename} from './paths.js';

export const token = () => randomBytes(24).toString('base64url');
const stableId = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
export const metadata = (code, name) => {
    const title = code.match(/(?:title|标题)\s*:\s*['"]([^'"\n]+)['"]/)?.[1] || name;
    return {title, searchable: !/searchable\s*:\s*0/.test(code), filterable: /filterable\s*:\s*(?:1|true)/.test(code)};
};
const defaults = () => ({version: 1, scripts: [], instances: [], subscriptions: [], settings: {
    publicUrl: '', timeout: 30000, pythonPath: process.env.PYTHON_PATH || 'python3', phpPath: process.env.PHP_PATH || 'php', browserPath: process.env.CHROME_PATH || '',
    env: {}, plugins: [], parses: [], lives: [],
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
    async atomic(file, content) {
        await fs.mkdir(path.dirname(file), {recursive: true});
        const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
        try { await fs.writeFile(temporary, content); await fs.rename(temporary, file); }
        finally { await fs.rm(temporary, {force: true}); }
    }
    async persist() { await this.atomic(this.stateFile, JSON.stringify(this.state, null, 2)); }
    async mutate(fn) {
        const job = this.tail.then(async () => {
            const before = structuredClone(this.state);
            try { const value = await fn(this.state); await this.persist(); return value; }
            catch (error) { this.state = before; throw error; }
        });
        this.tail = job.catch(() => {});
        return job;
    }
    async syncEnvironment() {
        await this.atomic(path.join(this.runtime, 'config/env.json'), JSON.stringify(this.state.settings.env, null, 2));
        await this.atomic(path.join(this.runtime, '.plugins.js'), `export default ${JSON.stringify(this.state.settings.plugins)};\n`);
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
        const id = stableId(`${engine}:${name}`);
        const file = inside(this.runtime, `spider/${ENGINE_DIRS[engine]}/${name}`);
        return this.mutate(async state => {
            let previous = null;
            try { previous = await fs.readFile(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            if (createOnly && (previous !== null || state.scripts.some(script => script.id === id))) throw Object.assign(new Error('同类型的脚本名已存在，请换一个名称'), {statusCode: 409});
            if (previous !== null) await this.atomic(path.join(this.directory, 'revisions', id, `${Date.now()}-${randomBytes(3).toString('hex')}.txt`), previous);
            await this.atomic(file, code);
            let script = state.scripts.find(s => s.id === id);
            if (!script) {
                const info = metadata(code, name.slice(0, -EXTENSIONS[engine].length));
                script = {id, engine, file: name, name: info.title};
                state.scripts.push(script);
                state.instances.push({id, scriptId: id, name: info.title, params: '', enabled: true, searchable: info.searchable, filterable: info.filterable});
            }
            script.updatedAt = new Date().toISOString();
            return script;
        });
    }
}
