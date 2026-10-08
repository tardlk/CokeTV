// Adapted from SheltonZhu/115driver v1.3.5, pkg/crypto/m115 (MIT).
// Copyright and full upstream notice: LICENSES/115driver.txt.
import {constants, createPublicKey, publicEncrypt, publicDecrypt, randomBytes} from 'node:crypto';

const seed = Buffer.from([
    0xf0, 0xe5, 0x69, 0xae, 0xbf, 0xdc, 0xbf, 0x8a, 0x1a, 0x45, 0xe8, 0xbe, 0x7d, 0xa6, 0x73, 0xb8,
    0xde, 0x8f, 0xe7, 0xc4, 0x45, 0xda, 0x86, 0xc4, 0x9b, 0x64, 0x8b, 0x14, 0x6a, 0xb4, 0xf1, 0xaa,
    0x38, 0x01, 0x35, 0x9e, 0x26, 0x69, 0x2c, 0x86, 0x00, 0x6b, 0x4f, 0xa5, 0x36, 0x34, 0x62, 0xa6,
    0x2a, 0x96, 0x68, 0x18, 0xf2, 0x4a, 0xfd, 0xbd, 0x6b, 0x97, 0x8f, 0x4d, 0x8f, 0x89, 0x13, 0xb7,
    0x6c, 0x8e, 0x93, 0xed, 0x0e, 0x0d, 0x48, 0x3e, 0xd7, 0x2f, 0x88, 0xd8, 0xfe, 0xfe, 0x7e, 0x86,
    0x50, 0x95, 0x4f, 0xd1, 0xeb, 0x83, 0x26, 0x34, 0xdb, 0x66, 0x7b, 0x9c, 0x7e, 0x9d, 0x7a, 0x81,
    0x32, 0xea, 0xb6, 0x33, 0xde, 0x3a, 0xa9, 0x59, 0x34, 0x66, 0x3b, 0xaa, 0xba, 0x81, 0x60, 0x48,
    0xb9, 0xd5, 0x81, 0x9c, 0xf8, 0x6c, 0x84, 0x77, 0xff, 0x54, 0x78, 0x26, 0x5f, 0xbe, 0xe8, 0x1e,
    0x36, 0x9f, 0x34, 0x80, 0x5c, 0x45, 0x2c, 0x9b, 0x76, 0xd5, 0x1b, 0x8f, 0xcc, 0xc3, 0xb8, 0xf5,
]);
const clientXor = Buffer.from([0x78, 0x06, 0xad, 0x4c, 0x33, 0x86, 0x5d, 0x18, 0x4c, 0x01, 0x3f, 0x46]);
const modulus = '8686980c0f5a24c4b9d43020cd2c22703ff3f450756529058b1cf88f09b8602136477198a6e2683149659bd122c33592fdb5ad47944ad1ea4d36c6b172aad6338c3bb6ac6227502d010993ac967d1aef00f0c8e038de2e4d3bc2ec368af2e9f10a6f1eda4f7262f136420c07c331b871bf139f74f3010e3c4fe57df3afb71683';
const platformKey = createPublicKey({key: {kty: 'RSA', n: Buffer.from(modulus, 'hex').toString('base64url'), e: 'AQAB'}, format: 'jwk'});
const fail = () => new Error('115 App 加密数据格式异常');
const derive = (key, size) => Buffer.from(Array.from({length: size}, (_, i) => ((key[i] + seed[size * i]) & 255) ^ seed[size * (size - i - 1)]));
function xor(data, key) {
    const result = Buffer.from(data), offset = result.length % 4;
    for (let i = 0; i < result.length; i++) result[i] ^= key[i < offset ? i % key.length : (i - offset) % key.length];
    return result;
}
export function encodeM115(input, {key = randomBytes(16), publicKey = platformKey} = {}) {
    if (!Buffer.isBuffer(key) || key.length !== 16 || typeof input !== 'string' || Buffer.byteLength(input) > 65536) throw fail();
    const transformed = xor(xor(Buffer.from(input), derive(key, 4)).reverse(), clientXor);
    const data = Buffer.concat([key, transformed]), encrypted = [];
    for (let i = 0; i < data.length; i += 117) encrypted.push(publicEncrypt({key: publicKey, padding: constants.RSA_PKCS1_PADDING}, data.subarray(i, i + 117)));
    return {data: Buffer.concat(encrypted).toString('base64'), key: Buffer.from(key)};
}
export function decodeM115(input, key, {publicKey = platformKey} = {}) {
    if (typeof input !== 'string' || input.length > 2 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input) || !Buffer.isBuffer(key) || key.length !== 16) throw fail();
    const encrypted = Buffer.from(input, 'base64'), blocks = [];
    if (!encrypted.length || encrypted.length % 128) throw fail();
    for (let i = 0; i < encrypted.length; i += 128) {
        let block;
        try { block = publicDecrypt({key: publicKey, padding: constants.RSA_NO_PADDING}, encrypted.subarray(i, i + 128)); }
        catch { throw fail(); }
        const end = block.indexOf(0, 2);
        if (block[0] !== 0 || ![1, 2].includes(block[1]) || end < 10 || (block[1] === 1 && !block.subarray(2, end).every(byte => byte === 255))) throw fail();
        blocks.push(block.subarray(end + 1));
    }
    const data = Buffer.concat(blocks);
    if (data.length < 16) throw fail();
    return xor(xor(data.subarray(16), derive(data.subarray(0, 16), 12)).reverse(), derive(key, 4)).toString('utf8');
}
