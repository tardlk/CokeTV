import {test} from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import {assertTargetAllowed, isInternalAddress} from '../src/ssrf.js';

test('R3 IPv4/IPv6 按地址值判定内网，包括点分/十六进制映射和完整展开形式', () => {
    const internal = ['0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.0.1', '169.254.1.2', '172.16.1.2', '192.168.1.2', '224.1.2.3', '::', '::1', '0:0:0:0:0:0:0:1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:c0a8:102'];
    for (const address of internal) assert.equal(isInternalAddress(address), true, address);
    for (const address of ['8.8.8.8', '::ffff:8.8.8.8', '::ffff:808:808', '2606:4700:4700::1111']) assert.equal(isInternalAddress(address), false, address);
});

test('R3 元数据地址及映射形式永不放行，包括 DNS 返回、白名单和本机 origin 豁免', async t => {
    const addresses = ['169.254.169.254', '100.100.100.200', '169.254.170.2', 'fd00:ec2::254', 'fd00:0ec2:0:0:0:0:0:0254', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:6464:64c8'];
    for (const address of addresses) {
        const url = `http://${address.includes(':') ? `[${address}]` : address}/`;
        await assert.rejects(assertTargetAllowed(url, {allowPrivate: true, allowlist: [address], selfOrigins: [url]}), {statusCode: 403}, address);
    }
    t.mock.method(dns, 'lookup', async () => [{address: '::ffff:a9fe:a9fe', family: 6}]);
    await assert.rejects(assertTargetAllowed('http://dns.fixture.invalid/', {allowPrivate: true}), {statusCode: 403});
    await assert.rejects(assertTargetAllowed('http://metadata.google.internal./'), {statusCode: 403});
});

test('R3 DNS 返回的映射内网不能绕过关闭内网；IP/CIDR 名单只返回获准地址', async t => {
    t.mock.method(dns, 'lookup', async () => [{address: '::ffff:7f00:1', family: 6}]);
    await assert.rejects(assertTargetAllowed('http://dns.fixture.invalid/', {allowPrivate: false}), {statusCode: 403});
    t.mock.method(dns, 'lookup', async () => [{address: '8.8.8.8', family: 4}, {address: '1.1.1.1', family: 4}]);
    const addresses = await assertTargetAllowed('http://dns.fixture.invalid/', {allowPrivate: false, allowlist: ['8.8.8.0/24']});
    assert.deepEqual(addresses, [{address: '8.8.8.8', family: 4}]);
    const ipv6 = await assertTargetAllowed('http://[2606:4700:4700::1111]/', {allowPrivate: false, allowlist: ['2606:4700::/32']});
    assert.equal(ipv6[0].family, 6);
    await assert.rejects(assertTargetAllowed('http://[::ffff:7f00:1]/', {allowPrivate: false, allowlist: ['127.0.0.0/8']}), {statusCode: 403});
});

test('R4 空或无效 DNS 结果拒绝，混合公网/内网结果不能在关闭内网时放行', async t => {
    for (const answers of [[], [{address: 'not-an-ip', family: 4}], [{address: '8.8.8.8', family: 4}, {address: '::ffff:7f00:1', family: 6}]]) {
        t.mock.method(dns, 'lookup', async () => answers);
        await assert.rejects(assertTargetAllowed('http://dns.fixture.invalid/', {allowPrivate: false}), {statusCode: 403});
    }
});
