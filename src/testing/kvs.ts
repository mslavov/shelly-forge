import { createHash } from 'node:crypto';
import { KVS_LIMITS } from '../core/runtime-profile.js';
import { copyJson, RpcError } from './errors.js';

interface Item { value: unknown; etag: string }

function keyParam(params: Record<string, unknown>): string {
    if (typeof params.key !== 'string' || !params.key.length) throw new RpcError(-103, 'key must be a non-empty string');
    if (Buffer.byteLength(params.key) > KVS_LIMITS.maxKeyLength) {
        throw new RpcError(-103, `KVS maxKeyLength limit exceeded (${KVS_LIMITS.maxKeyLength})`);
    }
    return params.key;
}

function matcher(pattern: unknown): RegExp {
    if (pattern === undefined) return /^.*$/i;
    if (typeof pattern !== 'string') throw new RpcError(-103, 'match must be a string');
    let expression = '';
    for (const char of pattern) {
        if (char === '*') expression += '.*';
        else if (char === '?') expression += '.';
        else if (char === ',') expression += '|';
        else expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^(?:${expression})$`, 'i');
}

export class KvsStore {
    private readonly items = new Map<string, Item>();
    private revision = 0;

    constructor(initial: Record<string, string>) {
        for (const [key, value] of Object.entries(initial)) this.call('KVS.Set', { key, value });
    }

    private checkEtag(key: string, etag: unknown): void {
        if (etag === undefined) return;
        if (typeof etag !== 'string') throw new RpcError(-103, 'etag must be a string');
        const existing = this.items.get(key);
        if (!existing) throw new RpcError(-105, `Key not found: ${key}`);
        if (existing.etag !== etag) throw new RpcError(-109, `etag does not match: ${key}`);
    }

    call(method: string, params: Record<string, unknown>): unknown {
        if (method === 'KVS.List' || method === 'KVS.GetMany') {
            const pattern = matcher(params.match);
            const keys = Array.from(this.items.keys()).filter(key => pattern.test(key));
            if (method === 'KVS.List') {
                return { keys: Object.fromEntries(keys.map(key => [key, { etag: this.items.get(key)!.etag }])), rev: this.revision };
            }
            const offset = params.offset ?? 0;
            if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
                throw new RpcError(-103, 'offset must be a non-negative integer');
            }
            return { items: Object.fromEntries(keys.slice(offset).map(key => [key, copyJson(this.items.get(key)!)])), offset, total: keys.length };
        }
        const key = keyParam(params);
        if (method === 'KVS.Get') {
            const item = this.items.get(key);
            if (!item) throw new RpcError(-105, `Key not found: ${key}`);
            return copyJson(item);
        }
        this.checkEtag(key, params.etag);
        if (method === 'KVS.Delete') {
            if (!this.items.delete(key)) throw new RpcError(-105, `Key not found: ${key}`);
            return { rev: ++this.revision };
        }
        let encoded: string | undefined;
        try { encoded = JSON.stringify(params.value); } catch { throw new RpcError(-103, 'value must be JSON serializable'); }
        if (encoded === undefined) throw new RpcError(-103, 'value must be JSON serializable');
        const valueLength = Buffer.byteLength(typeof params.value === 'string' ? params.value : encoded);
        if (valueLength > KVS_LIMITS.maxValueLength) {
            throw new RpcError(-103, `KVS maxValueLength limit exceeded (${KVS_LIMITS.maxValueLength})`);
        }
        if (!this.items.has(key) && this.items.size >= KVS_LIMITS.maxKeys) {
            throw new RpcError(-108, `KVS maxKeys limit exceeded (${KVS_LIMITS.maxKeys})`);
        }
        const etag = createHash('md5').update(key).update('\0').update(encoded).digest('base64');
        this.items.set(key, { value: JSON.parse(encoded), etag });
        return { etag, rev: ++this.revision };
    }

    get(key: string): string | undefined {
        const item = this.items.get(key);
        if (!item) return undefined;
        return typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
    }

    entries(): Record<string, string> {
        return Object.fromEntries(Array.from(this.items.keys(), key => [key, this.get(key)!]));
    }

    get rev(): number { return this.revision; }
}
