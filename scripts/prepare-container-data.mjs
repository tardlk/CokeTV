import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function containerIdentity(environment = process.env) {
    const read = name => {
        const value = environment[name] ?? '1000';
        if (typeof value !== 'string' || !value.length || /[^0-9]/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) {
            throw new Error(`${name} 必须是 1–2147483647 的十进制整数`);
        }
        return Number(value);
    };
    return {uid: read('PUID'), gid: read('PGID')};
}

// This runs before loading any user script or configuration.
export async function prepareContainerData(directory, {uid = 1000, gid = 1000} = {}) {
    directory = path.resolve(directory);
    const protectedDirectories = ['/', '/app', '/etc', '/usr', '/opt', '/home', '/root', '/proc', '/sys', '/dev', '/run', '/tmp', '/var', '/bin', '/sbin'];
    if (protectedDirectories.includes(directory) || ['/etc','/usr','/opt','/home','/root','/proc','/sys','/dev','/bin','/sbin'].some(name => directory.startsWith(name + '/')) || (directory.startsWith('/app/') && directory !== '/app/data' && !directory.startsWith('/app/data/'))) throw new Error('DATA_DIR 必须是 CokeTV 专用数据目录');
    await fs.mkdir(directory, {recursive: true, mode: 0o700});
    const rootStat = await fs.lstat(directory);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('DATA_DIR 必须是实际目录，不能是符号链接');
    let changed = 0;
    const visit = async (file, relative = '') => {
        const stat = await fs.lstat(file);
        // In particular, runtime/node_modules points outside data; never follow it.
        if (stat.isSymbolicLink()) return;
        if (stat.dev !== rootStat.dev || (!stat.isDirectory() && !stat.isFile())) throw new Error('data 内存在其他挂载或特殊文件，请单独检查权限');
        const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | (stat.isDirectory() ? constants.O_DIRECTORY : 0));
        try {
            const current = await handle.stat();
            if (current.dev !== stat.dev || current.ino !== stat.ino) throw new Error('data 在初始化期间发生变化，请停止其他使用该目录的服务');
            if (current.isFile() && current.nlink > 1) throw new Error('data 内存在硬链接，请单独检查权限');
            // A pre-created NAS mount can be 0777, including legacy credentials.
            // Adding owner permissions alone leaves group/other access intact.
            // User runtime helpers may be invoked directly (including plugin venvs).
            // Retain only their existing owner execute bit; credentials/config stay 0600.
            const runtimeHelper = relative.startsWith('runtime/') && !relative.startsWith('runtime/config/') && !relative.startsWith('runtime/json/') && relative !== 'runtime/.plugins.js';
            const mode = current.isDirectory() ? 0o700 : 0o600 | (runtimeHelper ? current.mode & 0o100 : 0);
            if (current.uid !== uid || current.gid !== gid) { await handle.chown(uid, gid); changed++; }
            if ((current.mode & 0o7777) !== mode) { await handle.chmod(mode); changed++; }
            if (current.isDirectory()) {
                // Linux descriptor paths pin each parent while walking, so renaming a
                // parent into a symlink cannot redirect initialization outside data.
                const parent = process.platform === 'linux' ? `/proc/self/fd/${handle.fd}` : file;
                for (const name of await fs.readdir(parent)) await visit(path.join(parent, name), path.posix.join(relative, name));
            }
        } finally { await handle.close(); }
    };
    await visit(directory);
    return changed;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    try {
        // Validate both IDs before touching any data, and return normalized numeric IDs.
        const {uid, gid} = containerIdentity();
        const changed = await prepareContainerData(process.env.DATA_DIR || '/app/data', {uid, gid});
        console.error(`CokeTV：data 权限准备完成（${changed} 项调整），以 UID/GID ${uid}:${gid} 启动`);
        console.log(`${uid}:${gid}`);
    } catch (error) {
        if (/^(PUID|PGID) 必须是/.test(error.message)) console.error(`CokeTV：${error.message}；未初始化 data。`);
        else console.error('CokeTV：data 权限初始化失败。请检查挂载是否可写、NAS ACL 是否允许修改，以及 DATA_DIR 是否为专用目录；不会以 root 启动服务。');
        process.exitCode = 1;
    }
}
