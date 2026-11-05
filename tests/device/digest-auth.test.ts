import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDigestAuth, parseDigestChallenge } from '../../src/device/digest-auth.js';

describe('digest authentication', () => {
    it('parses a Shelly HTTP challenge with a base64 nonce', () => {
        expect(parseDigestChallenge('Digest qop="auth", realm="shelly-test", nonce="AA+/==", algorithm=SHA-256'))
            .toEqual({ realm: 'shelly-test', nonce: 'AA+/==' });
    });

    it('handles case-insensitive field names, quoted commas, and escaped quotes', () => {
        expect(parseDigestChallenge(String.raw`digest REALM="shelly,\"test", NONCE="123", QOP="auth-int, auth", ALGORITHM="sha-256"`))
            .toEqual({ realm: 'shelly,"test', nonce: '123' });
    });

    it.each([
        null,
        'Basic realm="test"',
        'Digest realm="test"',
        'Digest realm="", nonce="abc"',
        'Digest realm="test", nonce="abc", algorithm=MD5',
        'Digest realm="test", nonce="abc", qop="auth-int"',
    ])('rejects an unsupported challenge: %s', header => {
        expect(() => parseDigestChallenge(header)).toThrow(expect.objectContaining({ code: 'DEVICE_AUTH' }));
    });

    it('generates the SHA-256 RPC response with the documented fields', () => {
        expect(createDigestAuth(
            { host: 'unused', username: 'admin', password: 'mysecretpassword' },
            { realm: 'shelly-test', nonce: 'abcd1234' }, 1, 313273957,
        )).toEqual({
            realm: 'shelly-test', nonce: 'abcd1234', username: 'admin', cnonce: 313273957,
            nc: '00000001', algorithm: 'SHA-256',
            response: '67409a5b648ff1d3b45c307525a4a3da588809665314012c34f82e5d4ef99f1f',
        });
    });

    it('hashes the real method and URI for HTTP transport', () => {
        const target = { host: 'unused', username: 'admin', password: 'mysecretpassword' };
        const challenge = { realm: 'shelly-test', nonce: 'abcd1234' };
        const hash = (value: string) => createHash('sha256').update(value).digest('hex');
        const ha1 = hash('admin:shelly-test:mysecretpassword');
        const auth = createDigestAuth(target, challenge, 1, 313273957, { method: 'POST', uri: '/rpc' });
        expect(auth.response).toBe(hash(`${ha1}:abcd1234:00000001:313273957:auth:${hash('POST:/rpc')}`));
        expect(auth.response).not.toBe(createDigestAuth(target, challenge, 1, 313273957).response);
    });

    it('encodes the nonce count as eight hexadecimal digits', () => {
        const auth = createDigestAuth({ host: 'unused', username: 'admin', password: '' }, { realm: 'r', nonce: 'n' }, 10);
        expect(auth.nc).toBe('0000000a');
        expect(Number.isInteger(auth.cnonce)).toBe(true);
    });

    it('requires a password and a valid nonce count', () => {
        expect(() => createDigestAuth({ host: 'unused', username: 'admin' }, { realm: 'r', nonce: 'n' }, 1))
            .toThrow(expect.objectContaining({ code: 'DEVICE_AUTH' }));
        for (const count of [0, -1, 1.5, 0x100000000]) {
            expect(() => createDigestAuth({ host: 'unused', username: 'admin', password: 'x' }, { realm: 'r', nonce: 'n' }, count))
                .toThrow(expect.objectContaining({ code: 'DEVICE_AUTH' }));
        }
    });
});
