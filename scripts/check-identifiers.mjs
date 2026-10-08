import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {parse, compileScript} from 'vue/compiler-sfc';

// Check unresolved names without imposing TypeScript types on legacy APIs.
// Engine rule helpers deliberately inject globals, so only the host, web and
// the two gateways owned by this host are included here.
export function undefinedIdentifiers(files) {
    const virtual = new Map();
    const roots = files.map(file => {
        file = path.resolve(file);
        if (!file.endsWith('.vue')) return file;
        const {descriptor} = parse(fs.readFileSync(file, 'utf8'), {filename: file});
        const name = file + (descriptor.script?.lang === 'ts' || descriptor.scriptSetup?.lang === 'ts' ? '.ts' : '.js');
        virtual.set(name, descriptor.script || descriptor.scriptSetup ? compileScript(descriptor, {id: file, inlineTemplate: true}).content : '');
        return name;
    });
    const options = {allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, types: ['node']};
    const host = ts.createCompilerHost(options), read = host.readFile, exists = host.fileExists;
    host.readFile = file => virtual.has(file) ? virtual.get(file) : read(file);
    host.fileExists = file => virtual.has(file) || exists(file);
    const program = ts.createProgram(roots, options, host), errors = [];
    for (const file of roots) {
        const source = program.getSourceFile(file);
        for (const error of program.getSemanticDiagnostics(source)) {
            if (![2304, 2552].includes(error.code)) continue;
            errors.push({file: virtual.has(file) ? file.replace(/\.(?:js|ts)$/, '') : file, message: ts.flattenDiagnosticMessageText(error.messageText, ' ')});
        }
    }
    return errors;
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const files = ['src', 'scripts', 'web'].flatMap(root => fs.readdirSync(root, {recursive: true}).filter(file => /\.(?:js|cjs|mjs|ts|vue)$/.test(file)).map(file => path.join(root, file)));
    files.push('engine/controllers/ftp-proxy.js', 'engine/controllers/webdav-proxy.js');
    const errors = undefinedIdentifiers(files);
    for (const error of errors) console.error(`${error.file}: ${error.message}`);
    if (errors.length) process.exitCode = 1;
    else console.log(`未定义变量检查通过：${files.length} 个文件（Vue 含 script setup 内联模板）`);
}
