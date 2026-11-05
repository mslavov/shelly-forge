import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { buildProject } from '../../src/build/build-project.js';
import { bundleScript } from '../../src/build/bundler.js';
import { publicEnvSha256, readManifest, verifyArtifact } from '../../src/build/manifest.js';
import { ProjectConfig } from '../../src/core/config.js';
import { sha256 } from '../../src/core/hash.js';
import * as typecheck from '../../src/build/typecheck.js';
import { project } from './helpers.js';

test('preserves UTF-8, emits ES5 IIFE output and all schemaVersion 1 manifest fields', async () => {
    const source = [
        'const point = { left: 2, right: 3 };',
        "const format = ({ left, right } = point, label = '20 °C — café') => `${label}: ${left + right}`;",
        'print(format());', '',
    ].join('\n');
    const { dir, ctx, config, logger } = await project(source);
    const result = await buildProject(ctx, config);
    expect(result.scripts).toHaveLength(1);
    const script = result.scripts[0];
    const artifact = await readFile(script.artifactPath);
    const code = artifact.toString('utf8');
    expect(code).toContain('20 °C — café');
    expect(code).toMatch(/^(?:"use strict";)?\(function\(\)/);
    expect(code).toContain('function');
    expect(code).not.toMatch(/\b(?:const|let)\b|=>|`|\\(?:xB0|u00B0)/);
    const manifest = await readManifest(dir);
    expect(manifest).toEqual({
        schemaVersion: 1,
        runtime: { engine: 'shelly-js', target: 'es5', bundleTarget: 'esnext', transpileTarget: 'es5', format: 'iife', platform: 'browser', minify: true, sourcemap: false, charset: 'utf8' },
        scripts: [{ solutionId: 'climate', scriptId: 'publish', deployId: 'climate/publish', targetScriptName: 'publish',
            sourcePath: 'src/publish.ts', sourceSizeBytes: Buffer.byteLength(source), sourceSha256: sha256(source),
            artifactPath: 'dist/climate-publish.js', artifactSizeBytes: artifact.length, artifactSha256: sha256(artifact), findings: script.findings,
            inputs: [{ path: 'src/publish.ts', sha256: sha256(source) }], publicEnvSha256: publicEnvSha256(ctx.env) }],
    });
    expect(script).toMatchObject({ sha256: sha256(artifact), sizeBytes: artifact.length });
    expect(result.manifestPath).toBe(path.join(dir, 'dist', 'manifest.json'));
    expect(script.findings).toEqual([expect.objectContaining({ rule: 'non-ascii', severity: 'warning' })]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/^dist\/climate-publish.js \(unminified\):\d+:\d+ non-ascii /));
});

test('unminified output is larger and manifest reflects the flag', async () => {
    const { dir, ctx, config } = await project('const value = (left: number, right: number) => left + right; print(value(2, 3));');
    const minified = await buildProject(ctx, config, { write: false });
    const unminified = await buildProject(ctx, config, { minify: false });
    expect(unminified.scripts[0].sizeBytes).toBeGreaterThan(minified.scripts[0].sizeBytes);
    expect((await readManifest(dir))?.runtime.minify).toBe(false);
});

test('unminified template literals keep raw UTF-8 after ES5 transpilation', async () => {
    const { dir, ctx, config } = await project('const temperature = 20; print(`${temperature} °C café`);');
    const result = await buildProject(ctx, config, { minify: false });
    expect(result.scripts[0].code).toContain(' °C café');
    expect(result.scripts[0].code).not.toMatch(/\\u[0-9a-f{]/i);
    const bundle = await bundleScript({ projectDir: dir, entry: 'src/publish.ts', minify: false, env: {} });
    expect(bundle.code).toBe(bundle.unminifiedCode);
    expect(bundle.inputs).toEqual([path.join(dir, 'src/publish.ts')]);
});

test('selected builds preserve other manifest entries and remove unconfigured ids', async () => {
    const { dir, ctx, config } = await project('print("a");', {
        'src/other.ts': 'print("b");',
        'solutions.config.json': JSON.stringify({ climate: {
            publish: { src: 'src/publish.ts', device: 'device' }, other: { src: 'src/other.ts', device: 'device' },
        } }),
    });
    await buildProject(ctx, config);
    const other = (await readManifest(dir))!.scripts.find(script => script.deployId === 'climate/other');
    await writeFile(path.join(dir, 'src/publish.ts'), 'print("updated a");');
    await buildProject(ctx, config, { selector: 'publish' });
    expect((await readManifest(dir))!.scripts).toEqual([
        expect.objectContaining({ deployId: 'climate/publish', sourceSha256: sha256('print("updated a");') }), other,
    ]);
    await expect(verifyArtifact(dir, config.select('other')[0], ctx.env)).resolves.toMatchObject({ code: expect.stringContaining('b') });
    await writeFile(path.join(dir, 'solutions.config.json'), JSON.stringify({ climate: { publish: { src: 'src/publish.ts', device: 'device' } } }));
    await buildProject(ctx, await ProjectConfig.load(dir), { selector: 'publish' });
    expect((await readManifest(dir))!.scripts.map(script => script.deployId)).toEqual(['climate/publish']);
});

test('a selected build ignores type errors outside its inputs and reports the count at debug level', async () => {
    const { ctx, config, logger } = await project('export {}; print("selected");', {
        'src/other.ts': 'export {}; const value: number = "wrong"; print(value);',
        'solutions.config.json': JSON.stringify({ climate: {
            publish: { src: 'src/publish.ts', device: 'device' }, other: { src: 'src/other.ts', device: 'device' },
        } }),
    });
    const result = await buildProject(ctx, config, { selector: 'publish', write: false });
    expect(result.scripts).toHaveLength(1);
    expect(result.findings).toEqual([]);
    expect(logger.debug).toHaveBeenCalledWith("Ignored 1 TypeScript diagnostic outside the selected scripts' inputs.");
    await expect(buildProject(ctx, config, { write: false })).rejects.toMatchObject({ code: 'BUILD' });
});

test('a selected build still fails diagnostics in imported helpers and compiler options', async () => {
    const { dir, ctx, config } = await project('import { value } from "./helper.js"; print(value);', {
        'src/helper.ts': 'export const value: number = "wrong";',
    });
    await expect(buildProject(ctx, config, { selector: 'publish' })).rejects.toMatchObject({ code: 'BUILD', details: { findings: [expect.objectContaining({ file: 'src/helper.ts' })] } });
    await writeFile(path.join(dir, 'src/helper.ts'), 'export const value = 1;');
    await writeFile(path.join(dir, 'tsconfig.json'), '{"compilerOptions": {"target": "invalid"}}');
    await expect(buildProject(ctx, config, { selector: 'publish' })).rejects.toMatchObject({ code: 'BUILD' });
});

test('AST findings have the same unminified location and excerpt regardless of minification', async () => {
    const { ctx, config } = await project('print("line one");\nprint("line two");\nprint("café");');
    const minified = await buildProject(ctx, config, { write: false });
    const unminified = await buildProject(ctx, config, { write: false, minify: false });
    expect(minified.findings).toEqual(unminified.findings.map(finding => ({ ...finding, bundle: 'unminified' })));
    expect(minified.findings[0].line).toBeGreaterThan(1);
    expect(minified.findings[0].message).toContain('café');
    expect(unminified.findings[0]).not.toHaveProperty('bundle');
});

test('rejects hoisted timer callbacks before minification can rename or inline them', async () => {
    const { ctx, config } = await project('Timer.set(1, true, tick); function tick() {}', {
        'src/globals.d.ts': 'declare var Timer: { set(delay: number, repeat: boolean, callback: () => void): void };',
    });
    await expect(buildProject(ctx, config)).rejects.toMatchObject({ code: 'CHECK', details: { findings: [expect.objectContaining({ rule: 'use-before-declaration', severity: 'error', message: expect.stringContaining('tick') })] } });
});

test('explains why TypeScript ES5 class inheritance cannot run on the device', async () => {
    const { ctx, config } = await project('class A {} class B extends A {} print(new B());');
    await expect(buildProject(ctx, config)).rejects.toMatchObject({
        code: 'CHECK', details: { findings: expect.arrayContaining([expect.objectContaining({
            rule: 'class-inheritance', severity: 'error',
            message: expect.stringContaining("class ... extends ... is not supported on the device because TypeScript's ES5 output relies on function hoisting. Use composition or plain objects instead."),
        })]) },
    });
});

test('typechecks once for all selected scripts and never resolves devices', async () => {
    const { ctx, config } = await project('print("a");', {
        'src/other.ts': 'print("b");',
        'solutions.config.json': JSON.stringify({ climate: {
            publish: { src: 'src/publish.ts', device: '${BUILD_TEST_UNSET_DEVICE}' },
            other: { src: 'src/other.ts', device: '${BUILD_TEST_UNSET_DEVICE}' },
        } }),
    });
    const typeSpy = vi.spyOn(typecheck, 'typecheckProject');
    const deviceSpy = vi.spyOn(config, 'resolveDevice');
    try {
        expect((await buildProject(ctx, config, { write: false })).scripts).toHaveLength(2);
        expect(typeSpy).toHaveBeenCalledTimes(1);
        expect(deviceSpy).not.toHaveBeenCalled();
    } finally {
        typeSpy.mockRestore();
        deviceSpy.mockRestore();
    }
});

test('type errors fail before artifacts are written and no-typecheck skips them', async () => {
    const { dir, ctx, config, logger } = await project('\nconst value: number = "wrong"; print(value);');
    await expect(buildProject(ctx, config)).rejects.toMatchObject({ code: 'BUILD', exitCode: 3, details: { findings: [expect.objectContaining({ file: 'src/publish.ts', line: 2, column: 7 })] } });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('src/publish.ts:2:7 typescript'));
    await expect(access(path.join(dir, 'dist'))).rejects.toThrow();
    expect((await buildProject(ctx, config, { typecheck: false })).scripts).toHaveLength(1);
});

test('aggregates artifact failures across scripts without overwriting a previous build', async () => {
    const { dir, ctx, config } = await project('print("original");', {
        'src/other.ts': 'print("other");',
        'solutions.config.json': JSON.stringify({ climate: {
            publish: { src: 'src/publish.ts', device: 'test-device' }, other: { src: 'src/other.ts', device: 'test-device' },
        } }),
    });
    await buildProject(ctx, config);
    const before = await readFile(path.join(dir, 'dist', 'climate-publish.js'), 'utf8');
    await writeFile(path.join(dir, 'src/publish.ts'), 'setTimeout(function() {}, 100);');
    await writeFile(path.join(dir, 'src/other.ts'), 'fetch("http://fixture.invalid");');
    await expect(buildProject(ctx, config)).rejects.toMatchObject({ code: 'CHECK', details: { findings: [
        expect.objectContaining({ scriptId: 'climate/publish', rule: 'unsupported-global' }),
        expect.objectContaining({ scriptId: 'climate/other', rule: 'unsupported-global' }),
    ] } });
    expect(await readFile(path.join(dir, 'dist', 'climate-publish.js'), 'utf8')).toBe(before);
});

test('validates the whole manifest before writing any build artifacts', async () => {
    const { dir, ctx, config } = await project('print("original");');
    await buildProject(ctx, config);
    const artifactPath = path.join(dir, 'dist/climate-publish.js');
    const manifestPath = path.join(dir, 'dist/manifest.json');
    const beforeArtifact = await readFile(artifactPath, 'utf8');
    const beforeManifest = await readFile(manifestPath, 'utf8');
    await writeFile(path.join(dir, 'src/publish.ts'), 'print("updated");');
    const entry = config.scripts()[0];
    const invalidEntry = { ...entry, id: 'climate/invalid', name: 'invalid', artifactName: 'invalid\0name' };
    const select = vi.spyOn(config, 'select').mockReturnValue([entry, invalidEntry]);
    const scripts = vi.spyOn(config, 'scripts').mockReturnValue([entry, invalidEntry]);
    try {
        await expect(buildProject(ctx, config)).rejects.toMatchObject({ code: 'BUILD' });
        expect(await readFile(artifactPath, 'utf8')).toBe(beforeArtifact);
        expect(await readFile(manifestPath, 'utf8')).toBe(beforeManifest);
        expect((await readdir(path.join(dir, 'dist'))).sort()).toEqual(['climate-publish.js', 'manifest.json']);
    } finally {
        select.mockRestore();
        scripts.mockRestore();
    }
});

test('bundle errors include findings and use BUILD', async () => {
    const { dir, ctx, config } = await project('import "./missing.js";');
    await expect(buildProject(ctx, config, { typecheck: false })).rejects.toMatchObject({ code: 'BUILD', details: { findings: [expect.objectContaining({ rule: 'bundle', scriptId: 'climate/publish' })] } });
    await expect(access(path.join(dir, 'dist'))).rejects.toThrow();
});

test('checks:false skips artifact checks without skipping typechecks', async () => {
    const { ctx, config } = await project('fetch("http://fixture.invalid");');
    expect((await buildProject(ctx, config, { checks: false, write: false })).findings).toEqual([]);
});

test('strict promotes warnings to errors', async () => {
    const { ctx, config } = await project('[1].map(function(value) { return value + 1; });');
    await expect(buildProject(ctx, config, { strict: true })).rejects.toMatchObject({ code: 'CHECK', details: { findings: [expect.objectContaining({ rule: 'unsupported-array-method', severity: 'error' })] } });
});

test('missing tsconfig warns by default and fails CHECK in strict mode', async () => {
    const { dir, ctx, config } = await project();
    await rm(path.join(dir, 'tsconfig.json'));
    expect((await buildProject(ctx, config, { write: false })).findings).toEqual([expect.objectContaining({ rule: 'missing-tsconfig', severity: 'warning' })]);
    await expect(buildProject(ctx, config, { strict: true, write: false })).rejects.toMatchObject({ code: 'CHECK', details: { findings: [expect.objectContaining({ rule: 'missing-tsconfig', severity: 'error' })] } });
});

test('write:false does not create artifacts or touch existing artifacts', async () => {
    const { dir, ctx, config } = await project();
    const result = await buildProject(ctx, config, { write: false });
    expect(result.manifestPath).toBeUndefined();
    expect((await readdir(dir)).sort()).toEqual(['solutions.config.json', 'src', 'tsconfig.json']);
    await buildProject(ctx, config);
    const before = await readFile(result.scripts[0].artifactPath, 'utf8');
    await writeFile(path.join(dir, 'src/publish.ts'), 'print("changed");');
    const checked = await buildProject(ctx, config, { write: false });
    expect(checked.scripts[0].code).not.toBe(before);
    expect(await readFile(result.scripts[0].artifactPath, 'utf8')).toBe(before);
});

test('inlines only defined public variables and fails unresolved variables', async () => {
    const { ctx, config } = await project('print(process.env.SHELLY_PUBLIC_BUILD_VALUE);');
    ctx.env.SHELLY_PUBLIC_BUILD_VALUE = 'safe-public-value';
    ctx.env.SECRET = 'must-not-appear';
    const result = await buildProject(ctx, config, { write: false });
    expect(result.scripts[0].code).toContain('safe-public-value');
    expect(result.scripts[0].publicEnv).toEqual(['SHELLY_PUBLIC_BUILD_VALUE']);
    expect(JSON.stringify(result)).not.toContain('must-not-appear');
    ctx.env.SHELLY_PUBLIC_BUILD_VALUE = undefined;
    await expect(buildProject(ctx, config, { write: false })).rejects.toMatchObject({ code: 'CHECK', details: { findings: [expect.objectContaining({ rule: 'unresolved-env', message: expect.stringContaining('SHELLY_PUBLIC_BUILD_VALUE') })] } });
});

test.each([true, false])('detects async helpers after bundling with minify=%s', async minify => {
    const { ctx, config } = await project('async function poll() { await fetch("http://fixture.invalid"); } poll();');
    await expect(buildProject(ctx, config, { minify, write: false })).rejects.toMatchObject({ code: 'CHECK', details: { findings: expect.arrayContaining([expect.objectContaining({ rule: 'async-function' })]) } });
});
