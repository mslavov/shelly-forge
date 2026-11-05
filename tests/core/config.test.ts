import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { CONFIG_FILE, ProjectConfig, resolveEnvRefs, validateSelectedTargets } from '../../src/core/config.js';
import { createTempProject } from '../helpers/project.js';

async function fixture(value: unknown) {
    const { dir } = await createTempProject({ [CONFIG_FILE]: JSON.stringify(value) });
    return { dir, config: await ProjectConfig.load(dir) };
}

const scripts = {
    climate: {
        publish: { src: 'src/publish.ts', device: 'fixture-device' },
        monitor: { src: 'src/monitor.ts', device: 'fixture-device' },
    },
    air: { ventilation: { src: 'src/ventilation.ts', device: 'fixture-device', targetScriptName: 'fan-controller' } },
};

describe('config selectors', () => {
    test.each([
        ['climate/publish', 'climate/publish'],
        ['climate-monitor', 'climate/monitor'],
        ['ventilation', 'air/ventilation'],
        ['fan-controller', 'air/ventilation'],
    ])('%s selects %s', async (selector, expected) => {
        const { config } = await fixture(scripts);
        expect(config.select(selector).map(entry => entry.id)).toEqual([expected]);
    });

    test('selects every script by default and supplies defaults', async () => {
        const { dir, config } = await fixture(scripts);
        expect(config.select()).toHaveLength(3);
        expect(config.scripts()[0]).toEqual({
            id: 'climate/publish', solution: 'climate', name: 'publish', artifactName: 'climate-publish',
            targetScriptName: 'publish', src: 'src/publish.ts', srcPath: path.join(dir, 'src/publish.ts'),
            enableOnBoot: true, deviceRef: 'fixture-device', passwordRef: undefined,
        });
    });

    test('rejects an unknown selector', async () => {
        const { config } = await fixture(scripts);
        expect(() => config.select('missing')).toThrow('Script selector "missing" not found');
        expect(() => config.select('')).toThrow('not found');
    });

    test('rejects ambiguous names and lists both qualified ids', async () => {
        const { config } = await fixture({
            climate: { publish: { src: 'src/climate.ts', device: 'fixture-device' } },
            ventilation: { publish: { src: 'src/ventilation.ts', device: 'fixture-device', targetScriptName: 'ventilation-publish' } },
        });
        expect(() => config.select('publish')).toThrow('Script selector "publish" is ambiguous. Use one of: climate/publish, ventilation/publish');
        expect(config.select('climate/publish')[0]?.id).toBe('climate/publish');
    });

    test('rejects ambiguous artifact and target names', async () => {
        const { config } = await fixture({
            a: { b: { src: 'a.ts', device: 'one', targetScriptName: 'shared' } },
            c: { 'a-b': { src: 'b.ts', device: 'two', targetScriptName: 'shared' } },
        });
        expect(() => config.select('a-b')).toThrow('ambiguous');
        expect(() => config.select('shared')).toThrow('ambiguous');
    });
});

describe('device resolution', () => {
    test('loads and selects without resolving device environment variables', async () => {
        const { config } = await fixture({ climate: { publish: { src: 'src/publish.ts', device: '${MISSING_HOST}', password: '${MISSING_PASSWORD}' } } });
        expect(config.select()).toHaveLength(1);
        expect(() => config.resolveDevice(config.scripts()[0]!, {})).toThrow('Environment variable MISSING_HOST is not set');
        try { config.resolveDevice(config.scripts()[0]!, {}); } catch (error) { expect(error).toMatchObject({ code: 'CONFIG' }); }
    });

    test('resolves multiple embedded references, explicit password, and boot setting', async () => {
        const { config } = await fixture({ climate: { publish: { src: 'a.ts', device: '${HOST}:${PORT}', password: '${PREFIX}-${SECRET}', enableOnBoot: false } } });
        const entry = config.scripts()[0]!;
        expect(entry.enableOnBoot).toBe(false);
        expect(config.resolveDevice(entry, { HOST: 'localhost', PORT: '1234', PREFIX: 'a', SECRET: 'b', SHELLY_PASSWORD: 'fallback' }))
            .toEqual({ host: 'localhost:1234', username: 'admin', password: 'a-b' });
    });

    test('uses the fallback password only when there is no explicit password', async () => {
        const { config } = await fixture(scripts);
        expect(config.resolveDevice(config.scripts()[0]!, { SHELLY_PASSWORD: 'fallback' }).password).toBe('fallback');
        expect(config.resolveDevice(config.scripts()[0]!, {})).toEqual({ host: 'fixture-device', username: 'admin' });
    });

    test.each(['', 'http://localhost', 'localhost/path', 'user@localhost', 'localhost?query=1', 'localhost#fragment', 'localhost\\path', 'bad host'])('rejects an invalid resolved host %s', async host => {
        const { config } = await fixture({ climate: { publish: { src: 'a.ts', device: '${HOST}' } } });
        expect(() => config.resolveDevice(config.scripts()[0]!, { HOST: host })).toThrow();
    });

    test('rejects duplicate host and on-device name pairs after env resolution', async () => {
        const { config } = await fixture({
            climate: { publish: { src: 'a.ts', device: '${HOST}', targetScriptName: 'shared-script' } },
            ventilation: { publish: { src: 'b.ts', device: 'fixture-device', targetScriptName: 'shared-script' } },
        });
        expect(() => validateSelectedTargets(config, config.scripts(), { HOST: 'fixture-device' })).toThrow('Scripts "climate/publish" and "ventilation/publish" both target on-device script "shared-script" on fixture-device');
    });

    test('allows the same target name on different hosts and different names on one host', async () => {
        const { config } = await fixture(scripts);
        expect(() => validateSelectedTargets(config, config.scripts(), {})).not.toThrow();
        const second = await fixture({ a: { x: { src: 'a.ts', device: 'one' } }, b: { x: { src: 'b.ts', device: 'two' } } });
        expect(() => validateSelectedTargets(second.config, second.config.scripts(), {})).not.toThrow();
    });

    test.each(['DEVICE.local', 'device.local:80', 'DEVICE.local:80'])('treats %s as the same HTTP endpoint as device.local', async device => {
        const { config } = await fixture({
            a: { x: { src: 'a.ts', device: 'device.local' } },
            b: { x: { src: 'b.ts', device } },
        });
        expect(() => validateSelectedTargets(config, config.scripts(), {})).toThrow('both target on-device script "x"');
    });

    test('resolves selected targets without requiring unrelated environment values', async () => {
        const { config } = await fixture({ climate: {
            publish: { src: 'a.ts', device: 'fixture-device' },
            missingHost: { src: 'b.ts', device: '${MISSING_HOST}' },
            missingPassword: { src: 'c.ts', device: 'fixture-device', password: '${MISSING_PASSWORD}' },
        } });
        expect([...validateSelectedTargets(config, config.select('publish'), {})]).toEqual([
            ['climate/publish', { host: 'fixture-device', username: 'admin' }],
        ]);
        expect(() => validateSelectedTargets(config, config.select('missingHost'), {})).toThrow('MISSING_HOST is not set');
        expect(() => validateSelectedTargets(config, config.select('missingPassword'), {})).toThrow('MISSING_PASSWORD is not set');
    });

    test('resolves all env references and rejects missing or empty values', () => {
        expect(resolveEnvRefs('${A}/${A}/${B}', { A: 'left', B: 'right' })).toBe('left/left/right');
        expect(resolveEnvRefs('literal', {})).toBe('literal');
        expect(() => resolveEnvRefs('${A}', {})).toThrow('A is not set');
        expect(() => resolveEnvRefs('${A}', { A: '' })).toThrow('A is not set');
    });
});

describe('config validation and persistence', () => {
    test('rejects artifact-name collisions before files can be overwritten', async () => {
        const { dir } = await createTempProject({ [CONFIG_FILE]: JSON.stringify({
            'a-b': { c: { src: 'a.ts', device: 'one' } },
            a: { 'b-c': { src: 'b.ts', device: 'two' } },
        }) });
        await expect(ProjectConfig.load(dir)).rejects.toMatchObject({
            code: 'CONFIG', message: 'Scripts "a-b/c" and "a/b-c" both produce artifact "a-b-c.js"',
        });
        const config = await ProjectConfig.loadOrCreate((await createTempProject()).dir);
        config.addScript('a-b', 'c', { src: 'a.ts', device: 'one' });
        expect(() => config.addScript('a', 'b-c', { src: 'b.ts', device: 'two' })).toThrow('both produce artifact');
        expect(config.scripts().map(entry => entry.id)).toEqual(['a-b/c']);
    });

    test('reports missing files and invalid JSON as CONFIG errors', async () => {
        const { dir } = await createTempProject();
        await expect(ProjectConfig.load(dir)).rejects.toMatchObject({ code: 'CONFIG', message: expect.stringContaining('not found') });
        await writeFile(path.join(dir, CONFIG_FILE), '{bad');
        await expect(ProjectConfig.load(dir)).rejects.toMatchObject({ code: 'CONFIG', message: expect.stringContaining('Invalid JSON') });
    });

    test.each([
        null, [], { a: [] }, { a: { b: { src: 'a.ts' } } },
        { a: { b: { src: 'a.ts', device: 'host', enableOnBoot: 'true' } } },
        { a: { b: { src: 'a.ts', device: 'host', unknown: true } } },
        { 'bad/name': { b: { src: 'a.ts', device: 'host' } } },
        { a: { 'bad/name': { src: 'a.ts', device: 'host' } } },
        JSON.parse('{"__proto__": 5}'),
        JSON.parse('{"a": {"__proto__": 5}}'),
    ])('rejects an invalid config %#', async value => {
        const { dir } = await createTempProject({ [CONFIG_FILE]: JSON.stringify(value) });
        await expect(ProjectConfig.load(dir)).rejects.toMatchObject({ code: 'CONFIG' });
    });

    test('lists validation issue paths', async () => {
        const { dir } = await createTempProject({ [CONFIG_FILE]: JSON.stringify({ a: { b: { src: 5, device: 6 } } }) });
        await expect(ProjectConfig.load(dir)).rejects.toMatchObject({
            details: expect.arrayContaining([expect.objectContaining({ path: 'a.b.src' }), expect.objectContaining({ path: 'a.b.device' })]),
        });
    });

    test.each(['../a.ts', '/a.ts', 'src/../../a.ts', 'C:\\a.ts', 'src\\..\\a.ts'])('rejects an escaping source path %s', async src => {
        const { dir } = await createTempProject({ [CONFIG_FILE]: JSON.stringify({ a: { b: { src, device: 'host' } } }) });
        await expect(ProjectConfig.load(dir)).rejects.toMatchObject({ code: 'CONFIG' });
    });

    test('creates in memory and saves raw references and the schema key', async () => {
        const { dir } = await createTempProject();
        const config = await ProjectConfig.loadOrCreate(dir);
        expect(await readdir(dir)).toEqual([]);
        config.addScript('climate', 'publish', { src: 'src/publish.ts', device: '${HOST}' });
        expect(() => config.addScript('climate', 'publish', { src: 'b.ts', device: 'host' })).toThrow('already exists');
        await config.save();
        const saved = JSON.parse(await readFile(path.join(dir, CONFIG_FILE), 'utf8'));
        saved.$schema = './schema.json';
        saved.climate.publish.password = '${PASSWORD}';
        await writeFile(path.join(dir, CONFIG_FILE), JSON.stringify(saved));
        const loaded = await ProjectConfig.loadOrCreate(dir);
        loaded.addScript('climate', 'monitor', { src: 'src/monitor.ts', device: '${HOST}', enableOnBoot: false });
        await loaded.save();
        const final = JSON.parse(await readFile(path.join(dir, CONFIG_FILE), 'utf8'));
        expect(final.$schema).toBe('./schema.json');
        expect(final.climate.publish).toEqual({ src: 'src/publish.ts', device: '${HOST}', enableOnBoot: true, password: '${PASSWORD}' });
        expect(final.climate.monitor.enableOnBoot).toBe(false);
        expect(loaded.scripts()).toHaveLength(2);
    });

    test('does not replace invalid existing configs in loadOrCreate', async () => {
        const { dir } = await createTempProject({ [CONFIG_FILE]: 'null' });
        await expect(ProjectConfig.loadOrCreate(dir)).rejects.toMatchObject({ code: 'CONFIG' });
        expect(await readFile(path.join(dir, CONFIG_FILE), 'utf8')).toBe('null');
    });

    test('handles prototype-like names without changing object prototypes', async () => {
        const { dir } = await createTempProject();
        const config = await ProjectConfig.loadOrCreate(dir);
        config.addScript('__proto__', 'constructor', { src: 'a.ts', device: 'host' });
        await config.save();
        expect((await ProjectConfig.load(dir)).select('__proto__/constructor')).toHaveLength(1);
        expect(Object.prototype).not.toHaveProperty('device');
    });
});
