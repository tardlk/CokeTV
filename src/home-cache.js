import {createHash, randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {LRUCache} from 'lru-cache';
import {sourceOperation} from './source-operation.js';
import {activityFields} from './activity.js';

export const HOME_TTL = 5 * 60000;
const digest = value => createHash('sha256').update(value).digest('hex');
const optionalFile = file => {
    if (!file) return null;
    try { return digest(readFileSync(file)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
function validHome(result) {
    if (typeof result === 'string') { try { result = JSON.parse(result); } catch { return false; } }
    return result && !result.error && result.success !== false &&
        (Array.isArray(result.class) || Array.isArray(result.list) || result.filters && typeof result.filters === 'object');
}

// Only serialized results live here: every caller receives an independent
// value, and cached URLs remain scoped to the origin/credentials that made them.
export function createHomeCache({now = Date.now, ttl = HOME_TTL, max = 100, maxSize = 32 * 1024 * 1024, maxEntrySize = 2 * 1024 * 1024} = {}) {
    const values = new LRUCache({max, maxSize, sizeCalculation: entry => Buffer.byteLength(entry.json)});
    const pending = new Map();
    let generation = 0;
    return {
        clear() { generation++; values.clear(); pending.clear(); },
        async get(key, load, {refresh = false} = {}) {
            const shared = pending.get(key);
            if (shared) {
                const entry = await shared;
                return {value: JSON.parse(entry.json), remainingMs: Math.max(0, entry.expires - now()), status: 'shared'};
            }
            const cached = values.get(key);
            // Repeated explicit refreshes share a ten-second window.
            if (cached && cached.expires > now() && (!refresh || now() - cached.refreshed < 10000)) {
                return {value: JSON.parse(cached.json), remainingMs: cached.expires - now(), status: 'hit'};
            }
            if (pending.size >= 64) throw Object.assign(new Error('首页请求繁忙，请稍后重试'), {statusCode: 503});
            const epoch = generation;
            const task = Promise.resolve().then(load).then(result => {
                const json = JSON.stringify(result);
                const cacheable = json !== undefined && Buffer.byteLength(json) <= Math.min(maxEntrySize, maxSize) && validHome(result);
                const entry = {json: json ?? 'null', expires: cacheable && epoch === generation ? now() + ttl : now(), refreshed: refresh ? now() : -Infinity};
                if (cacheable && epoch === generation) values.set(key, entry);
                return entry;
            });
            pending.set(key, task);
            try {
                const entry = await task;
                return {value: JSON.parse(entry.json), remainingMs: Math.max(0, entry.expires - now()), status: 'miss'};
            } finally { if (pending.get(key) === task) pending.delete(key); }
        },
    };
}

export function createSourceExecutor({store, runner, netdisk, cache = createHomeCache()}) {
    const boot = randomBytes(8).toString('hex');
    let revision = 0;
    const clear = () => { cache.clear(); revision++; };
    runner.on('reset', clear);
    return {
        revision: () => `${boot}-${revision}`,
        close() { runner.off('reset', clear); clear(); },
        async execute(resolved, query, env, operation = 'api', onCache) {
            const method = sourceOperation(query, operation);
            if (method === 'refresh') clear();
            const {homeRefresh, ...sourceQuery} = query;
            const load = () => netdisk.execute(resolved, sourceQuery, env, runner, operation);
            if (method !== 'home') return load();
            const {instance, file} = resolved;
            // Files are included by content, so an external edit or ENV.set is
            // visible on the very next request, even without a management reset.
            const key = digest(JSON.stringify([
                instance.id, file, digest(readFileSync(file)),
                optionalFile(env.sourceEnvPath), optionalFile(path.join(store.runtime, 'config/env.json')),
                env.ext, env.requestHost, env.proxyUrl, env.localPort, env.activity?.protocol, env.activity?.userAgent,
                sourceQuery.filter ?? 1,
            ]));
            const result = await cache.get(key, load, {refresh: homeRefresh === '1' || homeRefresh === true});
            onCache?.({status: result.status, remainingMs: result.remainingMs});
            if (result.status !== 'miss') runner.log({...activityFields(env.activity), category: 'spider', event: 'spider.cache', operation: 'home',
                source: instance.id, outcome: 'ok', cacheStatus: result.status,
                message: result.status === 'shared' ? '首页复用进行中的请求' : '首页使用缓存'});
            return result.value;
        },
    };
}
