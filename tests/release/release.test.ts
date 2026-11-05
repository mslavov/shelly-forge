import { execFile } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/core/paths.js';
import { VERSION } from '../../src/version.js';
import { createTempProject, runCli } from '../helpers/project.js';

const execFileAsync = promisify(execFile);
const releaseCheck = path.join(PACKAGE_ROOT, 'scripts/check-release.mjs');

async function releaseFixture(version: string, versions: unknown): Promise<string> {
    const { dir } = await createTempProject({
        'package.json': JSON.stringify({ version }),
        'versions.json': JSON.stringify(versions),
    });
    return dir;
}

test('release check permits a new stable version', async () => {
    const cwd = await releaseFixture('0.3.0', ['0.1.0', '0.2.1', '0.3.0-beta.1']);
    const { stdout } = await execFileAsync(process.execPath, [releaseCheck, 'versions.json'], { cwd });
    expect(stdout).toBe('version=0.3.0\npublish=true\n');
});

test('release check skips an already published version', async () => {
    const cwd = await releaseFixture('0.3.0', ['0.2.1', '0.3.0', '0.4.0']);
    const { stdout } = await execFileAsync(process.execPath, [releaseCheck, 'versions.json'], { cwd });
    expect(stdout).toBe('version=0.3.0\npublish=false\n');
});

test('release check handles a registry response with one version', async () => {
    const cwd = await releaseFixture('0.3.0', '0.2.1');
    const { stdout } = await execFileAsync(process.execPath, [releaseCheck, 'versions.json'], { cwd });
    expect(stdout).toBe('version=0.3.0\npublish=true\n');
});

test.each([
    ['a downgrade', '0.2.2', ['0.3.0']],
    ['a prerelease', '0.3.0-beta.1', ['0.2.1']],
    ['an invalid version', '0.3.0\npublish=true', ['0.2.1']],
    ['a malformed registry response', '0.3.0', { error: 'unavailable' }],
])('release check rejects %s', async (_name, version, versions) => {
    const cwd = await releaseFixture(version as string, versions);
    await expect(execFileAsync(process.execPath, [releaseCheck, 'versions.json'], { cwd })).rejects.toThrow();
});

test('version hook updates the generated-project dependency', async () => {
    const cwd = await releaseFixture('0.3.0', []);
    await mkdir(path.join(cwd, 'templates/default'), { recursive: true });
    await writeFile(path.join(cwd, 'templates/default/package.json'), JSON.stringify({ devDependencies: { 'shelly-forge': '^0.2.1' } }));
    await execFileAsync(process.execPath, [path.join(PACKAGE_ROOT, 'scripts/sync-template-version.mjs')], { cwd });
    const template = JSON.parse(await readFile(path.join(cwd, 'templates/default/package.json'), 'utf8'));
    expect(template.devDependencies['shelly-forge']).toBe('^0.3.0');
});

test('release metadata and the CLI use the package version', async () => {
    const metadata = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    const template = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'templates/default/package.json'), 'utf8'));
    const { dir } = await createTempProject();
    const result = await runCli(['--version'], { cwd: dir });
    expect(result.stdout.trim()).toBe(metadata.version);
    expect(VERSION).toBe(metadata.version);
    expect(template.devDependencies['shelly-forge']).toBe(`^${metadata.version}`);
});
