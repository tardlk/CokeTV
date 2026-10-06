import {logError} from '../utils/log.js';
import path from "path";
import {readFile} from "fs/promises";
import {fileURLToPath} from 'url';
import {execFile} from 'child_process';
import {promisify} from 'util';
import {LRUCache} from 'lru-cache';
import {computeHash, deepCopy, getNowTime} from "../utils/utils.js";
import {prepareBinary} from "../utils/binHelper.js";
import {md5} from "../libs_drpy/crypto-util.js";
import {fastify} from "../controllers/fastlogger.js";
import {redactSourceSecrets, sourceEnvironment} from '../utils/source-env.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _bridge_path = path.join(__dirname, '../spider/php/_bridge.php');

// Cache for module objects（LRU 有界，淘汰=下次重新 init，与 refresh 路径等价）
const moduleCache = new LRUCache({max: 200, ttl: 1000 * 60 * 10});

// Mapping from JS method names to PHP Spider method names
const methodMapping = {
    'init': 'init',
    'home': 'homeContent',
    'homeVod': 'homeVideoContent',
    'category': 'categoryContent',
    'detail': 'detailContent',
    'search': 'searchContent',
    'play': 'playerContent',
    'proxy': 'localProxy|proxy', // 优先 localProxy（BaseSpider 约定），回退 proxy 别名
    'action': 'action' // Not standard
};

// Helper to stringify args for CLI
function stringify(arg) {
    if (arg === undefined) return 'null';
    return JSON.stringify(arg);
}

// Helper to parse JSON output
function json2Object(json) {
    if (!json) return {};
    if (typeof json === 'object') return json;
    try {
        return JSON.parse(json);
    } catch (e) {
        return json;
    }
}

// Execute PHP bridge
const callPhpMethod = async (filePath, methodName, env, ...args) => {
    let phpPath = process.env.PHP_PATH || 'php';
    const phpMethodName = methodMapping[methodName] || methodName;
    const scope = sourceEnvironment();
    const redact = message => redactSourceSecrets(message, {...scope, file: env?.sourceEnvPath || scope?.file, params: env?.ext,
        privatePaths: [...(scope?.privatePaths || []), filePath, _bridge_path, phpPath]});
    const failure = () => Object.assign(new Error('PHP 源执行失败'), {code: 'PHP_SOURCE_FAILED'});
    const diagnostic = (details, stderr = '') => {
        logError(redact(`PHP ${phpMethodName} failed: ${details}`));
        if (stderr) logError(redact(`PHP stderr: ${stderr}`));
    };
    try {
        const validPath = prepareBinary(phpPath);
        if (!validPath) { diagnostic('解释器不存在或不可用'); throw failure(); }
        phpPath = validPath;
        const cliArgs = [_bridge_path, filePath, phpMethodName, JSON.stringify(env), ...args.map(stringify)];
        const {stdout, stderr} = await execFileAsync(phpPath, cliArgs, {
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            // 超时后 execFile 回收 PHP 子进程；保留原 API_TIMEOUT + 5s 预算。
            timeout: (parseInt(process.env.API_TIMEOUT || '20') + 5) * 1000,
            killSignal: 'SIGTERM',
            env: {
                ...process.env,
                // Add any PHP specific env vars if needed
            }
        });

        if (stderr) logError(redact(`PHP stderr: ${stderr}`));

        const result = json2Object(stdout.trim());

        if (result && result.error) {
            diagnostic(`${String(result.error)}\n${String(result.traceback || '')}`);
            throw failure();
        }

        return result;

    } catch (error) {
        if (error.code === 'PHP_SOURCE_FAILED') throw error;
        // execFile rejects on a bridge exit(1). Parse its stdout error envelope;
        // never log/throw the raw Error, whose message/cmd contain all CLI args.
        let bridge;
        try { bridge = JSON.parse(String(error.stdout || '').trim()); } catch {}
        const details = bridge?.error ? `${String(bridge.error)}\n${String(bridge.traceback || '')}` :
            error.killed ? '调用超时或进程中断' : '解释器启动失败或进程异常退出';
        diagnostic(details, String(error.stderr || ''));
        throw failure();
    }
};

const loadEsmWithHash = async function (filePath, fileHash, env) {
    const spiderProxy = {};
    const spiderMethods = Object.keys(methodMapping);

    spiderMethods.forEach(method => {
        spiderProxy[method] = async (...args) => {
            return callPhpMethod(filePath, method, env, ...args);
        };
    });

    return spiderProxy;
};

const init = async function (filePath, env = {}, refresh) {
    try {
        const fileContent = await readFile(filePath, 'utf-8');
        const fileHash = computeHash(fileContent);
        const moduleName = path.basename(filePath, '.php'); // .php extension
        let moduleExt = env.ext || '';

        let hashMd5 = md5(filePath + '#php#' + moduleExt + '#' + (env.sourceInstanceId || ''));

        if (moduleCache.has(hashMd5) && !refresh) {
            const cached = moduleCache.get(hashMd5);
            if (cached.hash === fileHash) {
                return cached.moduleObject;
            }
        }

        fastify.log.info(`Loading PHP module: ${path.basename(filePath)}`);
        let t1 = getNowTime();

        const module = await loadEsmWithHash(filePath, fileHash, env);
        const rule = module;

        // Initialize the spider
        const initValue = await rule.init(moduleExt) || {};

        let t2 = getNowTime();
        const moduleObject = deepCopy(rule);
        moduleObject.cost = t2 - t1;

        moduleCache.set(hashMd5, {moduleObject, hash: fileHash});
        return {...moduleObject, ...initValue};

    } catch (error) {
        if (error.code !== 'PHP_SOURCE_FAILED') logError(redactSourceSecrets(`PHP 初始化失败: ${error.message}`, {
            ...sourceEnvironment(), file: env?.sourceEnvPath, params: env?.ext, privatePaths: [filePath, _bridge_path, process.env.PHP_PATH]}));
        throw Object.assign(new Error('PHP 源执行失败'), {code: 'PHP_SOURCE_FAILED'});
    }
};

const getRule = async function (filePath, env) {
    const moduleObject = await init(filePath, env);
    return JSON.stringify(moduleObject);
};

const home = async function (filePath, env, filter = 1) {
    const moduleObject = await init(filePath, env);
    return json2Object(await moduleObject.home(filter));
};

const homeVod = async function (filePath, env) {
    const moduleObject = await init(filePath, env);
    const homeVodResult = json2Object(await moduleObject.homeVod());
    return homeVodResult && homeVodResult.list ? homeVodResult.list : homeVodResult;
};

const category = async function (filePath, env, tid, pg = 1, filter = 1, extend = {}) {
    const moduleObject = await init(filePath, env);
    return json2Object(await moduleObject.category(tid, pg, filter, extend));
};

const detail = async function (filePath, env, ids) {
    const moduleObject = await init(filePath, env);
    return json2Object(await moduleObject.detail(ids));
};

const search = async function (filePath, env, wd, quick = 0, pg = 1) {
    const moduleObject = await init(filePath, env);
    return json2Object(await moduleObject.search(wd, quick, pg));
};

const play = async function (filePath, env, flag, id, flags) {
    const moduleObject = await init(filePath, env);
    return json2Object(await moduleObject.play(flag, id, flags));
};

const proxy = async function (filePath, env, params) {
    const moduleObject = await init(filePath, env);
    return json2Object(await moduleObject.proxy(params));
};

const action = async function (filePath, env, action, value) {
    const moduleObject = await init(filePath, env);
    return json2Object(await moduleObject.action(action, value));
};

export default {
    getRule,
    init,
    home,
    homeVod,
    category,
    detail,
    search,
    play,
    proxy,
    action
};
