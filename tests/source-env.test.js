import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {withSourceEnvironment, sourceEnvironment, writeSourceVariables, readSourceVariables} from '../engine/utils/source-env.js';

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
