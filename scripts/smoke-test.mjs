import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run the smoke test with npm run smoke.');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'shelly-forge-smoke-'));

function run(command, args, cwd, capture = false) {
    process.stdout.write(`\n> ${[command, ...args].join(' ')}\n`);
    const result = spawnSync(command, args, {
        cwd,
        env: { ...process.env, CURRENT_WORKING_DIRECTORY: cwd, NO_COLOR: '1' },
        encoding: 'utf8',
        stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
        timeout: 300000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Command failed with ${result.signal ?? `exit code ${result.status}`}: ${command} ${args.join(' ')}`);
    return result.stdout;
}

function runNpm(args, cwd, capture = false) {
    return run(process.execPath, [npmCli, ...args], cwd, capture);
}

try {
    runNpm(['run', 'build'], root);
    const packed = JSON.parse(runNpm(['pack', '--json', '--pack-destination', temporary], root, true));
    const tarball = path.join(temporary, packed[0].filename);
    run('tar', ['-xzf', tarball, '-C', temporary], temporary);
    const cli = path.join(temporary, 'package', 'dist', 'cli.js');

    runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev'], path.dirname(path.dirname(cli)));
    run(process.execPath, [cli, 'init', 'smoke', '--no-skills'], temporary);
    const project = path.join(temporary, 'smoke');
    const metadataPath = path.join(project, 'package.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    const dependencies = Object.entries(metadata.devDependencies)
        .filter(([name]) => name !== 'shelly-forge')
        .map(([name, version]) => `${name}@${version}`);
    runNpm(['install', '--save-dev', '--no-audit', '--no-fund', tarball, ...dependencies], project);
    await copyFile(path.join(project, '.env.example'), path.join(project, '.env'));

    const checked = JSON.parse(runNpm(['exec', '--no', '--', 'shelly-forge', '--json', 'check', '--strict'], project, true));
    assert.equal(checked.ok, true);
    assert.deepEqual(checked.data.findings, []);
    runNpm(['run', 'typecheck'], project);
    runNpm(['test'], project);
    process.stdout.write('\nPacked project smoke test passed.\n');
} finally {
    await rm(temporary, { recursive: true, force: true });
}
