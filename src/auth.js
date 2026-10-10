import fs from 'fs/promises';
import path from 'path';
import {createHash, randomBytes, scrypt, timingSafeEqual} from 'crypto';
import {promisify} from 'util';

const hash = text => createHash('sha256').update(text).digest();
// 异步 scrypt：KDF 成本落在 libuv 线程池，未鉴权请求无法再阻塞主事件循环。
const deriveAsync = promisify(scrypt);
const derive = (password, salt) => deriveAsync(String(password ?? ''), salt, 64, {N: 16384, r: 8, p: 1});
export async function createAuth(store) {
    const file = path.join(store.directory, 'admin.json');
    let credentials;
    try { credentials = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (process.env.ADMIN_PASSWORD && (!credentials || credentials.requiresSetup === true)) {
        // 环境变量路径同样只保留 KDF 结果（内存态，不落盘明文）。
        const salt = randomBytes(16).toString('base64');
        credentials = {version: 2, salt, hash: (await derive(process.env.ADMIN_PASSWORD, salt)).toString('base64'), requiresSetup: false, fromEnv: true};
    }
    if (!credentials) {
        credentials = {requiresSetup: true};
        await fs.writeFile(file, JSON.stringify(credentials, null, 2), {mode: 0o600});
    }
    // v2：{version:2, salt, hash}；旧格式：{password:<明文>}，登录成功后无痛迁移。
    let expected = null, salt = null, legacy = false;
    if (credentials.requiresSetup !== true) {
        if (credentials.version === 2 && typeof credentials.salt === 'string' && typeof credentials.hash === 'string') {
            salt = credentials.salt;
            expected = Buffer.from(credentials.hash, 'base64');
        } else if (typeof credentials.password === 'string' && credentials.password) {
            legacy = true;
            expected = hash(credentials.password);
        } else throw new Error('访问密码配置无效');
    }
    // 兼容升级：只清理旧版遗留的初始化码，其他运行数据保持原样。
    await fs.rm(path.join(store.directory, 'setup-code.txt'), {force: true});
    let settingUp = false, migrating = false;
    // 不做启动期一次性迁移：密码不对时会把用户锁在外面。改为“登录成功后”原子重写。
    const migrate = async () => {
        if (migrating) return;
        migrating = true;
        try {
            const newSalt = randomBytes(16).toString('base64');
            const digest = await derive(credentials.password, newSalt);
            const saved = {version: 2, salt: newSalt, hash: digest.toString('base64'), requiresSetup: false};
            await store.atomic(file, JSON.stringify(saved, null, 2), {mode: 0o600});
            await fs.chmod(file, 0o600);
            credentials = saved; expected = digest; salt = newSalt; legacy = false;
        } finally { migrating = false; }
    };
    const matchesPassword = async request => {
        if (!expected) return false;
        const auth = request.headers?.authorization || '';
        if (!auth.startsWith('Basic ')) return false;
        const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator < 0) return false;
        // Basic 的用户名位置不参与鉴权；兼容此前保存的访问凭据。
        const password = decoded.slice(separator + 1);
        const received = salt ? await derive(password, salt) : hash(password);
        if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;
        if (legacy) void migrate().catch(() => {});
        return true;
    };
    const needsSetup = () => credentials.requiresSetup === true;
    const isAdmin = async request => !needsSetup() && await matchesPassword(request);
    const setup = async (request) => {
        if (!needsSetup() || settingUp) throw Object.assign(new Error('密码已创建，请使用新密码进入'), {statusCode: 409});
        const {password, confirmPassword} = request.body || {};
        if (typeof password !== 'string' || password.length < 6 || password.length > 200 || !password.trim()) throw Object.assign(new Error('密码需要 6 到 200 个字符'), {statusCode: 400});
        if (password !== confirmPassword) throw Object.assign(new Error('两次输入的密码不一致'), {statusCode: 400});
        settingUp = true;
        try {
            salt = randomBytes(16).toString('base64');
            const digest = await derive(password, salt);
            const saved = {version: 2, salt, hash: digest.toString('base64'), requiresSetup: false};
            await store.atomic(file, JSON.stringify(saved, null, 2), {mode: 0o600});
            await fs.chmod(file, 0o600);
            credentials = saved; expected = digest; legacy = false;
            return {ok: true};
        } finally { settingUp = false; }
    };
    return {
        isAdmin, file, setup, needsSetup,
        guard: async (request, reply) => {
            if (needsSetup()) return reply.code(428).send({error: '请先创建访问密码', code: 'ACCESS_SETUP_REQUIRED'});
            if (!await matchesPassword(request)) return reply.code(401).send({error: '访问密码不正确'});
        },
    };
}
