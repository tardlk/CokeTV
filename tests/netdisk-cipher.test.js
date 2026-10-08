import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, privateDecrypt, privateEncrypt, constants} from 'node:crypto';
import {encodeM115, decodeM115} from '../src/netdisk/m115.js';

test('115 App 请求使用随机密钥、分块 RSA；非法响应拒绝解码', () => {
    const keys = generateKeyPairSync('rsa', {modulusLength: 1024});
    const source = JSON.stringify({share_code: 'fixture', receive_code: 'AB12', file_id: '9007199254740993'});
    const a = encodeM115(source, {publicKey: keys.publicKey});
    const b = encodeM115(source, {publicKey: keys.publicKey});
    assert.equal(a.key.length, 16); assert.notDeepEqual(a.key, b.key); assert.notEqual(a.data, b.data);
    const encrypted = Buffer.from(a.data, 'base64');
    assert.equal(encrypted.length % 128, 0);
    const blocks = [];
    for (let i = 0; i < encrypted.length; i += 128) {
        const raw = privateDecrypt({key: keys.privateKey, padding: constants.RSA_NO_PADDING}, encrypted.subarray(i, i + 128));
        assert.equal(raw[0], 0); assert.equal(raw[1], 2);
        blocks.push(raw.subarray(raw.indexOf(0, 2) + 1));
    }
    assert.ok(Buffer.concat(blocks).subarray(0, 16).equals(a.key));
    assert.equal(encodeM115('x'.repeat(500)).data.length > 128, true);
    for (const bad of ['!', 'AAAA', Buffer.alloc(128).toString('base64')]) assert.throws(() => decodeM115(bad, a.key));
    assert.throws(() => encodeM115(source, {key: Buffer.alloc(1)}));
});

// Independently form a server reply with a test-only RSA private key. No live
// signed download URL, account credential or platform private key is a fixture.
test('115 App 响应公钥解码、双方 XOR 密钥和分块顺序正确', () => {
    const keys = generateKeyPairSync('rsa', {modulusLength: 1024});
    const clientKey = Buffer.alloc(16), serverKey = Buffer.alloc(16);
    const clientXor = Buffer.from([0x8d, 0xa5, 0xa5, 0x8d]);
    const serverXor = Buffer.from([0xac, 0x82, 0x21, 0x14, 0xc1, 0x58, 0x58, 0xc1, 0x14, 0x21, 0x82, 0xac]);
    // deriveKey(zero,12) fixture from the published 115 protocol table.
    const plaintext = Buffer.from(JSON.stringify({url: {url: 'https://fixture.invalid/video.mp4?signature=' + 'x'.repeat(200)}}));
    const xor = (data, key) => {
        const copy = Buffer.from(data), offset = data.length % 4;
        for (let i = 0; i < copy.length; i++) copy[i] ^= key[i < offset ? i % key.length : (i - offset) % key.length];
        return copy;
    };
    const transformed = xor(xor(plaintext, clientXor).reverse(), serverXor);
    const payload = Buffer.concat([serverKey, transformed]), chunks = [];
    for (let i = 0; i < payload.length; i += 117) chunks.push(privateEncrypt({key: keys.privateKey, padding: constants.RSA_PKCS1_PADDING}, payload.subarray(i, i + 117)));
    assert.equal(decodeM115(Buffer.concat(chunks).toString('base64'), clientKey, {publicKey: keys.publicKey}), plaintext.toString());
});
