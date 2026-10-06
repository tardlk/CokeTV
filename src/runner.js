import {fork, execFile} from 'child_process';
import net from 'net';
import {EventEmitter} from 'events';
import {fileURLToPath} from 'url';
import path from 'path';
import {randomBytes} from 'crypto';

async function freePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}
export class Runner extends EventEmitter {
    constructor(store) {
        super(); this.store = store; this.child = null; this.current = null;
        this.queue = Promise.resolve(); this.sequence = 0; this.waiting = 0;
        this.logs = []; this.stats = null; this.wsPort = null; this.closed = false;
        this.internalKey = randomBytes(24).toString('hex'); this.gatewayPort = null; this.gatewayPending = null;
    }
    log(entry) {
        this.logs.push({time: new Date().toISOString(), ...entry, message: String(entry.message || '').slice(0, 8192)});
        if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400);
    }
    async start() {
        if (this.starting) return this.starting;
        const promise = this.startInternal();
        this.starting = promise;
        try { await promise; } finally { if (this.starting === promise) this.starting = null; }
    }
    async startInternal() {
        if (this.child) return;
        const settings = this.store.state.settings;
        const port = await freePort();
        const child = fork(fileURLToPath(new URL('./worker.js', import.meta.url)), [], {
            cwd: this.store.runtime, detached: process.platform !== 'win32', serialization: 'advanced',
            env: {...process.env, ROOT: this.store.runtime, PYTHON_PATH: settings.pythonPath,
                PHP_PATH: settings.phpPath, CHROME_PATH: settings.browserPath,
                DRPY_INTERNAL_KEY: this.internalKey, DRPY_PLUGINS: settings.plugins.some(p => p.active) ? '1' : '0', DRPY_PY_PORT: String(port), BRIDGE_TIMEOUT: String(Math.max(60000, settings.timeout))},
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        this.child = child;
        for (const output of [child.stdout, child.stderr]) output.on('data', data => this.log({level: 'info', source: this.current?.source, message: data.toString().trim()}));
        child.on('message', message => {
            if (this.child !== child) return;
            if (message.kind === 'log') this.log({...message, source: message.source || this.current?.source});
            if (message.kind === 'stats') this.stats = message;
            if (message.kind === 'ws') this.wsPort = message.port;
            if (message.kind === 'gatewayReady' && this.gatewayPending) {
                const pending = this.gatewayPending; this.gatewayPending = null;
                if (message.error) pending.reject(new Error(message.error));
                else { this.gatewayPort = message.port; pending.resolve(message.port); }
            }
            if (message.kind === 'result' && this.current?.id === message.id) {
                const pending = this.current; this.current = null; clearTimeout(pending.timer);
                if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
            }
        });
        child.on('exit', (code, signal) => {
            if (this.child !== child) return;
            this.reset(`运行进程退出 (${signal || code})`);
        });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { cleanup(); this.reset('运行进程启动超时'); reject(new Error('运行进程启动超时')); }, 10000);
            const onMessage = message => { if (message.kind === 'ready') { cleanup(); resolve(); } };
            const onError = error => { cleanup(); reject(error); };
            const onExit = () => { cleanup(); reject(new Error('运行进程启动失败')); };
            const cleanup = () => { clearTimeout(timeout); child.off('message', onMessage); child.off('error', onError); child.off('exit', onExit); };
            child.on('message', onMessage); child.once('error', onError); child.once('exit', onExit);
        });
    }
    killTree(child) {
        if (!child?.pid) return;
        if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
        else { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    }
    reset(reason = '运行配置已更新') {
        const child = this.child;
        this.child = null; this.wsPort = null; this.stats = null; this.gatewayPort = null;
        if (this.gatewayPending) { this.gatewayPending.reject(new Error(reason)); this.gatewayPending = null; }
        if (this.current) { clearTimeout(this.current.timer); this.current.reject(new Error(reason)); this.current = null; }
        this.killTree(child);
    }
    run(source, query, env, operation = 'api') {
        if (this.closed) return Promise.reject(new Error('服务正在关闭'));
        if (this.waiting >= 64) return Promise.reject(Object.assign(new Error('源请求队列已满，请稍后重试'), {statusCode: 503}));
        this.waiting++;
        const work = this.queue.then(async () => {
            if (this.closed) throw new Error('服务正在关闭');
            await this.start();
            return new Promise((resolve, reject) => {
                const id = ++this.sequence;
                const timeout = operation === 'api' && query.ac === 'action' ? Math.max(60000, this.store.state.settings.timeout) : this.store.state.settings.timeout;
                const timer = setTimeout(() => this.reset(`源执行超过 ${timeout / 1000} 秒，已回收运行进程`), timeout);
                this.current = {id, source: source.instanceId, resolve, reject, timer};
                this.child.send({kind: 'run', id, source, query, env, operation}, error => {
                    if (error) this.reset(error.message);
                });
            });
        }).finally(() => { this.waiting--; });
        this.queue = work.catch(() => {});
        return work;
    }
    close() { this.closed = true; this.reset('服务正在关闭'); }
    async gateway() {
        if (this.gatewayPort) return this.gatewayPort;
        if (this.gatewayPending) return this.gatewayPending.promise;
        await this.start();
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        this.gatewayPending = {promise, resolve, reject};
        this.child.send({kind: 'gateway'});
        return promise;
    }
    status() { return {started: !!this.child, pid: this.child?.pid || null, waiting: this.waiting, ...this.stats}; }
}
