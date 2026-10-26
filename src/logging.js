import fs from 'node:fs/promises';
import path from 'node:path';

// Logs are written to stdout and (by default) a rotating file so that a NAS
// restart does not wipe the only diagnostic trail. Redaction is deliberately
// conservative: capability tokens and authorization headers are the values
// that must never end up in `docker logs` or a downloaded log file.
const SECRET_QUERY = /([?&;](?:token|access_token|refresh_token|password|passwd|pwd|secret|apikey|api_key)=)[^&\s"'#]+/gi;
const SECRET_ASSIGNMENT = /\b((?:token|access_token|refresh_token|password|passwd|pwd|secret|apikey|api_key)\s*[=:]\s*)[^\s,;"'&}]+/gi;
const AUTH_HEADER = /\b((?:authorization|cookie|set-cookie)\s*:\s*)[^\r\n]+/gi;
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi;

export function redactLogMessage(value) {
    return String(value ?? '')
        .replace(AUTH_SCHEME, (_, scheme) => `${scheme} [redacted]`)
        .replace(AUTH_HEADER, (_, name) => `${name}[redacted]`)
        .replace(SECRET_QUERY, (_, name) => `${name}[redacted]`)
        .replace(SECRET_ASSIGNMENT, (_, name) => `${name}[redacted]`)
        .slice(0, 8192);
}

const pad = value => String(value).padStart(2, '0');
export function logStamp(value) {
    const date = new Date(value);
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// Test runners set NODE_TEST_CONTEXT/VITEST; keeping their stdout clean also
// keeps the TAP output parseable. Production always defaults to stdout.
export const inTestRunner = () => Boolean(process.env.NODE_TEST_CONTEXT || process.env.VITEST);

export function createLogSink({directory, file, maxBytes, keep, stdout, stream = process.stdout, now = Date.now, onError} = {}) {
    if (!directory) throw new TypeError('日志目录不能为空');
    const disabled = file === false;
    const target = disabled ? null : path.isAbsolute(file || '') ? file : path.join(directory, file || 'logs/coketv.log');
    const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 5 * 1024 * 1024;
    const generations = Number.isSafeInteger(keep) && keep > 0 ? keep : 3;
    const echo = stdout === undefined ? !inTestRunner() : Boolean(stdout);
    let prepared = null;
    let size = 0;
    let queue = Promise.resolve();

    const prepare = () => {
        if (disabled) return Promise.resolve();
        prepared ||= (async () => {
            const dir = path.dirname(target);
            await fs.mkdir(dir, {recursive: true, mode: 0o700});
            await fs.chmod(dir, 0o700).catch(() => {});
            try {
                const stat = await fs.stat(target);
                size = stat.size;
                await fs.chmod(target, 0o600);
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                await fs.writeFile(target, '', {flag: 'a', mode: 0o600});
            }
        })().catch(error => { onError?.(error); });
        return prepared;
    };

    const rotate = async () => {
        for (let index = generations; index > 1; index -= 1) {
            const from = `${target}.${index - 1}`, to = `${target}.${index}`;
            await fs.rm(to, {force: true});
            try { await fs.rename(from, to); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        await fs.rename(target, `${target}.1`).catch(error => { if (error.code !== 'ENOENT') throw error; });
        size = 0;
    };

    const append = async line => {
        await prepare();
        if (disabled) return;
        const bytes = Buffer.byteLength(line);
        if (size + bytes > limit) await rotate();
        await fs.appendFile(target, line, {mode: 0o600});
        size += bytes;
    };

    return {
        file: target,
        write(entry) {
            const record = {time: new Date(now()).toISOString(), level: 'info', ...entry};
            if (record.message !== undefined) record.message = redactLogMessage(record.message);
            const line = `${JSON.stringify(record)}\n`;
            if (echo) { try { stream.write(line); } catch {} }
            queue = queue.then(() => append(line)).catch(error => onError?.(error));
        },
        async flush() { await queue; },
        async close() { await queue; },
    };
}
