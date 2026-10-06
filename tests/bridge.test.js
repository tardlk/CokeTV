import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT} from '../src/paths.js';
import {createApp} from '../src/server.js';

const exec = promisify(execFile);
const PHP = process.env.TEST_PHP || 'php';
const PYTHON = process.env.TEST_PYTHON || 'python3';
const BRIDGE = path.join(ROOT, 'engine/spider/php/_bridge.php');

const runPhp = async (file, method, env = {}, args = []) => {
    const {stdout} = await exec(PHP, [BRIDGE, file, method, JSON.stringify(env), ...args.map(arg => JSON.stringify(arg))], {encoding: 'utf8', timeout: 20000});
    return JSON.parse(String(stdout).trim());
};
// 桥接把错误以 JSON 写到 stdout 并 exit(1)；execFile 会 reject，错误原文在 error.stdout 里。
const runPhpError = async (file, method, env = {}, args = []) => {
    try { return {threw: false, data: await runPhp(file, method, env, args)}; }
    catch (error) {
        try { return {threw: true, data: JSON.parse(String(error.stdout || '').trim())}; }
        catch { return {threw: true, data: {error: String(error.stdout || error.message)}}; }
    }
};
const freePort = () => new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => { const {port} = server.address(); server.close(() => resolve(port)); });
});
const waitFor = async (fn, timeout = 5000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
    return null;
};

test('M9 继承 BaseSpider 且产生 Warning 的 PHP 源仍只输出合法 JSON', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-bridge-php-'));
    try {
        const file = path.join(dir, 'warn.php');
        await fs.writeFile(file, `<?php
require_once ${JSON.stringify(path.join(ROOT, 'engine/spider/php/lib/spider.php'))};
class Spider extends BaseSpider {
    public function init($extend = '') { return true; }
    public function homeContent($filter = 1) {
        trigger_error('boom warning', E_USER_WARNING);
        return ['class' => [['type_id' => 'movie', 'type_name' => '电影']]];
    }
}
`);
        const result = await runPhp(file, 'homeContent');
        assert.deepEqual(result.class[0], {type_id: 'movie', type_name: '电影'});
    } finally { await fs.rm(dir, {recursive: true, force: true}); }
});
test('M9/P0 代理方法解析选「最派生」实现：proxy-only 老源不被继承的 localProxy 抢先', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-bridge-proxy-'));
    try {
        // 只实现 proxy() 的老源（BaseSpider 声明的 localProxy 默认返回 404）——曾回归为 404。
        const legacy = path.join(dir, 'legacy.php');
        await fs.writeFile(legacy, `<?php
require_once ${JSON.stringify(path.join(ROOT, 'engine/spider/php/lib/spider.php'))};
class Spider extends BaseSpider {
    public function init($extend = '') { return true; }
    public function proxy($params = []) { return [200, 'text/plain', 'legacy-proxy-ok']; }
}
`);
        assert.deepEqual(await runPhp(legacy, 'localProxy|proxy', {}, [{}]), [200, 'text/plain', 'legacy-proxy-ok']);
        assert.deepEqual(await runPhp(legacy, 'proxy', {}, [{}]), [200, 'text/plain', 'legacy-proxy-ok']);

        // 不继承 BaseSpider、只实现 localProxy() 的源，直接命中自身实现。
        const standalone = path.join(dir, 'standalone.php');
        await fs.writeFile(standalone, `<?php
class Spider {
    public function localProxy($params = []) { return [200, 'text/plain', 'local-proxy-ok']; }
}
`);
        assert.deepEqual(await runPhp(standalone, 'localProxy|proxy', {}, [{}]), [200, 'text/plain', 'local-proxy-ok']);

        // 继承 BaseSpider 且实现 localProxy() 的源：优先 localProxy。
        const base = path.join(dir, 'base.php');
        await fs.writeFile(base, `<?php
require_once ${JSON.stringify(path.join(ROOT, 'engine/spider/php/lib/spider.php'))};
class Spider extends BaseSpider {
    public function init($extend = '') { return true; }
    public function localProxy($params = []) { return [200, 'text/plain', 'base-local-proxy']; }
}
`);
        assert.deepEqual(await runPhp(base, 'localProxy|proxy', {}, [{}]), [200, 'text/plain', 'base-local-proxy']);
        // BaseSpider::proxy() 别名回退到 localProxy()。
        assert.deepEqual(await runPhp(base, 'proxy', {}, [{}]), [200, 'text/plain', 'base-local-proxy']);

        // 继承 BaseSpider、两个都不实现：真实行为是回退到基类的 localProxy()（默认 404），
        // 而不是报错。带参数调用才能观察到真实行为（旧断言依赖 ArgumentCountError，前提不成立）。
        const empty = path.join(dir, 'empty.php');
        await fs.writeFile(empty, `<?php
require_once ${JSON.stringify(path.join(ROOT, 'engine/spider/php/lib/spider.php'))};
class Spider extends BaseSpider { public function init($extend = '') { return true; } }
`);
        assert.deepEqual(await runPhp(empty, 'localProxy|proxy', {}, [{}]), [404, 'text/plain', 'not found']);

        // 不继承 BaseSpider 且两个都不实现：明确报方法缺失（错误经 stdout JSON 返回）。
        const bare = path.join(dir, 'bare.php');
        await fs.writeFile(bare, `<?php
class Spider { public function init($extend = '') { return true; } }
`);
        const bareResult = await runPhpError(bare, 'localProxy|proxy', {}, [{}]);
        assert.equal(bareResult.threw, true);
        assert.match(String(bareResult.data.error), /not found in Spider class/);
    } finally { await fs.rm(dir, {recursive: true, force: true}); }
});
test('M10 Python 守护进程被杀后下一次调用会自动重启', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-py-restart-'));
    let app;
    try {
        app = await createApp({directory, seed: false});
        const setupCode = (await fs.readFile(path.join(directory, 'setup-code.txt'), 'utf8')).trim();
        await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'bridge-password', confirmPassword: 'bridge-password', setupCode}});
        app.store.state.settings.pythonPath = PYTHON;
        const code = await fs.readFile(path.join(ROOT, 'tests/fixtures/协议样本.py'), 'utf8');
        const script = await app.store.saveScript('py', '重启样本.py', code);
        const first = await app.inject(`/watch/sources/${script.id}`);
        assert.equal(first.statusCode, 200, first.body);
        assert.equal(first.json().list[0].vod_name, '样本电影');
        const pid = await waitFor(() => app.runner.stats?.pythonPid, 5000);
        assert.ok(pid, '未拿到 Python 守护进程 pid');
        process.kill(pid, 'SIGKILL');
        await new Promise(resolve => setTimeout(resolve, 300));
        const second = await app.inject(`/watch/sources/${script.id}`);
        assert.equal(second.statusCode, 200, second.body);
        assert.equal(second.json().list[0].vod_name, '样本电影');
    } finally { await app?.close(); await fs.rm(directory, {recursive: true, force: true}); }
});
test('M10 t4_daemon 收到 SIGTERM 后 5s 内优雅退出（不再死锁）', async () => {
    const port = await freePort();
    const child = spawn(PYTHON, [path.join(ROOT, 'engine/spider/py/core/t4_daemon.py')], {
        cwd: path.join(ROOT, 'engine/spider/py'),
        env: {...process.env, DRPY_PY_PORT: String(port), T4_LOG_LEVEL: 'ERROR'},
        stdio: 'ignore',
    });
    try {
        const connectable = () => new Promise(resolve => {
            const socket = net.connect(port, '127.0.0.1');
            socket.once('connect', () => { socket.destroy(); resolve(true); });
            socket.once('error', () => resolve(false));
            socket.setTimeout(300, () => { socket.destroy(); resolve(false); });
        });
        let up = false;
        const end = Date.now() + 10000;
        while (Date.now() < end && !up) { up = await connectable(); if (!up) await new Promise(resolve => setTimeout(resolve, 100)); }
        assert.ok(up, '守护进程未在 10s 内就绪');
        const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})));
        child.kill('SIGTERM');
        const result = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(null), 5000))]);
        assert.ok(result, 'SIGTERM 后 5s 内未退出（疑似 shutdown 死锁）');
    } finally { try { child.kill('SIGKILL'); } catch {} }
});
