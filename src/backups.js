import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import AdmZip from 'adm-zip';
import {logStamp} from './logging.js';

// Everything needed to rebuild a running installation: state, credentials,
// script files and their history, per-source ENV and persistent source KV.
// Runtime libraries are re-created from engine/ on every start and are skipped
// so a snapshot stays small; the node_modules symlink must never be followed.
const SNAPSHOT_ROOTS = ['state.json', 'admin.json', 'revisions', 'netdisk', 'runtime/spider', 'runtime/config', 'runtime/data', 'runtime/json', 'runtime/jx'];
const SNAPSHOT_NAME = /^coketv-\d{8}-\d{6}-[a-f0-9]{6}\.zip$/;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});

export class Backups {
    constructor(directory, {keep = 7, intervalMs = 24 * 3600000, maxTotalBytes = MAX_TOTAL_BYTES, now = Date.now, onLog, extraFiles} = {}) {
        if (!directory) throw new TypeError('备份目录不能为空');
        this.root = path.resolve(directory);
        this.directory = path.join(this.root, 'backups');
        this.keep = Number.isSafeInteger(keep) && keep > 0 ? keep : 7;
        this.intervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 24 * 3600000;
        this.maxTotalBytes = maxTotalBytes;
        this.now = now;
        this.onLog = onLog || (() => {});
        this.extraFiles = typeof extraFiles === 'function' ? extraFiles : null;
        this.pending = null;
        this.timers = [];
    }

    async start() {
        await fs.mkdir(this.directory, {recursive: true, mode: 0o700});
        await fs.chmod(this.directory, 0o700).catch(() => {});
        // First check happens after startup so the HTTP port opens immediately;
        // hourly checks make a laptop/NAS that was asleep catch up quickly.
        const first = setTimeout(() => { void this.checkDue(); }, 60000);
        const repeat = setInterval(() => { void this.checkDue(); }, Math.min(3600000, this.intervalMs));
        first.unref?.();
        repeat.unref?.();
        this.timers.push(first, repeat);
        return this;
    }

    // SQLite cannot be captured by a plain file copy while it is open, so
    // Emby's database is produced by a consistent VACUUM INTO in the app layer
    // and added through this callback.
    setExtraFiles(callback) { this.extraFiles = typeof callback === 'function' ? callback : null; }

    close() {
        for (const timer of this.timers) clearTimeout(timer);
        this.timers = [];
    }

    async list() {
        const entries = await fs.readdir(this.directory).catch(error => {
            if (error.code === 'ENOENT') return [];
            throw error;
        });
        const items = [];
        for (const name of entries) {
            if (!SNAPSHOT_NAME.test(name)) continue;
            try {
                const stat = await fs.stat(path.join(this.directory, name));
                if (!stat.isFile()) continue;
                items.push({name, size: stat.size, time: stat.mtime.toISOString()});
            } catch {}
        }
        return items.sort((a, b) => b.name.localeCompare(a.name));
    }

    async status() {
        const items = await this.list();
        return {items, keep: this.keep, intervalHours: Math.round(this.intervalMs / 3600000), last: items[0] || null};
    }

    async checkDue() {
        try {
            const items = await this.list();
            if (!items.length || this.now() - Date.parse(items[0].time) >= this.intervalMs) await this.create('auto');
        } catch (error) {
            this.onLog({level: 'error', source: 'backup', message: `自动快照失败：${error.message}`});
        }
    }

    create() {
        if (this.pending) return this.pending;
        this.pending = this.#create().finally(() => { this.pending = null; });
        return this.pending;
    }

    async #create() {
        const name = `coketv-${logStamp(this.now())}-${randomBytes(3).toString('hex')}.zip`;
        const target = path.join(this.directory, name);
        const temporary = `${target}.${randomBytes(4).toString('hex')}.tmp`;
        const zip = new AdmZip();
        let total = 0;
        const add = async relative => {
            const file = path.join(this.root, relative);
            let stat;
            try { stat = await fs.lstat(file); }
            catch (error) { if (error.code === 'ENOENT') return; throw error; }
            if (stat.isSymbolicLink()) return;
            if (stat.isDirectory()) {
                for (const entry of await fs.readdir(file)) await add(path.join(relative, entry));
                return;
            }
            if (!stat.isFile()) return;
            total += stat.size;
            if (total > this.maxTotalBytes) throw fail('数据目录过大，未创建快照', 507);
            zip.addFile(relative.split(path.sep).join('/'), await fs.readFile(file));
        };
        try {
            await fs.mkdir(this.directory, {recursive: true, mode: 0o700});
            for (const root of SNAPSHOT_ROOTS) await add(root);
            for (const item of await this.extraFiles?.() || []) {
                if (!item || typeof item.name !== 'string' || !Buffer.isBuffer(item.bytes)) continue;
                total += item.bytes.length;
                if (total > this.maxTotalBytes) throw fail('数据目录过大，未创建快照', 507);
                zip.addFile(item.name, item.bytes);
            }
            const bytes = zip.toBuffer();
            await fs.writeFile(temporary, bytes, {mode: 0o600});
            await fs.rename(temporary, target);
            await this.#prune();
            const stat = await fs.stat(target);
            const item = {name, size: stat.size, time: stat.mtime.toISOString()};
            this.onLog({level: 'info', source: 'backup', message: `已创建数据快照 ${name}（${Math.round(stat.size / 1024)} KB）`});
            return item;
        } catch (error) {
            await fs.rm(temporary, {force: true}).catch(() => {});
            this.onLog({level: 'error', source: 'backup', message: `创建数据快照失败：${error.message}`});
            throw error;
        }
    }

    async #prune() {
        const items = await this.list();
        for (const item of items.slice(this.keep)) await fs.rm(path.join(this.directory, item.name), {force: true});
    }

    locate(name) {
        if (typeof name !== 'string' || !SNAPSHOT_NAME.test(name)) throw fail('快照名称无效', 400);
        return path.join(this.directory, name);
    }
}
