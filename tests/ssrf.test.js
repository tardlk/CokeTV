import {test} from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import net from 'node:net';
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

test('H1 链路本地整段（169.254.0.0/16）与云 metadata 永久拒绝，任何开关/白名单/本机豁免都无法放行', async () => {
    // 169.254.0.23（腾讯云）、169.254.169.123（AWS TimeSync）都曾被逐地址表遗漏。
    const blocked = ['169.254.0.23', '169.254.169.254', '169.254.170.2', '169.254.169.123', '169.254.1.1',
        '::ffff:169.254.0.23', '::ffff:a9fe:17', '100.100.100.200', 'fd00:ec2::254'];
    for (const address of blocked) {
        const url = `http://${address.includes(':') ? `[${address}]` : address}/`;
        const variants = [
            {allowPrivate: true},
            {allowPrivate: false},
            {allowPrivate: true, allowlist: [address]},
            {allowPrivate: true, allowlist: ['169.254.0.0/16']},
            {allowPrivate: false, allowlist: ['169.254.0.0/16']},
            {allowPrivate: true, selfOrigins: [url]},
        ];
        for (const options of variants) {
            await assert.rejects(assertTargetAllowed(url, options), {statusCode: 403}, `${address} ${JSON.stringify(options)}`);
        }
    }
});

test('H1 DNS 解析到链路本地地址同样被永久拒绝，与 IP 直连一致', async t => {
    for (const answer of ['169.254.0.23', '::ffff:a9fe:17', '169.254.169.123']) {
        t.mock.method(dns, 'lookup', async () => [{address: answer, family: net.isIP(answer)}]);
        await assert.rejects(assertTargetAllowed('http://dns.fixture.invalid/', {allowPrivate: true, allowlist: ['169.254.0.0/16'], selfOrigins: ['http://dns.fixture.invalid/']}), {statusCode: 403}, answer);
    }
});

test('H2 非全局可路由网段在严格模式下不被当作普通公网目标，宽松模式下仍放行以保持 NAS 兼容', async () => {
    const special = ['192.0.0.5', '192.0.2.5', '192.88.99.5', '198.18.0.5', '198.19.255.5', '198.51.100.5', '203.0.113.5'];
    for (const address of special) {
        assert.equal(isInternalAddress(address), true, address);
        await assert.rejects(assertTargetAllowed(`http://${address}/`, {allowPrivate: false}), {statusCode: 403}, `${address} 严格模式`);
        await assert.doesNotReject(assertTargetAllowed(`http://${address}/`, {allowPrivate: true}), `${address} 宽松模式`);
    }
    // 映射形式同样命中分类。
    assert.equal(isInternalAddress('::ffff:198.18.0.5'), true);
    assert.equal(isInternalAddress('::ffff:c612:5'), true);
    // 边界外地址必须保持公网可路由，避免整段误伤。
    for (const address of ['192.0.1.5', '192.0.3.5', '198.20.0.5', '198.51.101.5', '203.0.114.5', '8.8.8.8', '2606:4700:4700::1111']) {
        assert.equal(isInternalAddress(address), false, address);
    }
});

test('H2 特殊网段不因 CIDR 白名单被重新放行（白名单不能绕过内网策略）', async () => {
    for (const [address, entry] of [['192.0.2.5', '192.0.2.0/24'], ['198.18.0.5', '198.18.0.0/15'], ['203.0.113.5', '203.0.113.0/24']]) {
        await assert.rejects(assertTargetAllowed(`http://${address}/`, {allowPrivate: false, allowlist: [entry]}), {statusCode: 403}, address);
    }
});

