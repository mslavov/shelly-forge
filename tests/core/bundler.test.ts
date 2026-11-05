import { readdir } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { bundleScript } from '../../src/build/bundler.js';
import { createShellyRuntime } from '../../src/testing/index.js';
import { createTempProject } from '../helpers/project.js';

test.each([true, false])('bundles imports into an ES5 UTF-8 IIFE with minify=%s', async minify => {
    const { dir } = await createTempProject({
        'src/math.ts': 'export const sum = (left: number, right: number) => left + right;',
        'src/publish.ts': [
            "import { sum } from './math';",
            'const point = { left: 2, right: 3 };',
            "const format = ({ left, right } = point, label = '20 °C — café') => `${label}: ${sum(left, right)}`;",
            'print(format());',
        ].join('\n'),
    });
    const { code, publicEnv } = await bundleScript({ projectDir: dir, entry: 'src/publish.ts', minify, env: {} });
    expect(publicEnv).toEqual([]);
    expect(code).toContain('20 °C — café');
    expect(code).not.toMatch(/\b(?:const|let)\b|=>|`/u);
    expect(code).toMatch(/^\(function\s*\(/);
    expect(code).not.toMatch(/\\(?:xB0|u00B0)/iu);
    const printed: unknown[] = [];
    runInNewContext(code, { print: (value: unknown) => printed.push(value) });
    expect(printed).toEqual(['20 °C — café: 5']);
    expect(await readdir(dir)).toEqual(['src']);
});

test('inlines only public environment variables and reports their names', async () => {
    const { dir } = await createTempProject({ 'script.ts': 'print(process.env.SHELLY_PUBLIC_NAME, process.env.SHELLY_PUBLIC_EMPTY, process.env.PRIVATE_SECRET);' });
    const { code, publicEnv } = await bundleScript({ projectDir: dir, entry: 'script.ts', env: { PRIVATE_SECRET: 'must-not-inline', SHELLY_PUBLIC_NAME: 'café', SHELLY_PUBLIC_EMPTY: '' } });
    expect(publicEnv).toEqual(['SHELLY_PUBLIC_EMPTY', 'SHELLY_PUBLIC_NAME']);
    expect(code).toContain('café');
    expect(code).not.toContain('must-not-inline');
    expect(code).toContain('process.env.PRIVATE_SECRET');
});

test.each([true, false])('lowers modern syntax with feature-detecting helpers that run on the device profile (minify=%s)', async minify => {
    const { dir } = await createTempProject({
        'script.ts': [
            'const base = { a: 1, b: 2 };',
            'const { a, ...rest } = { ...base, c: 3 };',
            'class Counter { count = 0; inc() { this.count += 1; return this.count; } }',
            'const maybe: { x?: { y?: number } } = {};',
            'print(JSON.stringify(rest), new Counter().inc(), maybe.x?.y ?? 5, 2 ** 3, a);',
        ].join('\n'),
    });
    const { code } = await bundleScript({ projectDir: dir, entry: 'script.ts', minify, env: {} });
    expect(code).not.toContain('getOwnPropertyDescriptors');
    const runtime = createShellyRuntime();
    runtime.load(code);
    expect(runtime.logs).toEqual(['{"b":2,"c":3} 1 5 8 1']);
});

test('defaults to minified output and reports bundling errors as BUILD', async () => {
    const { dir } = await createTempProject({ 'script.ts': 'const name = "fixture"; print(name);' });
    const defaultBundle = await bundleScript({ projectDir: dir, entry: 'script.ts', env: {} });
    const minified = await bundleScript({ projectDir: dir, entry: 'script.ts', minify: true, env: {} });
    const unminified = await bundleScript({ projectDir: dir, entry: 'script.ts', minify: false, env: {} });
    expect(defaultBundle.code).toBe(minified.code);
    expect(minified.code.length).toBeLessThan(unminified.code.length);
    await expect(bundleScript({ projectDir: dir, entry: 'missing.ts', env: {} })).rejects.toMatchObject({ code: 'BUILD' });
});
