import fs from 'fs/promises';
import path from 'path';
import {createHash, timingSafeEqual} from 'crypto';
import {token} from './store.js';

const hash = text => createHash('sha256').update(text).digest();
export async function createAuth(store) {
    const file = path.join(store.directory, 'admin.json');
    let credentials;
    if (process.env.ADMIN_PASSWORD) credentials = {username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASSWORD};
    else {
        try { credentials = JSON.parse(await fs.readFile(file, 'utf8')); }
        catch (error) {
            if (error.code !== 'ENOENT') throw error;
            credentials = {username: 'admin', password: token()};
            await fs.writeFile(file, JSON.stringify(credentials, null, 2), {mode: 0o600});
        }
    }
    const expected = hash(`${credentials.username}:${credentials.password}`);
    const isAdmin = request => {
        const auth = request.headers.authorization || '';
        if (!auth.startsWith('Basic ')) return false;
        const received = hash(Buffer.from(auth.slice(6), 'base64').toString('utf8'));
        return timingSafeEqual(expected, received);
    };
    return {isAdmin, file, guard: async (request, reply) => {
        if (!isAdmin(request)) return reply.code(401).send({error: '请登录管理页面'});
    }};
}

