import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const workflow = await fs.readFile(process.env.RELEASE_TEST_WORKFLOW || new URL('../.github/workflows/docker.yml',import.meta.url),'utf8');
const dockerfile = await fs.readFile(process.env.RELEASE_TEST_DOCKERFILE || new URL('../Dockerfile',import.meta.url),'utf8');
test('发布条件：候选失败/PR/手动默认 dry-run/工作分支均不能发布', () => {
    const condition = workflow.match(/\n  publish:\n[\s\S]*?\n    if: >-\n([\s\S]*?)\n    runs-on:/)?.[1];
    assert.ok(condition,'发布必须有明确的候选门禁条件');
    const allowed = (event,ref,dry_run,result='success') => vm.runInNewContext(condition.trim(),{
        needs:{candidate:{result}},github:{event_name:event,ref},inputs:{dry_run},startsWith:(value,prefix)=>value.startsWith(prefix),
    });
    for (const result of ['failure','cancelled','skipped']) for (const event of ['push','workflow_dispatch','pull_request']) assert.equal(allowed(event,'refs/heads/main',false,result),false);
    assert.equal(allowed('pull_request','refs/heads/main',false),false);
    assert.equal(allowed('workflow_dispatch','refs/heads/main',true),false);
    assert.equal(allowed('workflow_dispatch','refs/heads/work/test',false),false);
    assert.equal(allowed('push','refs/heads/work/test',false),false);
    assert.equal(allowed('push','refs/heads/main',undefined),true);
    assert.equal(allowed('push','refs/tags/v1.0.0',undefined),true);
    assert.equal(allowed('workflow_dispatch','refs/heads/main',false),true);
    assert.match(workflow,/dry_run:\n[\s\S]*?type: boolean\n\s+default: true/);
});
test('候选验收只读；发布必须校验同一 artifact/image ID/SHA，且无重建', () => {
    const candidate = workflow.split('\n  candidate:\n')[1]?.split('\n  publish:\n')[0];
    const publish = workflow.split('\n  publish:\n')[1];
    assert.ok(candidate && publish);
    assert.doesNotMatch(candidate,/packages: write|docker\/login-action|docker push/);
    assert.match(candidate,/platforms: linux\/amd64/);
    assert.match(candidate,/node scripts\/container-matrix.mjs/);
    assert.ok(candidate.indexOf('container-matrix.mjs') < candidate.indexOf('docker save'));
    assert.match(publish,/needs: candidate/); assert.match(publish,/packages: write/);
    assert.doesNotMatch(publish,/build-push-action|docker build/);
    const login = publish.indexOf('docker/login-action');
    for (const invariant of ['source-sha.txt','EXPECTED_TAR_SHA256','sha256sum -c','docker load','EXPECTED_IMAGE_ID','org.opencontainers.image.revision']) assert.ok(publish.indexOf(invariant)>=0 && publish.indexOf(invariant)<login,invariant+' 必须在登录前检查');
    assert.match(publish,/docker tag coketv-candidate:verified/);
});
test('镜像发行包含正式 verify CLI，测试样本与容器验收脚本只临时注入', () => {
    const final = dockerfile.split(/\nFROM /).at(-1);
    const copies = [...final.matchAll(/^COPY (.+)$/gm)].map(match=>match[1]);
    assert.ok(copies.some(line=>line.includes('scripts/verify.mjs')),'package verify 的正式入口必须在镜像');
    assert.ok(!copies.some(line=>/container-smoke|image-verify|container-matrix|tests/.test(line)),'测试代码不能预置进发行镜像');
    assert.match(final,/COPY engine \.\/engine/);
    assert.match(final,/USER node/);
});
