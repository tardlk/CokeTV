import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {ROOT} from '../src/paths.js';

// 发行树 engine/spider 下允许出现的文件白名单（新增文件必须显式登记）。
// 旧的“`_` 前缀即免检 + 只查顶层 + 复用 scan() 判据”会让检查空转：既漏掉子目录与
// .py/.mjs，又只能证明“不会被注册”。白名单 + 递归才能证明“发行树零预置源”。
export const ALLOWED = new Set([
    'spider/catLib/cat.js',
    'spider/catLib/cheerio.min.js',
    'spider/catLib/crypto-js.js',
    'spider/catLib/http.js',
    'spider/catLib/mod.js',
    'spider/catLib/similarity.js',
    'spider/catLib/sortName.js',
    'spider/catLib/spider.js',
    'spider/catvod/_dsutil.js',
    'spider/js/_lib.action.js',
    'spider/js/_lib.cntv-urlparse.cjs',
    'spider/js/_lib.cntv-wasm.cjs',
    'spider/js/_lib.cntv.js',
    'spider/js/_lib.cntv.live.js',
    'spider/js/_lib.cntv2026.cjs',
    'spider/js/_lib.douyin_pb.cjs',
    'spider/js/_lib.douyin_sign.cjs',
    'spider/js/_lib.douyu.cjs',
    'spider/js/_lib.random.js',
    'spider/js/_lib.request.cjs',
    'spider/js/_lib.request.js',
    'spider/js/_lib.scan.js',
    'spider/js/_lib.tingyou.js',
    'spider/js/_lib.waf.js',
    'spider/js_dr2/.gitkeep',
    'spider/php/_bridge.php',
    'spider/php/lib/HtmlParser.php',
    'spider/php/lib/spider.php',
    'spider/py/_bridge.py',
    'spider/py/base/htmlParser.py',
    'spider/py/base/requirements.txt',
    'spider/py/base/spider.py',
    'spider/py/core/bridge.js',
    'spider/py/core/bridge.py',
    'spider/py/core/t4_daemon.py',
    'spider/py/core/t4_daemon_lite.py',
    'spider/xbpq/test.json',
]);
// 允许在发行树里出现“规则/站点清单”标记的文件（相对 engine/ 的路径）。当前为空：
// 基类与辅助库都不定义站点规则，引擎自身也不内置站点清单。
export const ALLOWED_RULE_FILES = new Set([]);
// 站点规则定义（JS/PHP/PY 源）与 TVBox 站点清单（JSON）的标记。
// 覆盖两轮事故：`var rule={...}`（JS/PHP/PY 源）与 `{"sites":[...]}`（TVBox 配置）。
const RULE_MARKERS = /\bvar\s+rule\s*=|\bclass\s+Spider\b|"sites"\s*:\s*\[/;
// 判定前先丢掉整行注释，避免把文档/示例（如 utils/python.js 注释里的 `class Spider`）误判成站点定义。
const COMMENT_LINE = /^\s*(?:\/\/|#|\*|\/\*|--|;)/;
const stripCommentLines = code => code.split(/\r?\n/).filter(line => !COMMENT_LINE.test(line)).join('\n');
// 只对文本类文件做内容判定，避免误读 WASM/字体/图片等二进制 bundle。
const TEXT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.json', '.py', '.php', '.md', '.txt', '.sh', '.html', '.css', '.conf', '.yml', '.yaml']);

async function walk(directory) {
    const entries = await fs.readdir(directory, {withFileTypes: true})
        .catch(error => { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []; throw error; });
    const found = [];
    for (const entry of entries) {
        if (entry.name === '__pycache__') continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) found.push(...await walk(full));
        else if (entry.isFile()) found.push(full);
    }
    return found;
}

export async function checkShell(root = path.join(ROOT, 'engine')) {
    // 第一趟：spider/ 下必须逐个登记（递归，不排除下划线/子目录/.py/.mjs）。
    const spiderFiles = await walk(path.join(root, 'spider'));
    for (const file of spiderFiles) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        assert.ok(ALLOWED.has(rel), `发行包出现未登记文件：${rel}`);
    }
    // 第二趟：整个 engine/ 都不得出现站点规则定义或 TVBox 站点清单。
    // 只查 spider/ 会让 libs_drpy/sites.js、utils/sites.js、controllers/sites.js、
    // config/sites.json 这类位置成为盲区（实测均能通过）。
    const files = await walk(root);
    for (const file of files) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
        const code = await fs.readFile(file, 'utf8');
        assert.ok(!RULE_MARKERS.test(stripCommentLines(code)) || ALLOWED_RULE_FILES.has(rel), `发行包出现站点规则/站点清单定义：${rel}`);
    }
    for (const folder of ['json', 'jx', 'data']) {
        assert.deepEqual((await fs.readdir(path.join(root, folder))).filter(name => name !== '.gitkeep'), [], `发行包 ${folder} 必须为空`);
    }
    assert.equal((await fs.readFile(path.join(root, 'config/map.txt'), 'utf8')).trim(), '');
    assert.equal((await fs.readFile(path.join(root, 'config/parses.conf'), 'utf8')).trim(), '');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'config/player.json'), 'utf8')), {});
    console.log(`空壳发行检查通过：spider ${spiderFiles.length} 个文件全部已登记，engine 共 ${files.length} 个文件无站点规则/清单`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await checkShell();
