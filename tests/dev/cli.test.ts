import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, onTestFinished, vi } from 'vitest';
import { PACKAGE_ROOT } from '../../src/core/paths.js';
import { runCli } from '../helpers/project.js';
import { fixture } from './helpers.js';

it.each(['invalid', '0', '-1'])('rejects verify timeout %s instead of entering the dev loop', async timeout => {
    const setup = await fixture({}, { 'src/lights/room.ts': 'const message: string = 42;' });
    const result = await runCli(['--json', 'dev', 'room', '--verify-timeout', timeout], { cwd: setup.project.dir });
    expect(result.exitCode).toBe(2);
    const records = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(records).toEqual([expect.objectContaining({ ok: false, exitCode: 2, command: 'dev', error: expect.objectContaining({ code: 'USAGE' }) })]);
    expect(setup.device.requests).toEqual([]);
});

it('streams JSON cycles, reloads .env, and returns a summary after SIGINT', async () => {
    const setup = await fixture({}, {
        '.env': 'SHELLY_PUBLIC_MESSAGE=initial-cli-value\n',
        'src/lights/room.ts': 'print(process.env.SHELLY_PUBLIC_MESSAGE);',
    });
    const env: NodeJS.ProcessEnv = { ...process.env, CURRENT_WORKING_DIRECTORY: setup.project.dir, NO_COLOR: '1' };
    delete env.SHELLY_PUBLIC_MESSAGE;
    const child = spawn(process.execPath, [path.join(PACKAGE_ROOT, 'dist/cli.js'), '--json', 'dev', 'room', '--no-logs'], {
        cwd: setup.project.dir, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const exited = new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
    });
    onTestFinished(async () => {
        if (child.exitCode === null) child.kill('SIGKILL');
        await exited;
    });
    const records = (): Array<Record<string, unknown>> => stdout.slice(0, stdout.lastIndexOf('\n')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    await vi.waitFor(() => expect(records().filter(record => record.status === 'deployed')).toHaveLength(1), { timeout: 7000 });
    expect(setup.device.scripts.get(1)?.code).toContain('initial-cli-value');
    await writeFile(path.join(setup.project.dir, '.env'), 'SHELLY_PUBLIC_MESSAGE=edited-cli-value\n');
    await vi.waitFor(() => expect(records().filter(record => record.status === 'deployed')).toHaveLength(2), { timeout: 7000 });
    expect(setup.device.scripts.get(1)?.code).toContain('edited-cli-value');
    child.kill('SIGINT');
    expect(await exited).toBe(0);
    expect(records().at(-1)).toMatchObject({ ok: true, exitCode: 0, command: 'dev', data: { deploys: 2, failures: 0 } });
    expect(setup.device.requests.filter(request => request.method === 'Sys.SetConfig')).toHaveLength(2);
    expect(stderr).not.toContain('error:');
});
