import fs from 'fs/promises';
import path from 'path';
import {createHash, timingSafeEqual} from 'crypto';
import {token} from './store.js';

const hash = text => createHash('sha256').update(text).digest();
export async function createAuth(store) {
    const file = path.join(store.directory, 'admin.json');
    let credentials;
    if (process.env.ADMIN_PASSWORD) credentials = {password: process.env.ADMIN_PASSWORD};
    else {
        try { credentials = JSON.parse(await fs.readFile(file, 'utf8')); }
        catch (error) {
            if (error.code !== 'ENOENT') throw error;
            credentials = {password: token()};
            await fs.writeFile(file, JSON.stringify(credentials, null, 2), {mode: 0o600});
        }
    }
    if (typeof credentials.password !== 'string' || !credentials.password) throw new Error('访问密码配置无效');
    const expected = hash(credentials.password);
    const isAdmin = request => {
        const auth = request.headers.authorization || '';
        if (!auth.startsWith('Basic ')) return false;
        const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator < 0) return false;
        // Basic 的用户名位置不参与鉴权；兼容此前保存的访问凭据。
        const received = hash(decoded.slice(separator + 1));
        return timingSafeEqual(expected, received);
    };
    return {isAdmin, file, guard: async (request, reply) => {
        if (!isAdmin(request)) return reply.code(401).send({error: '访问密码不正确'});
    }};
}
