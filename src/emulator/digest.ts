import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sha256 } from '../core/hash.js';
import { isRecord } from '../core/validation.js';

export class DigestVerifier {
    private readonly unusedNonces = new Map<string, { count: number; expires: number }>();
    private readonly usedNonces = new Map<string, { count: number; expires: number }>();

    constructor(private readonly realm: string, private readonly password?: string) {}

    challenge(): string {
        const now = Date.now();
        for (const nonces of [this.unusedNonces, this.usedNonces]) {
            for (const [nonce, state] of nonces) if (state.expires <= now) nonces.delete(nonce);
        }
        if (this.unusedNonces.size >= 1024) this.unusedNonces.delete(this.unusedNonces.keys().next().value!);
        const nonce = randomBytes(24).toString('hex');
        this.unusedNonces.set(nonce, { count: 0, expires: now + 300_000 });
        const realm = this.realm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `Digest qop="auth", realm="${realm}", nonce="${nonce}", algorithm=SHA-256`;
    }

    verify(value: unknown, method: string, uri: string, header = false): boolean {
        if (!this.password) return true;
        let fields: Record<string, unknown>;
        if (header) {
            if (typeof value !== 'string' || !/^Digest\s/i.test(value)) return false;
            fields = Object.fromEntries([...value.slice(7).matchAll(/([\w-]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^,\s]+))/g)]
                .map(match => [match[1].toLowerCase(), match[2]?.replace(/\\(.)/g, '$1') ?? match[3]]));
        } else {
            if (!isRecord(value)) return false;
            fields = value;
        }
        const { username, realm, nonce, nc, cnonce, response, algorithm } = fields;
        if (username !== 'admin' || realm !== this.realm || algorithm !== 'SHA-256'
            || typeof nonce !== 'string' || typeof nc !== 'string' || !/^[\da-f]{8}$/i.test(nc)
            || typeof response !== 'string' || !/^[\da-f]{64}$/i.test(response)
            || (typeof cnonce !== 'string' && !Number.isSafeInteger(cnonce))
            || String(cnonce).length === 0 || String(cnonce).length > 256
            || (header && (fields.qop !== 'auth' || fields.uri !== uri))) return false;
        const state = this.usedNonces.get(nonce) ?? this.unusedNonces.get(nonce);
        const count = Number.parseInt(nc, 16);
        if (!state || state.expires <= Date.now() || count <= state.count) return false;
        const ha1 = sha256(`admin:${this.realm}:${this.password}`);
        const requests = header ? [`${method}:${uri}`] : [`${method}:${uri}`, 'dummy_method:dummy_uri'];
        const valid = requests.some(request => {
            const expected = sha256(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${sha256(request)}`);
            return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(response, 'hex'));
        });
        if (valid) {
            state.count = count;
            this.unusedNonces.delete(nonce);
            this.usedNonces.set(nonce, state);
        }
        return valid;
    }
}
