import {AsyncLocalStorage} from 'async_hooks';
import {existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync, realpathSync} from 'fs';
import path from 'path';
import {randomBytes} from 'crypto';

// 异步调用、辅助库和 ENV.set 均跟随当前源；不改写进程级环境变量。
const contexts = new AsyncLocalStorage();
export const sourceEnvironment = () => contexts.getStore();
export const withSourceEnvironment = (scope, operation) => contexts.run(scope, operation);
export function readSourceVariables(file) {
    if (!file || !existsSync(file)) return {};
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('源环境变量文件须为对象');
    return value;
}
export function writeSourceVariables(file, value) {
    mkdirSync(path.dirname(file), {recursive: true});
    const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try { writeFileSync(temporary, JSON.stringify(value, null, 2), {mode: 0o600}); renameSync(temporary, file); }
    finally { rmSync(temporary, {force: true}); }
}
export function redactSourceSecrets(message, scope = sourceEnvironment()) {
    if (!scope) return message;
    const values = [];
    if (scope.file) {
        // Read independently: a damaged global file must not disable redaction
        // of the current source's variables (or vice versa).
        try { values.push(readSourceVariables(path.join(path.dirname(scope.file), '../env.json'))); } catch {}
        try { values.push(readSourceVariables(scope.file)); } catch {}
    }
    const collected = new Set();
    const collect = value => {
        if (typeof value === 'string' && value) collected.add(value);
        else if (['number', 'boolean'].includes(typeof value)) collected.add(String(value));
        else if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(values);
    // Params are private even if the name is not Cookie/Token. Cover both the
    // full raw value and individual values printed from JSON parameters.
    if (typeof scope.params === 'string' && scope.params) {
        collected.add(scope.params);
        try { collect(JSON.parse(scope.params)); } catch {}
    }
    for (const file of [scope.file, ...(scope.privatePaths || [])]) {
        if (typeof file !== 'string' || !path.isAbsolute(file)) continue;
        collected.add(file);
        try { collected.add(realpathSync(file)); } catch {}
    }
    // 按“值”而不是“键名”脱敏：收集所有字符串值，长值优先替换，避免短值先替换破坏长值。
    // 同时替换 URL 编码与 JSON 转义两种形态，覆盖 alias/uid 等不含敏感关键字的键。
    const secrets = [...collected].sort((left, right) => right.length - left.length);
    let text = String(message);
    for (const secret of secrets) {
        const forms = new Set([secret, JSON.stringify(secret).slice(1, -1)]);
        // JSON can carry lone UTF-16 surrogates. URI encoding such a value
        // throws; raw/JSON redaction must still work without breaking logging.
        try { const encoded = encodeURIComponent(secret); forms.add(encoded); forms.add(encoded.replace(/%20/g, '+')); } catch {}
        for (const form of forms) if (form) text = text.split(form).join('[已隐藏]');
    }
    return text;
}
