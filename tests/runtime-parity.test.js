import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {probe} from '../scripts/source-parity-probe.mjs';

test('固定原版2.0.6 HTTP响应：冷启动、基类、跨规则、参数和大PHP响应保持一致', async()=>{
    const expected=JSON.parse(await fs.readFile(new URL('./fixtures/source-parity/original-2.0.6.json',import.meta.url),'utf8'));
    const actual=await probe();
    assert.equal(actual.length,expected.length,'源契约案例必须与原版快照一一对应');
    for(const [index,row]of actual.entries())assert.deepEqual(row,expected[index],row.case);
});
