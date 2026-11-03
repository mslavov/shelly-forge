import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function releaseFixture(context, version, versions) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'shelly-forge-release-'));
    context.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ version }));
    await writeFile(path.join(directory, 'versions.json'), JSON.stringify(versions));
    return directory;
}

test('release check permits a new stable version', async (context) => {
    const cwd = await releaseFixture(context, '0.3.0', ['0.1.0', '0.2.1', '0.3.0-beta.1']);
    const { stdout } = await execFileAsync(process.execPath,
        [path.join(packageDirectory, 'scripts/check-release.mjs'), 'versions.json'], { cwd });
    assert.equal(stdout, 'version=0.3.0\npublish=true\n');
});

test('release check skips an already published version', async (context) => {
    const cwd = await releaseFixture(context, '0.3.0', ['0.2.1', '0.3.0', '0.4.0']);
    const { stdout } = await execFileAsync(process.execPath,
        [path.join(packageDirectory, 'scripts/check-release.mjs'), 'versions.json'], { cwd });
    assert.equal(stdout, 'version=0.3.0\npublish=false\n');
});

test('release check handles a registry response with one version', async (context) => {
    const cwd = await releaseFixture(context, '0.3.0', '0.2.1');
    const { stdout } = await execFileAsync(process.execPath,
        [path.join(packageDirectory, 'scripts/check-release.mjs'), 'versions.json'], { cwd });
    assert.equal(stdout, 'version=0.3.0\npublish=true\n');
});

for (const [name, version, versions] of [
    ['a downgrade', '0.2.2', ['0.3.0']],
    ['a prerelease', '0.3.0-beta.1', ['0.2.1']],
    ['an invalid version', '0.3.0\npublish=true', ['0.2.1']],
    ['a malformed registry response', '0.3.0', { error: 'unavailable' }],
]) {
    test(`release check rejects ${name}`, async (context) => {
        const cwd = await releaseFixture(context, version, versions);
        await assert.rejects(execFileAsync(process.execPath,
            [path.join(packageDirectory, 'scripts/check-release.mjs'), 'versions.json'], { cwd }));
    });
}

test('version hook updates the generated-project dependency', async (context) => {
    const cwd = await releaseFixture(context, '0.3.0', []);
    await mkdir(path.join(cwd, 'templates/default'), { recursive: true });
    await writeFile(path.join(cwd, 'templates/default/package.json'),
        JSON.stringify({ devDependencies: { 'shelly-forge': '^0.2.1' } }));
    await execFileAsync(process.execPath,
        [path.join(packageDirectory, 'scripts/sync-template-version.mjs')], { cwd });
    const template = JSON.parse(await readFile(path.join(cwd, 'templates/default/package.json'), 'utf8'));
    assert.equal(template.devDependencies['shelly-forge'], '^0.3.0');
});
