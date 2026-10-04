import fs from 'fs/promises';
import path from 'path';
import {createHash, timingSafeEqual} from 'crypto';

const hash = text => createHash('sha256').update(text).digest();
export async function createAuth(store) {
    const file = path.join(store.directory, 'admin.json');
    let credentials;
    try { credentials = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (process.env.ADMIN_PASSWORD && !(process.env.ADMIN_PASSWORD === '111111' && credentials?.requiresSetup === false)) {
        credentials = {password: process.env.ADMIN_PASSWORD, requiresSetup: process.env.ADMIN_PASSWORD === '111111'};
    }
    if (!credentials) {
        credentials = {password: '111111', requiresSetup: true};
        await fs.writeFile(file, JSON.stringify(credentials, null, 2), {mode: 0o600});
    }
    if (typeof credentials.password !== 'string' || !credentials.password) throw new Error('访问密码配置无效');
    let expected = hash(credentials.password), settingUp = false;
    const matchesPassword = request => {
        const auth = request.headers.authorization || '';
        if (!auth.startsWith('Basic ')) return false;
        const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator < 0) return false;
        // Basic 的用户名位置不参与鉴权；兼容此前保存的访问凭据。
        const received = hash(decoded.slice(separator + 1));
        return timingSafeEqual(expected, received);
    };
    const needsSetup = () => credentials.requiresSetup === true;
    const isAdmin = request => !needsSetup() && matchesPassword(request);
    const setup = async (request) => {
        if (!needsSetup() || settingUp) throw Object.assign(new Error('密码已创建，请使用新密码进入'), {statusCode: 409});
        if (!matchesPassword(request)) throw Object.assign(new Error('初始密码不正确'), {statusCode: 401});
        const {password, confirmPassword} = request.body || {};
        if (typeof password !== 'string' || password.length < 6 || password.length > 200 || !password.trim()) throw Object.assign(new Error('密码需要 6 到 200 个字符'), {statusCode: 400});
        if (password !== confirmPassword) throw Object.assign(new Error('两次输入的密码不一致'), {statusCode: 400});
        if (password === credentials.password) throw Object.assign(new Error('请设置不同于初始密码的新密码'), {statusCode: 400});
        settingUp = true;
        try {
            const saved = {password, requiresSetup: false};
            await store.atomic(file, JSON.stringify(saved, null, 2));
            await fs.chmod(file, 0o600);
            credentials = saved; expected = hash(password);
            return {ok: true};
        } finally { settingUp = false; }
    };
    return {isAdmin, file, setup, needsSetup, guard: async (request, reply) => {
        if (needsSetup()) return reply.code(428).send({error: '请先创建访问密码', code: 'ACCESS_SETUP_REQUIRED'});
        if (!matchesPassword(request)) return reply.code(401).send({error: '访问密码不正确'});
    }};
}
