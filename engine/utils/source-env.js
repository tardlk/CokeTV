import {AsyncLocalStorage} from 'async_hooks';
import {existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync} from 'fs';
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
export function redactSourceSecrets(message) {
    const scope = sourceEnvironment();
    if (!scope?.file) return message;
    let values = {};
    try { values = {...readSourceVariables(path.join(path.dirname(scope.file), '../env.json')), ...readSourceVariables(scope.file)}; } catch {}
    let text = String(message);
    for (const [key, value] of Object.entries(values)) {
        if (/cookie|token|password|secret|api.?key|auth/i.test(key) && typeof value === 'string' && value) text = text.split(value).join('[已隐藏]');
    }
    return text;
}
