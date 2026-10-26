import {fork, execFile} from 'child_process';
import {readFileSync} from 'fs';
import {EventEmitter} from 'events';
import {fileURLToPath} from 'url';
import path from 'path';
import {randomBytes} from 'crypto';
import {sourceOperation} from './source-operation.js';
import {SOURCE_TIMEOUT} from './runtime-defaults.js';
import {redactLogMessage} from './logging.js';

const MAX_WORKERS = 4;
const workerCount = value => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 ? Math.min(MAX_WORKERS, Math.floor(number)) : 2;
};

// A small pool keeps a slow source from monopolizing every request while
// preserving per-source serialization: one source is always pinned to one
// worker, and each worker runs one source operation at a time. Worker 0 also
// owns the legacy gateway and WebSocket ports, so existing client paths keep
// working; sources that use fServer/ws are pinned there.
export class Runner extends EventEmitter {
    constructor(store, {sink, workers} = {}) {
        super(); this.store = store; this.sink = sink || null;
        this.workerCount = workerCount(workers ?? process.env.SOURCE_WORKERS);
        this.workers = Array.from({length: this.workerCount}, (_, index) => this.createWorker(index));
        this.primary = this.workers[0];
        this.assignments = new Map();
        this.wsSources = new Map();
        this.cursor = 0;
        this.sequence = 0; this.waiting = 0; this.logs = []; this.closed = false;
        this.internalKey = randomBytes(24).toString('hex');
    }

    createWorker(index) {
        return {index, child: null, current: null, queue: Promise.resolve(), starting: null,
            stats: null, wsPort: null, gatewayPort: null, gatewayPending: null, pending: 0};
    }

    // Compatibility accessors for the existing gateway/WS code and tests.
    get child() { return this.primary.child; }
    set child(value) { this.primary.child = value; }
    get starting() { return this.primary.starting; }
    set starting(value) { this.primary.starting = value; }
    get stats() { return this.primary.stats; }
    set stats(value) { this.primary.stats = value; }
    get wsPort() { return this.primary.wsPort; }
    set wsPort(value) { this.primary.wsPort = value; }
    get gatewayPort() { return this.primary.gatewayPort; }
    set gatewayPort(value) { this.primary.gatewayPort = value; }
    get gatewayPending() { return this.primary.gatewayPending; }
    set gatewayPending(value) { this.primary.gatewayPending = value; }

    log(entry) {
        const record = {time: new Date().toISOString(), level: 'info', ...entry, message: redactLogMessage(entry.message || '')};
        this.logs.push(record);
        if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400);
        this.sink?.write(record);
    }

    async start() { return this.startWorker(this.primary); }

    async startWorker(worker) {
        if (worker.child) return;
        if (worker.starting) return worker.starting;
        const promise = this.startInternal(worker);
        worker.starting = promise;
        try { await promise; }
        finally { if (worker.starting === promise) worker.starting = null; }
    }

    async startInternal(worker) {
        const child = fork(fileURLToPath(new URL('./worker.js', import.meta.url)), [], {
            cwd: this.store.runtime, detached: process.platform !== 'win32', serialization: 'advanced',
            env: {...process.env, ROOT: this.store.runtime, DRPY_INTERNAL_KEY: this.internalKey},
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        worker.child = child;
        for (const output of [child.stdout, child.stderr]) output.on('data', data => this.log({level: 'info', source: worker.current?.source, message: data.toString().trim()}));
        child.on('error', error => { if (worker.child === child) this.resetWorker(worker, error.message); });
        child.on('message', message => {
            if (worker.child !== child) return;
            if (message.kind === 'log') this.log({...message, source: message.source || worker.current?.source});
            if (message.kind === 'stats') worker.stats = message;
            if (message.kind === 'phase' && worker.current?.id === message.id &&
                worker.current.method === 'home' && message.method === 'homeVod' && !worker.current.recommendationPhase) {
                // Home and homeVod each receive the default timeout.
                const pending = worker.current;
                pending.recommendationPhase = true;
                clearTimeout(pending.timer); pending.timer = pending.armTimer();
            }
            if (message.kind === 'ws') worker.wsPort = message.port;
            if (message.kind === 'gatewayReady' && worker.gatewayPending) {
                const pending = worker.gatewayPending; worker.gatewayPending = null;
                clearTimeout(pending.timer);
                if (message.error) pending.reject(new Error(message.error));
                else { worker.gatewayPort = message.port; pending.resolve(message.port); }
            }
            if (message.kind === 'result' && worker.current?.id === message.id) {
                const pending = worker.current; worker.current = null; clearTimeout(pending.timer);
                if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
            }
        });
        child.on('exit', (code, signal) => {
            if (worker.child !== child) return;
            this.resetWorker(worker, `运行进程退出 (${signal || code})`);
        });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { cleanup(); this.resetWorker(worker, '运行进程启动超时'); reject(new Error('运行进程启动超时')); }, 10000);
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

    resetWorker(worker, reason = '运行配置已更新') {
        const child = worker.child;
        worker.child = null; worker.wsPort = null; worker.stats = null; worker.gatewayPort = null;
        if (worker.gatewayPending) { clearTimeout(worker.gatewayPending.timer); worker.gatewayPending.reject(new Error(reason)); worker.gatewayPending = null; }
        if (worker.current) { clearTimeout(worker.current.timer); worker.current.reject(new Error(reason)); worker.current = null; }
        this.killTree(child);
    }

    reset(reason = '运行配置已更新') {
        for (const worker of this.workers) this.resetWorker(worker, reason);
        this.wsSources.clear();
    }

    usesWebSocket(source) {
        if (!source?.file) return false;
        if (this.wsSources.has(source.file)) return this.wsSources.get(source.file);
        let value = false;
        try {
            value = /\bfServer\b|\bWebSocketServer\b|\bnew\s+WebSocket\b|from\s*['"]ws['"]|require\(\s*['"]ws['"]\s*\)/.test(readFileSync(source.file, 'utf8'));
        } catch {}
        this.wsSources.set(source.file, value);
        return value;
    }

    workerFor(source) {
        const id = source?.instanceId || source?.file || 'default';
        if (this.usesWebSocket(source)) { this.assignments.set(id, 0); return this.workers[0]; }
        const existing = this.assignments.get(id);
        if (Number.isInteger(existing) && this.workers[existing]) return this.workers[existing];
        const minimum = Math.min(...this.workers.map(worker => worker.pending));
        const candidates = this.workers.filter(worker => worker.pending === minimum);
        const selected = candidates[this.cursor % candidates.length];
        this.cursor = (this.cursor + 1) % this.workers.length;
        this.assignments.set(id, selected.index);
        return selected;
    }

    run(source, query, env, operation = 'api') {
        if (this.closed) return Promise.reject(new Error('服务正在关闭'));
        if (this.waiting >= 64) return Promise.reject(Object.assign(new Error('源请求队列已满，请稍后重试'), {statusCode: 503}));
        this.waiting++;
        const worker = this.workerFor(source);
        worker.pending++;
        const work = worker.queue.then(async () => {
            if (this.closed) throw new Error('服务正在关闭');
            await this.startWorker(worker);
            return new Promise((resolve, reject) => {
                const id = ++this.sequence;
                const method = sourceOperation(query, operation);
                const timeout = method === 'action' ? 60000 : SOURCE_TIMEOUT;
                const armTimer = () => setTimeout(() => {
                    if (worker.current?.id === id) this.resetWorker(worker, `源执行超过 ${timeout / 1000} 秒，已回收运行进程`);
                }, timeout);
                const job = {id, source: source.instanceId, resolve, reject, timer: armTimer(), armTimer, method};
                worker.current = job;
                const child = worker.child;
                if (!child) { clearTimeout(job.timer); worker.current = null; reject(new Error('运行进程未启动')); return; }
                try {
                    child.send({kind: 'run', id, source, query, env, operation}, error => {
                        if (error) this.resetWorker(worker, error.message);
                    });
                } catch (error) {
                    clearTimeout(job.timer); worker.current = null; reject(error);
                }
            });
        }).finally(() => { this.waiting--; worker.pending--; });
        worker.queue = work.catch(() => {});
        return work;
    }

    close() {
        this.closed = true;
        this.reset('服务正在关闭');
        this.assignments.clear();
    }

    async gateway() {
        if (this.closed) throw new Error('服务正在关闭');
        const worker = this.primary;
        if (worker.gatewayPort) return worker.gatewayPort;
        if (worker.gatewayPending) return worker.gatewayPending.promise;
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        const pending = {promise, resolve, reject};
        worker.gatewayPending = pending;
        const failed = error => {
            if (worker.gatewayPending !== pending) return;
            clearTimeout(pending.timer); worker.gatewayPending = null; reject(error);
        };
        pending.timer = setTimeout(() => {
            if (worker.gatewayPending === pending) this.resetWorker(worker, '网关启动超时');
        }, 10000);
        void (async () => {
            await this.start();
            if (worker.gatewayPending !== pending || this.closed) return;
            const child = this.child;
            if (!child) throw new Error('运行进程未启动');
            child.send({kind: 'gateway'}, error => { if (error) failed(error); });
        })().catch(failed);
        return promise;
    }

    status() {
        const stats = this.workers.map(worker => worker.stats).filter(Boolean);
        return {
            started: this.workers.some(worker => worker.child),
            pid: this.child?.pid || null,
            waiting: this.waiting,
            engines: stats.some(status => Array.isArray(status.engines) && status.engines.length) ? ['dr3'] : [],
            workers: this.workers.map(worker => ({index: worker.index, pid: worker.child?.pid || null, started: !!worker.child, waiting: worker.pending})),
            ...(stats[0]?.memory ? {memory: stats[0].memory} : {}),
        };
    }
}
