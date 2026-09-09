import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(packageDirectory, 'dist', 'shelly-forge.js');

test('release metadata uses the package version', async () => {
    const packageMetadata = JSON.parse(
        await readFile(path.join(packageDirectory, 'package.json'), 'utf8')
    );
    const templateMetadata = JSON.parse(
        await readFile(path.join(packageDirectory, 'templates', 'default', 'package.json'), 'utf8')
    );
    const { stdout } = await execFileAsync(process.execPath, [cliPath, '--version']);
    const { MCP_SERVER_INFO } = await import(
        pathToFileURL(path.join(packageDirectory, 'dist', 'mcp-server.js')).href
    );

    assert.equal(stdout.trim(), packageMetadata.version);
    assert.equal(MCP_SERVER_INFO.version, packageMetadata.version);
    assert.equal(templateMetadata.devDependencies['shelly-forge'], `^${packageMetadata.version}`);
});

test('build preserves non-ASCII characters as UTF-8', async (context) => {
    const projectDirectory = await mkdtemp(path.join(os.tmpdir(), 'shelly-forge-build-'));
    context.after(() => rm(projectDirectory, { recursive: true, force: true }));

    await mkdir(path.join(projectDirectory, 'src'));
    await writeFile(
        path.join(projectDirectory, 'solutions.config.json'),
        JSON.stringify({
            weather: {
                publish: {
                    src: 'src/publish.ts',
                    device: 'test-device',
                },
            },
        })
    );
    await writeFile(
        path.join(projectDirectory, 'src', 'publish.ts'),
        'print("20 °C — café");\n'
    );

    await execFileAsync(process.execPath, [cliPath, 'build'], {
        cwd: projectDirectory,
        env: {
            ...process.env,
            CURRENT_WORKING_DIRECTORY: projectDirectory,
        },
    });

    const artifact = await readFile(
        path.join(projectDirectory, 'dist', 'weather-publish.js'),
        'utf8'
    );

    assert.match(artifact, /20 °C — café/u);
    assert.doesNotMatch(artifact, /\\(?:xB0|u00B0)/iu);
});
