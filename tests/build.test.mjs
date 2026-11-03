import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { ShellyDevice } from '../dist/shelly-device.js';

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
        'const value = (left: number, right: number) => left + right;\nprint("20 °C — café", value(2, 3));\n'
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
    assert.match(artifact, /function\(\w,\w\)/u);
    assert.doesNotMatch(artifact, /=>/u);
    assert.match(artifact, /^\(function\(\)/u);
    assert.doesNotMatch(artifact, /\\(?:xB0|u00B0)/iu);
});

test('deploy sends RPC requests to a local HTTP fixture', async (context) => {
    const requests = [];
    const server = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) {
            chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        requests.push({ path: request.url, body });

        if (body.method === 'Script.List') {
            response.end(JSON.stringify({ result: { scripts: [] } }));
        } else if (body.method === 'Script.Create') {
            response.end(JSON.stringify({ result: { id: 7 } }));
        } else {
            response.end(JSON.stringify({ result: {} }));
        }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    context.after(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    }));

    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const device = new ShellyDevice(`127.0.0.1:${address.port}`);
    const code = 'x'.repeat(1025);
    const originalLog = console.log;
    console.log = () => {};
    try {
        await device.deploy('fixture-script', code, true);
    } finally {
        console.log = originalLog;
    }

    assert.deepEqual(requests.map(({ path }) => path), [
        '/rpc', '/rpc', '/rpc', '/rpc/Script.PutCode', '/rpc/Script.PutCode', '/rpc',
    ]);
    assert.deepEqual(requests.map(({ body }) => body.method).filter(Boolean), [
        'Script.List', 'Script.Create', 'Script.SetConfig', 'Script.Start',
    ]);
    assert.deepEqual(requests.slice(3, 5).map(({ body }) => body.code), [
        code.slice(0, 1024), code.slice(1024),
    ]);
    assert.deepEqual(requests.slice(3, 5).map(({ body }) => body.append), [false, true]);
    assert.deepEqual(requests[2].body.params, { id: 7, name: 'fixture-script', enable: true });
});

test('RPC failures from the HTTP fixture propagate to the caller', async (context) => {
    const server = createServer((_request, response) => {
        response.statusCode = 500;
        response.end('fixture failure');
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    context.after(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    }));

    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const device = new ShellyDevice(`127.0.0.1:${address.port}`);
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        await assert.rejects(device.listScripts(), /Request failed with status code 500/u);
    } finally {
        console.warn = originalWarn;
    }
});
