import { execFile } from 'node:child_process';
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { PACKAGE_ROOT, TEMPLATES_DIR } from '../../src/core/paths.js';
import { starterScript, starterTest } from '../../src/scaffold/starter-files.js';
import { createTempProject, runCli } from '../helpers/project.js';

const execFileAsync = promisify(execFile);
const templateDir = path.join(TEMPLATES_DIR, 'default');

async function filesIn(directory: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            for (const file of await filesIn(path.join(directory, entry.name))) files.push(`${entry.name}/${file}`);
        } else files.push(entry.name);
    }
    return files.sort();
}

test('ships only the supported project files and synchronized starter content', async () => {
    expect(await filesIn(templateDir)).toEqual([
        '.editorconfig', '.env.example', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'gitignore', 'package.json',
        'solutions.config.json', 'src/example/hello.test.ts', 'src/example/hello.ts', 'tsconfig.json',
        'tsconfig.test.json', 'vitest.config.ts',
    ].sort());
    expect(await readFile(path.join(templateDir, 'src/example/hello.ts'), 'utf8')).toBe(starterScript('example', 'hello'));
    expect(await readFile(path.join(templateDir, 'src/example/hello.test.ts'), 'utf8')).toBe(starterTest('example', 'hello'));
    for (const source of [starterScript('example', 'hello'), starterTest('example', 'hello')]) {
        expect(source).not.toContain('export {}');
        expect(source).not.toContain('"');
        expect(source).not.toMatch(/\{\s*\[/);
    }
    for (const file of await filesIn(templateDir)) {
        expect(await readFile(path.join(templateDir, file), 'utf8')).not.toMatch(/\b(?:MCP|nodemon|concurrently|wscat|dotenv)\b|\.cursor|\$SCRIPT_NAME/i);
    }
    const metadata = JSON.parse(await readFile(path.join(templateDir, 'package.json'), 'utf8'));
    const root = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    expect(metadata.devDependencies['shelly-forge']).toBe(`^${root.version}`);
    expect(Object.keys(metadata.devDependencies).sort()).toEqual(['@types/node', 'shelly-forge', 'typescript', 'vitest']);
    expect(metadata.overrides).toBeUndefined();
    expect(metadata.scripts).toEqual({
        build: 'shelly-forge build', check: 'shelly-forge check',
        typecheck: 'tsc -p tsconfig.json && tsc -p tsconfig.test.json', test: 'vitest run',
        deploy: 'shelly-forge deploy', dev: 'shelly-forge dev', status: 'shelly-forge status', logs: 'shelly-forge logs',
    });
    expect(await readFile(path.join(templateDir, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
});

test('uses separate device and Node type configurations', async () => {
    expect(JSON.parse(await readFile(path.join(templateDir, 'tsconfig.json'), 'utf8'))).toEqual({
        compilerOptions: {
            target: 'es5', moduleDetection: 'force', noLib: true, strict: true, noEmit: true, skipLibCheck: true,
            forceConsistentCasingInFileNames: true, types: [],
        },
        include: ['src/**/*.ts', 'node_modules/shelly-forge/types/lib.shelly.d.ts', 'node_modules/shelly-forge/types/shelly.d.ts'],
        exclude: ['src/**/*.test.ts'],
    });
    expect(JSON.parse(await readFile(path.join(templateDir, 'tsconfig.test.json'), 'utf8'))).toEqual({
        compilerOptions: {
            target: 'es2022', module: 'nodenext', moduleDetection: 'force', lib: ['es2022'], types: ['node'], strict: true,
            noEmit: true, skipLibCheck: true, forceConsistentCasingInFileNames: true,
        },
        include: ['src/**/*.test.ts', 'node_modules/shelly-forge/types/shelly.d.ts'],
    });
});

test('an initialized project checks, typechecks, builds, and tests offline, then rejects unsupported code', async () => {
    const { dir } = await createTempProject();
    const initialized = await runCli(['init', 'demo', '--no-skills'], { cwd: dir });
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const project = path.join(dir, 'demo');
    const modules = path.join(project, 'node_modules');
    await mkdir(modules);
    for (const name of ['shelly-forge', 'typescript', 'vitest', '@types']) {
        await symlink(name === 'shelly-forge' ? PACKAGE_ROOT : path.join(PACKAGE_ROOT, 'node_modules', name), path.join(modules, name), 'dir');
    }
    await copyFile(path.join(project, '.env.example'), path.join(project, '.env'));

    async function expectCleanCheck(): Promise<void> {
        const result = await runCli(['--json', 'check', '--strict'], { cwd: project, env: { SHELLY_PUBLIC_GREETING: 'Hello' } });
        expect(result.exitCode, result.stdout + result.stderr).toBe(0);
        expect(JSON.parse(result.stdout).data.findings).toEqual([]);
    }

    async function typecheckAndTest(expectedTests: number): Promise<void> {
        for (const config of ['tsconfig.json', 'tsconfig.test.json']) {
            const result = await execFileAsync(process.execPath, [path.join(modules, 'typescript/bin/tsc'), '-p', config], { cwd: project });
            expect(result.stdout + result.stderr).toBe('');
        }
        const report = path.join(project, 'test-results.json');
        await execFileAsync(process.execPath, [path.join(modules, 'vitest/vitest.mjs'), 'run', '--reporter=json', '--outputFile', report], {
            cwd: project, maxBuffer: 1024 * 1024,
        });
        expect(JSON.parse(await readFile(report, 'utf8'))).toMatchObject({ success: true, numPassedTests: expectedTests, numFailedTests: 0 });
    }

    await expectCleanCheck();
    await expect(lstat(path.join(project, 'dist'))).rejects.toMatchObject({ code: 'ENOENT' });
    await typecheckAndTest(2);
    const built = await runCli(['--json', 'build'], { cwd: project, env: { SHELLY_PUBLIC_GREETING: 'Hello' } });
    expect(built.exitCode, built.stdout + built.stderr).toBe(0);
    const manifest = JSON.parse(await readFile(path.join(project, 'dist/manifest.json'), 'utf8'));
    expect(manifest.schemaVersion).toBe(1);
    expect(await readFile(path.join(project, 'dist/example-hello.js'), 'utf8')).not.toContain('process.env');

    const created = await runCli(['create', 'Room_1', 'light-strip'], { cwd: project });
    expect(created.exitCode, created.stderr).toBe(0);
    await expectCleanCheck();
    await typecheckAndTest(4);

    await appendFile(path.join(project, 'src/example/hello.ts'), '\n[1].map(function (value) { return value + 1; });\n');
    const invalid = await runCli(['--json', 'check'], { cwd: project, env: { SHELLY_PUBLIC_GREETING: 'Hello' } });
    expect(invalid.exitCode).toBe(3);
    expect(JSON.parse(invalid.stdout)).toMatchObject({ ok: false, error: { code: 'BUILD' } });
    expect(invalid.stdout).toContain("Property 'map' does not exist");
    const artifactInvalid = await runCli(['--json', 'check', '--no-typecheck', '--strict'], {
        cwd: project, env: { SHELLY_PUBLIC_GREETING: 'Hello' },
    });
    expect(artifactInvalid.exitCode).toBe(3);
    expect(JSON.parse(artifactInvalid.stdout).error.details.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ rule: 'unsupported-array-method', severity: 'error' }),
    ]));
}, 90000);
