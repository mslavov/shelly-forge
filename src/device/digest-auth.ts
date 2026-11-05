import { randomInt } from 'node:crypto';
import type { DeviceTarget } from '../core/config.js';
import { ForgeError } from '../core/errors.js';
import { sha256 } from '../core/hash.js';

export interface DigestChallenge {
    realm: string;
    nonce: string;
}

export interface DigestAuth extends DigestChallenge {
    username: string;
    cnonce: number;
    nc: string;
    response: string;
    algorithm: 'SHA-256';
}

export interface DigestRequest {
    method: string;
    uri: string;
}

// Shelly hashes the real HTTP method and URI for HTTP transport; WebSocket RPC and older
// firmware use these placeholder values instead.
export const LEGACY_DIGEST_REQUEST: DigestRequest = { method: 'dummy_method', uri: 'dummy_uri' };

export const AUTH_HINT = 'Set SHELLY_PASSWORD or the password field in solutions.config.json to the device password.';

export function parseDigestChallenge(header: string | null): DigestChallenge {
    if (!header || !/^Digest\s/i.test(header)) {
        throw new ForgeError('DEVICE_AUTH', 'Device did not provide a SHA-256 digest challenge', { hint: AUTH_HINT });
    }
    const fields = new Map<string, string>();
    const pattern = /([\w-]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^,\s]+))/g;
    for (const match of header.slice(7).matchAll(pattern)) {
        fields.set(match[1].toLowerCase(), match[2]?.replace(/\\(.)/g, '$1') ?? match[3]);
    }
    const realm = fields.get('realm');
    const nonce = fields.get('nonce');
    const algorithm = fields.get('algorithm');
    const qop = fields.get('qop');
    if (!realm || !nonce || (algorithm && algorithm.toUpperCase() !== 'SHA-256')
        || (qop && !qop.split(',').some(value => value.trim().toLowerCase() === 'auth'))) {
        throw new ForgeError('DEVICE_AUTH', 'Device provided an unsupported digest challenge', { hint: AUTH_HINT });
    }
    return { realm, nonce };
}

export function createDigestAuth(
    target: DeviceTarget,
    challenge: DigestChallenge,
    nonceCount: number,
    cnonce: number = randomInt(0, 0x80000000),
    request: DigestRequest = LEGACY_DIGEST_REQUEST,
): DigestAuth {
    if (target.password === undefined) {
        throw new ForgeError('DEVICE_AUTH', 'Device requires a password', { hint: AUTH_HINT });
    }
    if (!Number.isInteger(nonceCount) || nonceCount < 1 || nonceCount > 0xffffffff) {
        throw new ForgeError('DEVICE_AUTH', 'Digest nonce count is out of range');
    }
    const nc = nonceCount.toString(16).padStart(8, '0');
    const ha1 = sha256(`${target.username}:${challenge.realm}:${target.password}`);
    const ha2 = sha256(`${request.method}:${request.uri}`);
    return {
        ...challenge,
        username: target.username,
        cnonce,
        nc,
        response: sha256(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:auth:${ha2}`),
        algorithm: 'SHA-256',
    };
}
