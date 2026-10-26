import path from 'node:path';
import {sourceEnvironment, readSourceVariables, writeSourceVariables} from './source-env.js';

const globalFile = () => path.join(process.env.ROOT || process.cwd(), 'config/env.json');
const targetFile = () => sourceEnvironment()?.file || globalFile();
const checkKey = key => {
    if (typeof key !== 'string' || !key || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('环境变量键名无效');
};
export const ENV = {
    get(key, fallback = '', object = false) {
        const file = sourceEnvironment()?.file;
        const values = {...readSourceVariables(globalFile()), ...(file ? readSourceVariables(file) : {})};
        if (!key) return values;
        let value = Object.hasOwn(values, key) ? values[key] : fallback;
        if (object && typeof value !== 'object') { try { value = JSON.parse(value); } catch { value = {}; } }
        return value;
    },
    set(key, value = '', object = false) {
        checkKey(key);
        if (object && typeof value !== 'object') { try { value = JSON.parse(value); } catch { value = {}; } }
        const file = targetFile(), values = readSourceVariables(file);
        values[key] = value;
        writeSourceVariables(file, values);
    },
    delete(key) { checkKey(key); const file = targetFile(), values = readSourceVariables(file); delete values[key]; writeSourceVariables(file, values); },
    clearCache() {},
};
