import util from 'util';
import {redactSourceSecrets} from '../utils/source-env.js';

// 兼容原引擎的日志入口，运行内核不创建 HTTP/WS 服务。
const write = (level, args) => {
    const message = redactSourceSecrets(util.format(...args));
    if (process.send) process.send({kind: 'log', level, message});
    else console[level === 'error' ? 'error' : 'log'](message);
};
export const fastify = {server: {address: () => ({port: Number(process.env.DRPY_HTTP_PORT) || 5758})}, log: {
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
    debug: (...args) => write('debug', args),
}};
