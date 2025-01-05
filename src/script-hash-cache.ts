import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export class ScriptHashCache {
    private static cache: Map<string, string> = new Map();
    private static readonly CACHE_DIR = 'build-cache';
    private static readonly CACHE_FILE = join(ScriptHashCache.CACHE_DIR, 'script-hashes.json');

    private static loadCache(): void {
        try {
            if (!existsSync(ScriptHashCache.CACHE_FILE)) {
                return;
            }
            const data = readFileSync(ScriptHashCache.CACHE_FILE, 'utf8');
            const json = JSON.parse(data);
            ScriptHashCache.cache = new Map(Object.entries(json));
        } catch (error) {
            console.warn('Failed to load script hash cache:', error);
        }
    }

    private static saveCache(): void {
        try {
            mkdirSync(ScriptHashCache.CACHE_DIR, { recursive: true });
            const json = Object.fromEntries(ScriptHashCache.cache);
            writeFileSync(ScriptHashCache.CACHE_FILE, JSON.stringify(json, null, 2));
        } catch (error) {
            console.warn('Failed to save script hash cache:', error);
        }
    }

    static getHash(code: string): string {
        return createHash('md5').update(code).digest('hex');
    }

    static hasChanged(code: string, name: string): boolean {
        if (ScriptHashCache.cache.size === 0) {
            ScriptHashCache.loadCache();
        }
        const newHash = this.getHash(code);
        const oldHash = this.cache.get(name);
        return oldHash !== newHash;
    }

    static updateHash(code: string, name: string): void {
        const hash = this.getHash(code);
        this.cache.set(name, hash);
        this.saveCache();
    }
}
