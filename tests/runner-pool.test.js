import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.js';
import {ruleFixture} from './helpers/drpy3-fixture.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const source = (title, delay) => ruleFixture(`var rule={title:${JSON.stringify(title)},host:'https://fixture.invalid',class_parse:async function(){await new Promise(resolve=>setTimeout(resolve,${delay}));return {class:[]}}};`);

test('不同源可跨 worker 并行，同一源仍保持串行', {timeout: 20000}, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-runner-pool-'));
    const previous = process.env.SOURCE_WORKERS;
    process.env.SOURCE_WORKERS = '2';
    let app;
    try {
        app = await createApp({directory});
        const first = await app.store.saveScript('dr3', 'pool-a.js', source('Pool A', 350));
        const second = await app.store.saveScript('dr3', 'pool-b.js', source('Pool B', 350));
        const ids = Object.fromEntries(app.store.state.instances.map(instance => [instance.scriptId, instance.id]));
        const a = ids[first.id], b = ids[second.id];
        assert.ok(a && b);
        await app.store.mutate(state => { state.subscriptions[0].instances = [a, b]; });
        const token = app.store.state.subscriptions[0].token;
        const call = id => app.inject({method: 'POST', url: `/api/${id}?token=${token}`, payload: {}});

        // Warm both worker processes first so the measurement covers execution,
        // not fork/engine startup.
        assert.equal((await call(a)).statusCode, 200);
        assert.equal((await call(b)).statusCode, 200);
        assert.equal(app.runner.workers.filter(worker => worker.child).length, 2);
        assert.notEqual(app.runner.workerFor({instanceId: a}).index, app.runner.workerFor({instanceId: b}).index);
        const wsScript = await app.store.saveScript('dr3', 'pool-ws.js', ruleFixture("var rule={title:'WS',host:'',fServer:true};"));
        const wsFile = app.store.scriptPath(wsScript);
        assert.equal(app.runner.usesWebSocket({file: wsFile}), true);
        assert.equal(app.runner.workerFor({instanceId: 'ws-fixture', file: wsFile}).index, 0);

        const started = Date.now();
        const [left, right] = await Promise.all([call(a), call(b)]);
        const parallel = Date.now() - started;
        assert.equal(left.statusCode, 200, left.body);
        assert.equal(right.statusCode, 200, right.body);
        assert.ok(parallel < 900, `不同源应并行，实际耗时 ${parallel}ms`);

        const serialStarted = Date.now();
        const same = await Promise.all([call(a), call(a)]);
        const serial = Date.now() - serialStarted;
        assert.ok(same.every(response => response.statusCode === 200));
        assert.ok(serial > parallel + 200, `同一源应串行，实际并行 ${parallel}ms / 串行 ${serial}ms`);
    } finally {
        if (previous === undefined) delete process.env.SOURCE_WORKERS; else process.env.SOURCE_WORKERS = previous;
        await app?.close();
        await fs.rm(directory, {recursive: true, force: true});
    }
});
