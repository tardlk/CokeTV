import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// 开发说明只指向命令输出；避免新增测试/文件后固定计数再次漂移。
test('开发说明的当前验证不维护固定测试或语法文件计数', async () => {
    const document = await fs.readFile(new URL('../docs/DEVELOPMENT.md', import.meta.url), 'utf8');
    const section = document.split('## 当前验证\n')[1]?.split('\n## ')[0];
    assert.ok(section, '缺少当前验证说明');
    assert.doesNotMatch(section, /\d+\s*(?:项测试|个文件语法|后端|UI)/);
    assert.match(section, /npm test/);
    assert.match(section, /npm run check/);
});
