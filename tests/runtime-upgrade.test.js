import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createApp} from '../src/server.js';
import {ROOT} from '../src/paths.js';

const exec = promisify(execFile);
const PYTHON = process.env.TEST_PYTHON || 'python3';
const PHP = process.env.TEST_PHP || 'php';
// Frozen, verbatim bridge files from release ae89c27570537c8931f0747a3c2185880a6b94e3.
// No Git history, network or production data is needed to reproduce an upgrade.
async function oldRuntime(directory) {
    const app = await createApp({directory, seed: false});
    try {
        const setupCode = (await fs.readFile(path.join(directory, 'setup-code.txt'), 'utf8')).trim();
        const setup = await app.inject({method: 'POST', url: '/admin/access/setup', payload: {password: 'upgrade-password', confirmPassword: 'upgrade-password', setupCode}});
        assert.equal(setup.statusCode, 200, setup.body);
        const sources = {};
        for (const engine of ['js', 'dr2', 'cat', 'py', 'php']) {
            const fixture = engine === 'dr2' ? 'js' : engine === 'cat' ? 'cat.js' : engine;
            const code = await fs.readFile(path.join(ROOT, `tests/fixtures/协议样本.${fixture}`), 'utf8');
            sources[engine] = await app.store.saveScript(engine, `升级样本.${['cat', 'dr2'].includes(engine) ? 'js' : engine}`, code);
        }
        await app.store.mutate(state => {
            state.settings.pythonPath = PYTHON; state.settings.phpPath = PHP;
            state.settings.env = {global_cookie: 'upgrade-global-cookie'};
            state.settings.parses = [{name: '用户解析', type: 2, url: '/parse/custom'}];
            state.settings.plugins = [{name: 'user-plugin', enabled: false}];
            for (const instance of state.instances) instance.params = 'upgrade-param';
            state.subscriptions[0].instances = Object.values(sources).map(source => source.id).reverse();
        });
        await app.store.syncEnvironment();
        const preserved = new Map();
        for (const source of Object.values(sources)) preserved.set(app.store.scriptPath(source), await fs.readFile(app.store.scriptPath(source)));
        const customFiles = {
            'runtime/config/source-env/custom.json': '{"cookie":"per-source-fixture"}',
            [`runtime/config/source-env/${sources.js.id}.json`]: '{"fixture_cookie":"upgrade-source-cookie"}',
            'runtime/config/map.txt': '# 用户映射\n',
            'runtime/config/player.json': '{"custom":"user-player"}',
            'runtime/config/parses.conf': '# 用户配置\n',
            'runtime/json/custom.json': '{"token":"user-json-token"}',
            'runtime/jx/custom.js': 'export default {};\n',
            'runtime/data/custom.txt': 'user-data',
            'runtime/spider/js/_lib.user.js': 'export default "user-helper";',
            'runtime/spider/py/base/user-helper.py': 'custom = True\n',
            'runtime/spider/php/lib/user-helper.php': '<?php // user-helper\n',
            'runtime/spider/catLib/user-helper.js': 'export default {};',
            'runtime/spider/py/__pycache__/custom.pyc': 'user-cache',
            [`revisions/${sources.js.id}/old.txt`]: 'user-history',
        };
        for (const [relative, content] of Object.entries(customFiles)) {
            const file = path.join(directory, relative);
            await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, content);
            preserved.set(file, Buffer.from(content));
        }
        for (const relative of ['state.json', 'admin.json', 'runtime/config/env.json', 'runtime/.plugins.js']) {
            const file = path.join(directory, relative); preserved.set(file, await fs.readFile(file));
        }
        for (const [fixture, relative] of [['php-bridge.txt', 'spider/php/_bridge.php'], ['t4-daemon.txt', 'spider/py/core/t4_daemon.py']]) {
            await fs.copyFile(path.join(ROOT, 'tests/fixtures/legacy-runtime', fixture), path.join(app.store.runtime, relative));
        }
        // Stale framework helpers and missing base files must also be refreshed,
        // without recursively replacing the user's helper files beside them.
        await fs.writeFile(path.join(app.store.runtime, 'spider/catvod/_dsutil.js'), '// stale framework helper');
        await fs.rm(path.join(app.store.runtime, 'spider/php/lib/spider.php'));
        return {sources, preserved, state: structuredClone(app.store.state)};
    } finally { await app.close(); }
}

test('R1 旧运行副本升级后 PHP 代理与五引擎协议可用，脚本/ENV/配置/订阅/历史保持原样', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-upgrade-'));
    let app;
    try {
        const {sources, preserved, state} = await oldRuntime(directory);
        app = await createApp({directory, seed: false});
        assert.deepEqual(app.store.state, state);
        for (const [file, content] of preserved) assert.deepEqual(await fs.readFile(file), content, `升级改写用户文件：${path.relative(directory, file)}`);
        const authorization = `Basic ${Buffer.from(':upgrade-password').toString('base64')}`;
        // Reproduce the original upgrade failure before any other assertions.
        const proxy = await app.inject({url: `/proxy/${sources.php.id}/`, headers: {authorization}});
        assert.equal(proxy.statusCode, 200, proxy.body); assert.equal(proxy.body, 'hello');
        for (const [engine, source] of Object.entries(sources)) {
            const home = await app.inject(`/watch/sources/${source.id}`);
            assert.equal(home.statusCode, 200, `${engine}: ${home.body}`);
            assert.equal(home.json().list[0].vod_name, '样本电影');
            const category = await app.inject(`/watch/sources/${source.id}?ac=list&t=movie&pg=2`);
            assert.equal(category.statusCode, 200, category.body);
            assert.equal(category.json().list[0].vod_name, 'movie-2-upgrade-param');
        }
        for (const relative of ['spider/php/lib/spider.php', 'spider/catvod/_dsutil.js', 'spider/py/core/t4_daemon.py']) {
            assert.deepEqual(await fs.readFile(path.join(app.store.runtime, relative)), await fs.readFile(path.join(ROOT, 'engine', relative)));
        }
        await app.close(); app = await createApp({directory, seed: false});
        assert.deepEqual(app.store.state, state);
        for (const [file, content] of preserved) assert.deepEqual(await fs.readFile(file), content);
    } finally { await app?.close(); await fs.rm(directory, {recursive: true, force: true}); }
});

test('R1 升级实际使用的 Python 桥接接受 JSON 并拒绝旧 pickle 入站协议', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-upgrade-python-'));
    let app;
    try {
        await oldRuntime(directory);
        app = await createApp({directory, seed: false});
        const daemon = path.join(app.store.runtime, 'spider/py/core/t4_daemon.py');
        const {stdout} = await exec(PYTHON, ['-c', `
import importlib.util, io, json, pickle, struct, sys
spec = importlib.util.spec_from_file_location('upgrade_daemon', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def packet(payload):
    return io.BytesIO(struct.pack('>I', len(payload)) + payload)
assert module.recv_packet(packet(b'{"method":"home"}')) == {'method': 'home'}
try:
    module.recv_packet(packet(pickle.dumps({'method': 'home'})))
except ValueError:
    print('JSON accepted; pickle rejected')
else:
    raise AssertionError('legacy pickle packet accepted after upgrade')
`, daemon], {timeout: 10000});
        assert.equal(stdout.trim(), 'JSON accepted; pickle rejected');
    } finally { await app?.close(); await fs.rm(directory, {recursive: true, force: true}); }
});
