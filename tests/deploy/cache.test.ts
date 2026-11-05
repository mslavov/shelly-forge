import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../../src/core/hash.js';
import { deployCacheKey, invalidateDeployCache, lastGoodPath, readDeployCache, readLastGood, recordDeployment } from '../../src/deploy/deploy-cache.js';
import { createTempProject } from '../helpers/project.js';

describe('deploy cache', () => {
    it('does not create files when reading an absent cache or copy', async () => {
        const { dir } = await createTempProject();
        expect(await readDeployCache(dir)).toEqual({});
        expect(await readLastGood(dir, 'device', 'main')).toBeUndefined();
        expect(await readdir(dir)).toEqual([]);
    });

    it('records an atomic cache entry and exact last-good copy', async () => {
        const { dir } = await createTempProject();
        const entry = await recordDeployment(dir, '127.0.0.1:1234', 'main', 7, 'print("hello");');
        expect(entry).toEqual({ sha256: sha256('print("hello");'), scriptId: 7, deployedAt: expect.any(String) });
        expect(await readDeployCache(dir)).toEqual({ '127.0.0.1:1234|main': entry });
        expect(await readFile(lastGoodPath(dir, '127.0.0.1:1234', 'main'), 'utf8')).toBe('print("hello");');
        expect(await readdir(path.join(dir, '.shelly-forge'))).toEqual(['deploy-cache.json', 'deployed']);
    });

    it('keeps device/name pairs separate and invalidates only the selected cache entry', async () => {
        const { dir } = await createTempProject();
        for (const [host, name] of [['first', 'one'], ['first', 'two'], ['second', 'one']]) {
            await recordDeployment(dir, host, name, 1, `${host}/${name}`);
        }
        await invalidateDeployCache(dir, 'first', 'one');
        expect(Object.keys(await readDeployCache(dir))).toEqual(['first|two', 'second|one']);
        expect(await readLastGood(dir, 'first', 'one')).toBe('first/one');
    });

    it('separates target names that differ only in case on case-insensitive filesystems', async () => {
        const { dir } = await createTempProject();
        await recordDeployment(dir, 'device', 'Main', 1, 'upper();');
        await recordDeployment(dir, 'device', 'main', 2, 'lower();');
        expect(lastGoodPath(dir, 'device', 'Main').toLowerCase()).not.toBe(lastGoodPath(dir, 'device', 'main').toLowerCase());
        expect(await readLastGood(dir, 'device', 'Main')).toBe('upper();');
        expect(await readLastGood(dir, 'device', 'main')).toBe('lower();');
    });

    it.each(['../escape', '../../escape', '/absolute', '.', '..', 'nested/script', 'a\\b'])('encodes unsafe names: %s', async name => {
        const { dir } = await createTempProject();
        await recordDeployment(dir, '::1', name, 1, 'safe');
        const file = lastGoodPath(dir, '::1', name);
        expect(path.relative(path.join(dir, '.shelly-forge', 'deployed'), file).split(path.sep)).toHaveLength(2);
        expect(await readLastGood(dir, '::1', name)).toBe('safe');
    });

    it.each(['not json', '[]', '{"x":{}}', '{"x":{"sha256":"bad","scriptId":1,"deployedAt":"today"}}'])('rejects corrupt metadata: %s', async content => {
        const { dir } = await createTempProject();
        await mkdir(path.join(dir, '.shelly-forge'));
        await writeFile(path.join(dir, '.shelly-forge', 'deploy-cache.json'), content);
        await expect(readDeployCache(dir)).rejects.toMatchObject({ code: 'DEPLOY', hint: expect.stringContaining('Remove') });
    });

    it('uses the contract cache key', () => {
        expect(deployCacheKey('device:123', 'main')).toBe('device:123|main');
    });
});
