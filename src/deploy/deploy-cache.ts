import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ForgeError } from '../core/errors.js';
import { sha256 } from '../core/hash.js';
import { isRecord } from '../core/validation.js';

export interface DeployCacheEntry {
    sha256: string;
    deployedAt: string;
    scriptId: number;
}

export type DeployCache = Record<string, DeployCacheEntry>;

export function deployCacheKey(host: string, targetScriptName: string): string {
    return `${host}|${targetScriptName}`;
}

function fileComponent(value: string): string {
    return encodeURIComponent(value).replace(/\./g, '%2E');
}

export function lastGoodPath(projectDir: string, host: string, targetScriptName: string): string {
    return path.join(projectDir, '.shelly-forge', 'deployed', fileComponent(host), `${fileComponent(targetScriptName)}-${sha256(targetScriptName).slice(0, 12)}.js`);
}

function cachePath(projectDir: string): string {
    return path.join(projectDir, '.shelly-forge', 'deploy-cache.json');
}

async function atomicWrite(file: string, content: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
        await rename(temporary, file);
    } finally {
        await rm(temporary, { force: true });
    }
}

export async function readDeployCache(projectDir: string): Promise<DeployCache> {
    let content: string;
    try {
        content = await readFile(cachePath(projectDir), 'utf8');
    } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return Object.create(null) as DeployCache;
        throw new ForgeError('DEPLOY', 'Could not read the deploy cache', { cause });
    }
    try {
        const value: unknown = JSON.parse(content);
        if (!isRecord(value)) throw new Error('Invalid cache');
        const cache: DeployCache = Object.create(null) as DeployCache;
        for (const [key, entry] of Object.entries(value)) {
            if (!entry || typeof entry !== 'object' || !('sha256' in entry) || typeof entry.sha256 !== 'string'
                || !/^[a-f0-9]{64}$/.test(entry.sha256) || !('deployedAt' in entry) || typeof entry.deployedAt !== 'string'
                || !Number.isFinite(Date.parse(entry.deployedAt)) || !('scriptId' in entry)
                || !Number.isSafeInteger(entry.scriptId) || (entry.scriptId as number) < 0) throw new Error('Invalid cache entry');
            cache[key] = entry as DeployCacheEntry;
        }
        return cache;
    } catch (cause) {
        throw new ForgeError('DEPLOY', 'Invalid deploy cache', {
            cause, hint: 'Remove .shelly-forge/deploy-cache.json and deploy again. Last-good artifacts can be kept.',
        });
    }
}

export async function readLastGood(projectDir: string, host: string, targetScriptName: string): Promise<string | undefined> {
    try {
        return await readFile(lastGoodPath(projectDir, host, targetScriptName), 'utf8');
    } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw new ForgeError('DEPLOY', 'Could not read the last-good artifact', { cause });
    }
}

export async function invalidateDeployCache(projectDir: string, host: string, targetScriptName: string): Promise<void> {
    const cache = await readDeployCache(projectDir);
    delete cache[deployCacheKey(host, targetScriptName)];
    try {
        await atomicWrite(cachePath(projectDir), `${JSON.stringify(cache, null, 2)}\n`);
    } catch (cause) {
        throw new ForgeError('DEPLOY', 'Could not invalidate the deploy cache', { cause });
    }
}

export async function recordDeployment(projectDir: string, host: string, targetScriptName: string, scriptId: number, code: string): Promise<DeployCacheEntry> {
    const cache = await readDeployCache(projectDir);
    const entry = { sha256: sha256(code), deployedAt: new Date().toISOString(), scriptId };
    cache[deployCacheKey(host, targetScriptName)] = entry;
    try {
        await atomicWrite(lastGoodPath(projectDir, host, targetScriptName), code);
        await atomicWrite(cachePath(projectDir), `${JSON.stringify(cache, null, 2)}\n`);
        return entry;
    } catch (cause) {
        throw new ForgeError('DEPLOY', 'The script is running, but its deploy cache could not be saved', { cause });
    }
}
