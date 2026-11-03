import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(packageDirectory, 'dist', 'shelly-forge.js');

async function createProject(context, prefix) {
    const projectDirectory = await mkdtemp(path.join(os.tmpdir(), `shelly-forge-${prefix}-`));
    context.after(() => rm(projectDirectory, { recursive: true, force: true }));
    await mkdir(path.join(projectDirectory, 'src'));
    return projectDirectory;
}

async function runCli(projectDirectory, ...args) {
    return execFileAsync(process.execPath, [cliPath, ...args], {
        cwd: projectDirectory,
        env: {
            ...process.env,
            CURRENT_WORKING_DIRECTORY: projectDirectory,
        },
    });
}

async function startRpcFixture(context) {
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
            response.end(JSON.stringify({ result: { id: 23 } }));
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
    return { device: `127.0.0.1:${address.port}`, requests };
}

test('build emits ES5 UTF-8 output and records artifact integrity', async (context) => {
    const projectDirectory = await createProject(context, 'build');
    const source = [
        "const point = { left: 2, right: 3 };",
        "const format = ({ left, right } = point, label = '20 °C — café') => `${label}: ${left + right}`;",
        'print(format());',
        '',
    ].join('\n');

    await writeFile(
        path.join(projectDirectory, 'solutions.config.json'),
        JSON.stringify({
            climate: {
                publish: {
                    src: 'src/publish.ts',
                    device: 'fixture-device',
                },
            },
        })
    );
    await writeFile(path.join(projectDirectory, 'src', 'publish.ts'), source);

    await runCli(projectDirectory, 'build');

    const sourceContent = await readFile(path.join(projectDirectory, 'src', 'publish.ts'));
    const artifactPath = path.join(projectDirectory, 'dist', 'climate-publish.js');
    const artifactContent = await readFile(artifactPath);
    const artifact = artifactContent.toString('utf8');
    const manifest = JSON.parse(
        await readFile(path.join(projectDirectory, 'dist', 'manifest.json'), 'utf8')
    );

    assert.match(artifact, /20 °C — café/u);
    assert.match(artifact, /function/u);
    assert.doesNotMatch(artifact, /\b(?:const|let)\b|=>|`/u);
    assert.equal(manifest.runtime.target, 'es5');
    assert.deepEqual(manifest.scripts, [{
        solutionId: 'climate',
        scriptId: 'publish',
        deployId: 'climate/publish',
        targetScriptName: 'publish',
        sourcePath: 'src/publish.ts',
        sourceSizeBytes: sourceContent.length,
        sourceSha256: createHash('sha256').update(sourceContent).digest('hex'),
        artifactPath: 'dist/climate-publish.js',
        artifactSizeBytes: artifactContent.length,
        artifactSha256: createHash('sha256').update(artifactContent).digest('hex'),
    }]);
});

test('build selectors choose only the requested script', async (context) => {
    const projectDirectory = await createProject(context, 'selectors');
    await writeFile(
        path.join(projectDirectory, 'solutions.config.json'),
        JSON.stringify({
            climate: {
                publish: { src: 'src/publish.ts', device: 'fixture-device' },
                monitor: { src: 'src/monitor.ts', device: 'fixture-device' },
            },
            air: {
                ventilation: { src: 'src/ventilation.ts', device: 'fixture-device' },
            },
        })
    );
    await Promise.all([
        writeFile(path.join(projectDirectory, 'src', 'publish.ts'), 'print("publish");\n'),
        writeFile(path.join(projectDirectory, 'src', 'monitor.ts'), 'print("monitor");\n'),
        writeFile(path.join(projectDirectory, 'src', 'ventilation.ts'), 'print("ventilation");\n'),
    ]);

    for (const [selector, artifactName] of [
        ['climate/publish', 'climate-publish.js'],
        ['climate-monitor', 'climate-monitor.js'],
        ['ventilation', 'air-ventilation.js'],
    ]) {
        await rm(path.join(projectDirectory, 'dist'), { recursive: true, force: true });
        await runCli(projectDirectory, 'build', selector);

        assert.deepEqual(
            (await readdir(path.join(projectDirectory, 'dist'))).sort(),
            ['manifest.json', artifactName].sort()
        );
    }
});

test('deploy rejects invalid, ambiguous, and duplicate targets before making requests', async (context) => {
    const projectDirectory = await createProject(context, 'validation');
    const { device, requests } = await startRpcFixture(context);

    await writeFile(
        path.join(projectDirectory, 'solutions.config.json'),
        JSON.stringify({
            climate: {
                publish: { src: 'src/climate.ts', device },
            },
            ventilation: {
                publish: {
                    src: 'src/ventilation.ts',
                    device,
                    targetScriptName: 'ventilation-publish',
                },
            },
        })
    );

    await assert.rejects(runCli(projectDirectory, 'deploy', 'missing'), (error) => {
        assert.match(error.stderr, /Script selector "missing" not found/u);
        return true;
    });
    await assert.rejects(runCli(projectDirectory, 'deploy', 'publish'), (error) => {
        assert.match(error.stderr, /Script selector "publish" is ambiguous/u);
        return true;
    });

    await writeFile(
        path.join(projectDirectory, 'solutions.config.json'),
        JSON.stringify({
            climate: {
                publish: {
                    src: 'src/climate.ts',
                    device,
                    targetScriptName: 'shared-script',
                },
            },
            ventilation: {
                publish: {
                    src: 'src/ventilation.ts',
                    device,
                    targetScriptName: 'shared-script',
                },
            },
        })
    );

    await assert.rejects(runCli(projectDirectory, 'deploy'), (error) => {
        assert.match(error.stderr, /both target on-device script "shared-script"/u);
        return true;
    });
    assert.deepEqual(requests, []);
});

test('deploy uses targetScriptName and leaves unselected scripts untouched', async (context) => {
    const projectDirectory = await createProject(context, 'deploy');
    const { device, requests } = await startRpcFixture(context);
    await mkdir(path.join(projectDirectory, 'dist'));
    await writeFile(
        path.join(projectDirectory, 'solutions.config.json'),
        JSON.stringify({
            controller: {
                primary: {
                    src: 'src/primary.ts',
                    device,
                    targetScriptName: 'boiler-controller',
                },
                backup: {
                    src: 'src/backup.ts',
                    device,
                    targetScriptName: 'boiler-backup',
                },
            },
        })
    );
    await writeFile(path.join(projectDirectory, 'dist', 'controller-primary.js'), 'print("primary");\n');
    await writeFile(path.join(projectDirectory, 'dist', 'controller-backup.js'), 'print("backup");\n');

    await runCli(projectDirectory, 'deploy', 'controller/primary');

    assert.deepEqual(requests.map(({ path: requestPath }) => requestPath), [
        '/rpc', '/rpc', '/rpc', '/rpc/Script.PutCode', '/rpc',
    ]);
    assert.deepEqual(requests.map(({ body }) => body.method), [
        'Script.List', 'Script.Create', 'Script.SetConfig', undefined, 'Script.Start',
    ]);
    assert.deepEqual(requests[1].body.params, { name: 'boiler-controller' });
    assert.deepEqual(requests[2].body.params, {
        id: 23,
        name: 'boiler-controller',
        enable: true,
    });
    assert.equal(requests[3].body.code, 'print("primary");\n');
    assert.equal(requests[3].body.append, false);
});

test('deploy cache tracks both the device and on-device script name', async (context) => {
    const projectDirectory = await createProject(context, 'deploy-cache');
    const first = await startRpcFixture(context);
    const second = await startRpcFixture(context);
    await mkdir(path.join(projectDirectory, 'dist'));
    await writeFile(path.join(projectDirectory, 'dist', 'controller-primary.js'), 'print("primary");\n');

    const configure = (device, targetScriptName) => writeFile(
        path.join(projectDirectory, 'solutions.config.json'),
        JSON.stringify({ controller: { primary: { src: 'src/primary.ts', device, targetScriptName } } })
    );

    await configure(first.device, 'original-name');
    await runCli(projectDirectory, 'deploy', 'controller/primary');
    assert.equal(first.requests.length, 5);

    await runCli(projectDirectory, 'deploy', 'controller/primary');
    assert.equal(first.requests.length, 5);

    await configure(first.device, 'new-name');
    await runCli(projectDirectory, 'deploy', 'controller/primary');
    assert.equal(first.requests.length, 10);
    assert.deepEqual(first.requests[6].body.params, { name: 'new-name' });

    await configure(second.device, 'new-name');
    await runCli(projectDirectory, 'deploy', 'controller/primary');
    assert.equal(second.requests.length, 5);
    assert.deepEqual(second.requests[1].body.params, { name: 'new-name' });
});
