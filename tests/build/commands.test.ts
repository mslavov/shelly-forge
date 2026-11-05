import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { runCli } from '../helpers/project.js';
import { project } from './helpers.js';

test.each([
    ['climate/publish', 'climate-publish.js'],
    ['climate-monitor', 'climate-monitor.js'],
    ['ventilation', 'air-ventilation.js'],
    ['custom-target', 'climate-publish.js'],
])('build selector %s writes only the selected artifact', async (selector, artifactName) => {
    const { dir } = await project('print("publish");', {
        'solutions.config.json': JSON.stringify({
            climate: { publish: { src: 'src/publish.ts', device: 'fixture-device', targetScriptName: 'custom-target' }, monitor: { src: 'src/monitor.ts', device: 'fixture-device' } },
            air: { ventilation: { src: 'src/ventilation.ts', device: 'fixture-device' } },
        }),
        'src/monitor.ts': 'print("monitor");', 'src/ventilation.ts': 'print("ventilation");',
    });
    const result = await runCli(['build', selector], { cwd: dir });
    expect(result).toEqual({ exitCode: 0, stdout: 'Built 1 script.\n', stderr: '' });
    expect((await readdir(path.join(dir, 'dist'))).sort()).toEqual([artifactName, 'manifest.json'].sort());
});

test('build fails type errors with exit 3 and their source location, --no-typecheck skips them', async () => {
    const { dir } = await project('\nconst value: number = "wrong"; print(value);');
    const failure = await runCli(['build'], { cwd: dir });
    expect(failure.exitCode).toBe(3);
    expect(failure.stderr).toContain('src/publish.ts:2:7 typescript TS2322');
    await expect(access(path.join(dir, 'dist'))).rejects.toThrow();
    expect((await runCli(['build', '--no-typecheck'], { cwd: dir })).exitCode).toBe(0);
});

test('selected CLI builds preserve other artifacts and ignore their type errors', async () => {
    const { dir } = await project('export {}; print("a");', {
        'src/other.ts': 'export {}; print("b");',
        'solutions.config.json': JSON.stringify({ climate: {
            publish: { src: 'src/publish.ts', device: 'device' }, other: { src: 'src/other.ts', device: 'device' },
        } }),
    });
    expect((await runCli(['build'], { cwd: dir })).exitCode).toBe(0);
    await writeFile(path.join(dir, 'src/other.ts'), 'export {}; const bad: number = "wrong"; print(bad);');
    const selected = await runCli(['--verbose', 'build', 'publish'], { cwd: dir });
    expect(selected.exitCode).toBe(0);
    expect(selected.stderr).toContain('Ignored 1 TypeScript diagnostic');
    expect(JSON.parse(await readFile(path.join(dir, 'dist/manifest.json'), 'utf8')).scripts.map((script: { deployId: string }) => script.deployId))
        .toEqual(['climate/publish', 'climate/other']);
    expect((await runCli(['check', 'publish'], { cwd: dir })).exitCode).toBe(0);
    expect((await runCli(['build'], { cwd: dir })).exitCode).toBe(3);
});

test('CLI no-minify retains template-literal UTF-8 and check reports source excerpts', async () => {
    const { dir } = await project('const value = 20; print(`${value} °C`);');
    const build = await runCli(['build', '--no-minify'], { cwd: dir });
    expect(build.exitCode).toBe(0);
    expect(build.stderr).toMatch(/dist\/climate-publish.js:\d+:\d+ non-ascii/);
    expect(build.stderr).not.toContain('(unminified)');
    expect(build.stdout).toBe('Built 1 script.\n');
    const code = await readFile(path.join(dir, 'dist/climate-publish.js'), 'utf8');
    expect(code).toContain(' °C');
    expect(code).not.toMatch(/\\u[0-9a-f{]/i);
    const check = await runCli(['check'], { cwd: dir });
    expect(check.exitCode).toBe(0);
    expect(check.stderr).toContain('Code:');
    expect(check.stderr).toContain('°C');
    expect(check.stderr).toMatch(/dist\/climate-publish.js \(unminified\):\d+:\d+ non-ascii/);
    expect(check.stdout).toBe('Checked 1 script. Run shelly-forge build --no-minify to write artifacts that match these finding locations.\n');
});

test('minified build text and JSON distinguish unminified finding locations', async () => {
    const { dir } = await project('print("café");');
    const text = await runCli(['build'], { cwd: dir });
    expect(text.exitCode).toBe(0);
    expect(text.stderr).toMatch(/dist\/climate-publish.js \(unminified\):\d+:\d+ non-ascii/);
    expect(text.stdout).toBe('Built 1 script. Run shelly-forge build --no-minify to write artifacts that match these finding locations.\n');
    const json = await runCli(['--json', 'build'], { cwd: dir });
    const result = JSON.parse(json.stdout);
    expect(result.data.findings).toEqual([expect.objectContaining({ file: 'dist/climate-publish.js', bundle: 'unminified' })]);
    expect(result.data.scripts[0].findings).toEqual(result.data.findings);
    expect(JSON.parse(await readFile(path.join(dir, 'dist/manifest.json'), 'utf8')).scripts[0].findings).toEqual(result.data.findings);
});

test('build reports all runtime problems and no-check bypasses artifact validation', async () => {
    const { dir } = await project('[1].map(function(x) { return x; }); setTimeout(function() {}, 1); fetch("http://fixture.invalid"); async function work() { await fetch("http://fixture.invalid"); } work(); print(process.env.SHELLY_PUBLIC_MISSING);');
    const failure = await runCli(['build'], { cwd: dir, env: { SHELLY_PUBLIC_MISSING: '' } });
    expect(failure.exitCode).toBe(3);
    for (const expected of ['unsupported-array-method', 'setTimeout', 'fetch', 'async-function']) expect(failure.stderr).toContain(expected);
    const unset = await runCli(['build'], { cwd: dir });
    expect(unset.exitCode).toBe(3);
    expect(unset.stderr).toContain('SHELLY_PUBLIC_MISSING');
    expect(unset.stderr).toContain('unresolved-env');
    expect((await runCli(['build', '--no-check'], { cwd: dir })).exitCode).toBe(0);
});

test('strict warning failure contains error findings in the JSON envelope', async () => {
    const { dir } = await project('[1].map(function(value) { return value; });');
    const result = await runCli(['--json', 'build', '--strict'], { cwd: dir });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, command: 'build', error: {
        code: 'CHECK', hint: 'Run shelly-forge build --no-minify to write artifacts that match these finding locations.',
        details: { findings: [expect.objectContaining({ rule: 'unsupported-array-method', severity: 'error', bundle: 'unminified' })] },
    } });
});

test('successful JSON build includes scripts, findings and totals with no device variables set', async () => {
    const { dir } = await project('print("café");');
    const result = await runCli(['--json', 'build', '--no-minify'], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const json = JSON.parse(result.stdout);
    expect(json).toMatchObject({ ok: true, command: 'build', data: {
        scripts: [{ id: 'climate/publish', artifactPath: path.join(dir, 'dist/climate-publish.js'), sha256: expect.stringMatching(/^[a-f0-9]{64}$/), sizeBytes: expect.any(Number), findings: [expect.objectContaining({ rule: 'non-ascii' })] }],
        totals: { scripts: 1, errors: 0, warnings: 1, sizeBytes: expect.any(Number) },
    } });
    expect(json.data.findings[0]).not.toHaveProperty('bundle');
    expect(JSON.parse(await readFile(path.join(dir, 'dist/manifest.json'), 'utf8')).runtime.minify).toBe(false);
});

test('check writes nothing and obeys selector and no-typecheck options', async () => {
    const { dir } = await project('const value: number = "wrong"; print(value);');
    const files = (await readdir(dir)).sort();
    const failure = await runCli(['--json', 'check', 'climate/publish'], { cwd: dir });
    expect(failure.exitCode).toBe(3);
    expect(JSON.parse(failure.stdout).error.details.findings[0].file).toBe('src/publish.ts');
    const result = await runCli(['--json', 'check', 'climate/publish', '--no-typecheck'], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, command: 'check', summary: 'Checked 1 script.', data: { totals: { scripts: 1, errors: 0, warnings: 0 } } });
    expect(JSON.parse(result.stdout).data).not.toHaveProperty('manifestPath');
    expect((await readdir(dir)).sort()).toEqual(files);
});

test('check enforces strict warnings without writing dist', async () => {
    const { dir } = await project('print("café");');
    expect((await runCli(['--json', 'check'], { cwd: dir })).exitCode).toBe(0);
    expect((await runCli(['--json', 'check', '--strict'], { cwd: dir })).exitCode).toBe(3);
    await expect(access(path.join(dir, 'dist'))).rejects.toThrow();
});

test('missing tsconfig warns without failing the build', async () => {
    const { dir } = await project();
    await rm(path.join(dir, 'tsconfig.json'));
    const result = await runCli(['build'], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('tsconfig.json:1:1 missing-tsconfig');
});

test('invalid and ambiguous selectors report CONFIG before writing artifacts', async () => {
    const { dir } = await project('print("fixture");', {
        'solutions.config.json': JSON.stringify({ climate: { publish: { src: 'src/publish.ts', device: 'fixture' } }, air: { publish: { src: 'src/publish.ts', device: 'fixture' } } }),
    });
    for (const selector of ['missing', 'publish']) {
        const result = await runCli(['--json', 'build', selector], { cwd: dir });
        expect(result.exitCode).toBe(2);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'CONFIG' } });
    }
    await expect(access(path.join(dir, 'dist'))).rejects.toThrow();
});
