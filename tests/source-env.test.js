import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {withSourceEnvironment, sourceEnvironment, writeSourceVariables, readSourceVariables, redactSourceSecrets} from '../engine/utils/source-env.js';

test('源环境上下文跨异步隔离，不通过共享开关切换', async () => {
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'drpy-env-'));
    try {
        const a=path.join(directory,'a.json'),b=path.join(directory,'b.json');
        writeSourceVariables(a,{cookie:'A'}); writeSourceVariables(b,{cookie:'B'});
        const run=(file,delay)=>withSourceEnvironment({file},async()=>{
            await new Promise(resolve=>setTimeout(resolve,delay));
            return readSourceVariables(sourceEnvironment().file).cookie;
        });
        assert.deepEqual(await Promise.all([run(a,20),run(b,1),run(a,5)]),['A','B','A']);
        assert.equal(sourceEnvironment(),undefined);
    }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('R5 诊断遮蔽原始/编码参数、JSON 标量、嵌套 ENV 与被本源覆盖的全局值', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'coketv-redaction-'));
    try {
        const file = path.join(directory, 'config/source-env/source.json');
        writeSourceVariables(file, {alias: 'source-secret-fixture', nested: {token: 'nested-source-fixture'}});
        await fs.writeFile(path.join(directory, 'config/env.json'), JSON.stringify({alias: 'overridden-global-fixture', nested: {token: 'nested-global-fixture'}, short: 'qz', pin: 743291}));
        const params = JSON.stringify({cookie: 'parameter-secret-fixture', id: 918273, short: 'xyz'});
        const secrets = [params, 'parameter-secret-fixture', '918273', 'xyz', 'source-secret-fixture', 'nested-source-fixture', 'overridden-global-fixture', 'nested-global-fixture', 'qz', '743291', file, await fs.realpath(file)];
        const text = 'fixture marker ' + secrets.flatMap(value => [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]).join(' | ');
        const scope = {file, params, privatePaths: [directory]};
        const redacted = withSourceEnvironment(scope, () => redactSourceSecrets(text));
        for (const value of secrets) for (const form of [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]) assert.ok(!redacted.includes(form), `未隐藏：${form}`);
        assert.match(redacted, /fixture marker/); assert.match(redacted, /已隐藏/);
        await fs.writeFile(path.join(directory, 'config/env.json'), 'invalid JSON');
        assert.equal(withSourceEnvironment(scope, () => redactSourceSecrets('source-secret-fixture parameter-secret-fixture')), '[已隐藏] [已隐藏]');
        assert.equal(redactSourceSecrets('public marker'), 'public marker');
        const surrogate = String.fromCharCode(0xd800);
        assert.equal(redactSourceSecrets('fixture marker ' + surrogate, {params: JSON.stringify({token: surrogate})}), 'fixture marker [已隐藏]');
    } finally { await fs.rm(directory, {recursive: true, force: true}); }
});
