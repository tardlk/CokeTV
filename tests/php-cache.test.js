import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// 本机通常没有 PHP 解释器，所以用一个「假解释器」驱动 module cache 路径。
// 它忽略 CLI 参数（-d memory_limit=… / bridge / method / env …），每次被调用记一次数并输出合法 JSON。
// 这样仍然能真实验证缓存语义：同 proxyUrl 命中、proxyUrl 变更重新 init。
test('PHP module cache：同 proxyUrl 命中缓存，proxyUrl 变更必须重新 init（与 HIPY 对齐）', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-php-cache-'));
    const counter = path.join(directory, 'spawns.txt');
    const fakePhp = path.join(directory, 'fake-php');
    await fs.writeFile(fakePhp, `#!/bin/sh\nprintf . >> "${counter}"\nprintf '{}'\n`);
    await fs.chmod(fakePhp, 0o755);
    const source = path.join(directory, 'sample.php');
    await fs.writeFile(source, '<?php\nclass Spider { public function init($extend = "") { return true; } }\n');
    const previous = process.env.PHP_PATH;
    process.env.PHP_PATH = fakePhp;
    t.after(async () => {
        if (previous === undefined) delete process.env.PHP_PATH; else process.env.PHP_PATH = previous;
        await fs.rm(directory, {recursive: true, force: true});
    });
    const {default: php} = await import('../engine/libs/php.js');
    const spawns = async () => { try { return (await fs.readFile(counter, 'utf8')).length; } catch { return 0; } };
    const env = proxyUrl => ({sourceInstanceId: 'inst-cache', ext: '', proxyUrl});

    await php.init(source, env('http://127.0.0.1:8000/proxy/a'));
    const first = await spawns();
    assert.ok(first >= 1, `首次 init 应真正调用解释器（实际 ${first} 次）`);
    // 同一 proxyUrl：命中缓存，不再落解释器。
    await php.init(source, env('http://127.0.0.1:8000/proxy/a'));
    assert.equal(await spawns(), first, 'proxyUrl 不变时应命中缓存');
    // proxyUrl 变化：必须重新 init，否则会继续用闭包里捕获的旧 env。
    await php.init(source, env('http://127.0.0.1:8000/proxy/b'));
    assert.ok((await spawns()) > first, 'proxyUrl 变更后必须重新 init，不能复用旧闭包');
});

test('PHP module cache：文件内容变化同样必须重新 init（原有 hash 语义不回归）', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-php-hash-'));
    const counter = path.join(directory, 'spawns.txt');
    const fakePhp = path.join(directory, 'fake-php');
    await fs.writeFile(fakePhp, `#!/bin/sh\nprintf . >> "${counter}"\nprintf '{}'\n`);
    await fs.chmod(fakePhp, 0o755);
    const source = path.join(directory, 'sample.php');
    await fs.writeFile(source, '<?php\n// v1\n');
    const previous = process.env.PHP_PATH;
    process.env.PHP_PATH = fakePhp;
    t.after(async () => {
        if (previous === undefined) delete process.env.PHP_PATH; else process.env.PHP_PATH = previous;
        await fs.rm(directory, {recursive: true, force: true});
    });
    const {default: php} = await import('../engine/libs/php.js');
    const spawns = async () => { try { return (await fs.readFile(counter, 'utf8')).length; } catch { return 0; } };
    const env = {sourceInstanceId: 'inst-hash', ext: '', proxyUrl: 'http://127.0.0.1:8000/proxy/a'};

    await php.init(source, env);
    const first = await spawns();
    await php.init(source, env);
    assert.equal(await spawns(), first, '同文件同 proxyUrl 应命中缓存');
    await fs.writeFile(source, '<?php\n// v2\n');
    await php.init(source, env);
    assert.ok((await spawns()) > first, '文件内容变化必须重新 init');
});
