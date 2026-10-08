import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {validateHeaderValue} from 'node:http';

const fail = message => new Error(message);
export function validate115Cookie(cookie) {
    if (typeof cookie !== 'string' || !cookie || cookie.length > 16384) throw fail('115 登录凭据无效');
    validateHeaderValue('Cookie', cookie);
    const pairs = new Map(cookie.split(';').map(part => {
        const index = part.indexOf('='); return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }));
    if (['UID', 'CID', 'SEID'].some(key => !pairs.get(key))) throw fail('115 登录凭据不完整');
    return cookie;
}

// Separate from source ENV: refreshing a shared account must not fork its
// credentials into each source. This is private storage, not a source sandbox.
export class NetdiskAccountStore {
    constructor(directory) { this.directory = path.join(directory, 'netdisk'); this.file = path.join(this.directory, '115.json'); this.account = null; this.pending = Promise.resolve(); }
    async init() {
        await fs.mkdir(this.directory, {recursive: true, mode: 0o700});
        if ((await fs.lstat(this.directory)).isSymbolicLink()) throw fail('网盘凭据目录不能是符号链接');
        await fs.chmod(this.directory, 0o700);
        try {
            const stat = await fs.lstat(this.file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) throw fail('网盘凭据文件无效');
            const value = JSON.parse(await fs.readFile(this.file, 'utf8'));
            if (value.version !== 1 || typeof value.revision !== 'string' || typeof value.device !== 'string' || !Number.isFinite(value.savedAt)) throw fail('网盘凭据文件格式无效');
            validate115Cookie(value.cookie); this.account = value;
            await fs.chmod(this.file, 0o600);
        } catch (error) { if (error.code !== 'ENOENT') throw new Error('网盘凭据文件损坏或不可读，已保留原文件'); }
        return this;
    }
    status() { return this.account ? {provider: '115', connected: true, revision: this.account.revision, device: this.account.device, savedAt: this.account.savedAt} : {provider: '115', connected: false}; }
    cookie() { return this.account?.cookie || ''; }
    async save115(cookie, device) {
        validate115Cookie(cookie);
        const work = this.pending.then(async () => {
            const value = {version: 1, revision: randomBytes(16).toString('hex'), device, savedAt: Date.now(), cookie};
            const temporary = this.file + '.' + randomBytes(8).toString('hex') + '.tmp';
            try {
                await fs.writeFile(temporary, JSON.stringify(value, null, 2), {mode: 0o600, flag: 'wx'});
                await fs.rename(temporary, this.file);
                await fs.chmod(this.file, 0o600);
                this.account = value;
            } finally { await fs.rm(temporary, {force: true}); }
            return this.status();
        });
        this.pending = work.catch(() => {}); return work;
    }
}
