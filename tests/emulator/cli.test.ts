import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { expect, onTestFinished, test, vi } from 'vitest';
import { PACKAGE_ROOT } from '../../src/core/paths.js';
import { createTempProject, runCli } from '../helpers/project.js';
import { fixture } from './helpers.js';

async function launch(env: Record<string, string> = {}, args: string[] = [], files: Record<string, string> = {}) {
    const { dir } = await createTempProject(files);
    const child = spawn(process.execPath, [path.join(PACKAGE_ROOT, 'dist/cli.js'), 'emulate', '--port', '0', '--json', ...args], {
        cwd: dir, env: { ...process.env, SHELLY_EMULATOR_PASSWORD: undefined, CURRENT_WORKING_DIRECTORY: dir, NO_COLOR: '1', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const events: Array<Record<string, unknown>> = [];
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    const reader = createInterface({ input: child.stdout });
    reader.on('line', line => events.push(JSON.parse(line)));
    const exited = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    onTestFinished(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        await exited;
        reader.close();
    });
    await vi.waitFor(() => expect(events[0]?.type).toBe('ready'), { timeout: 5000 });
    return { child, events, exited, host: String(events[0].host), output: () => ({ stdout, stderr }), dir };
}

test('prints one ready event, accepts CLI RPC and exits cleanly on SIGINT', async () => {
    const f = await launch({}, ['--model', 'test-model', '--switches', '2']);
    expect(f.events).toEqual([{ type: 'ready', host: f.host, auth: false }]);
    expect(f.host).toMatch(/^127\.0\.0\.1:\d+$/);
    const result = await runCli(['rpc', 'Shelly.GetDeviceInfo', '--device', f.host, '--json'], { cwd: f.dir });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).data).toMatchObject({ model: 'test-model', auth_en: false });
    f.child.kill('SIGINT');
    expect(await f.exited).toBe(0);
    await vi.waitFor(() => expect(f.events).toHaveLength(2));
    expect(f.events[1]).toMatchObject({ command: 'emulate', ok: true, exitCode: 0, data: { host: f.host } });
    expect(f.output().stderr).toContain(`Emulator listening on ${f.host}`);
});

test('reads its password only from the environment and never logs it', async () => {
    const password = 'emulator-secret-fixture';
    const f = await launch({ SHELLY_EMULATOR_PASSWORD: password }, ['--verbose']);
    expect(f.events[0].auth).toBe(true);
    const result = await runCli(['rpc', 'Script.List', '--device', f.host, '--json'], { cwd: f.dir, env: { SHELLY_PASSWORD: password } });
    expect(result.exitCode).toBe(0);
    const wrong = await runCli(['rpc', 'Script.List', '--device', f.host, '--json'], { cwd: f.dir, env: { SHELLY_PASSWORD: 'wrong' } });
    expect(wrong.exitCode).toBe(4);
    f.child.kill('SIGINT');
    expect(await f.exited).toBe(0);
    expect(f.output().stdout + f.output().stderr).not.toContain(password);
    expect(f.output().stderr).toContain('Emulator RPC Script.List');
});

test('an occupied port exits with usage code 2 and a port hint', async () => {
    const { emulator } = await fixture();
    const { dir } = await createTempProject();
    const result = await runCli(['emulate', '--port', emulator.host.split(':')[1], '--json'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, exitCode: 2, error: { code: 'USAGE', hint: expect.stringContaining('--port') } });
});

test('loads KVS strings and rejects non-string values and invalid port options', async () => {
    const f = await launch({}, ['--kvs', 'initial.json'], { 'initial.json': '{"initial":"stored"}' });
    const result = await runCli(['rpc', 'KVS.Get', '{"key":"initial"}', '--device', f.host, '--json'], { cwd: f.dir });
    expect(JSON.parse(result.stdout).data).toMatchObject({ value: 'stored' });
    const { dir } = await createTempProject({ 'invalid.json': '{"key":1}' });
    for (const args of [['--port', '-1'], ['--switches', '5'], ['--kvs', 'invalid.json']]) {
        const result = await runCli(['emulate', '--json', ...args], { cwd: dir });
        expect(result.exitCode).toBe(2);
    }
    f.child.kill('SIGINT');
    expect(await f.exited).toBe(0);
});

test('treats an empty environment password as unset in readiness and device info', async () => {
    const f = await launch({ SHELLY_EMULATOR_PASSWORD: '' });
    expect(f.events[0]).toMatchObject({ auth: false });
    expect(await fetch(`http://${f.host}/shelly`).then(response => response.json())).toMatchObject({ auth_en: false });
    expect((await fetch(`http://${f.host}/rpc/Script.List`)).status).toBe(200);
    f.child.kill('SIGINT');
    expect(await f.exited).toBe(0);
});

test('loads component status and config relative to the selected project directory', async () => {
    const components = {
        'temperature:0': { status: { id: 0, tC: 21.5 }, config: { name: 'Room' } },
        'switch:0': { status: { id: 0, output: true }, config: { name: 'Lamp' } },
        'pm1:12': { status: { apower: 42 } },
        custom: { config: { nested: { enabled: true }, values: [1, null, 'text'] } },
        'input:1': {},
    };
    const f = await launch({}, ['--cwd', 'project', '--components', 'components.json'], {
        'project/components.json': JSON.stringify(components),
    });
    for (const [method, expected] of [
        ['Shelly.GetStatus', { 'temperature:0': components['temperature:0'].status, 'switch:0': components['switch:0'].status, 'pm1:12': components['pm1:12'].status }],
        ['Shelly.GetConfig', { 'temperature:0': components['temperature:0'].config, 'switch:0': components['switch:0'].config, custom: components.custom.config }],
    ] as const) {
        const result = await runCli(['rpc', method, '--device', f.host, '--json'], { cwd: f.dir });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout).data).toMatchObject(expected);
    }
    f.child.kill('SIGINT');
    expect(await f.exited).toBe(0);
});

test('accepts an empty component object', async () => {
    const f = await launch({}, ['--components', 'components.json'], { 'components.json': '{}' });
    f.child.kill('SIGINT');
    expect(await f.exited).toBe(0);
});

test.each([
    { name: 'missing file', content: undefined, message: 'Could not read --components as JSON' },
    { name: 'malformed JSON', content: '{', message: 'Could not read --components as JSON' },
    ...['[]', 'null', '1', 'true', '"text"'].map(content => ({ name: `top-level ${content}`, content, message: '--components must contain a JSON object' })),
    ...['', 'Switch:0', 'switch:01', 'switch:-1', 'switch:1.5', 'switch:', 'switch:0:1', 'switch_name:0', '1switch:0'].map(key => ({
        name: `key ${key}`, content: JSON.stringify({ [key]: {} }), message: 'Invalid --components key',
    })),
    ...[null, [], 1, 'text', true, { output: true }, { status: null }, { status: [] }, { status: false }, { status: 'text' },
        { config: null }, { config: [] }, { config: 1 }, { config: 'text' }, { status: {}, config: {}, extra: {} }].map(entry => ({
        name: `entry ${JSON.stringify(entry)}`, content: JSON.stringify({ 'switch:0': entry }), message: '--components entry "switch:0"',
    })),
])('rejects invalid component input: $name', async ({ content, message }) => {
    const { dir } = await createTempProject(content === undefined ? {} : { 'components.json': content });
    const result = await runCli(['emulate', '--port', '0', '--components', 'components.json', '--json'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, exitCode: 2,
        error: { code: 'USAGE', message: expect.stringContaining(message) } });
    expect(result.stdout).not.toContain('"type":"ready"');
});

test('rejects unsafe bind and mDNS combinations with usage errors and actionable hints', async () => {
    const { dir } = await createTempProject();
    for (const [args, hint] of [[['--bind', '0.0.0.0'], 'SHELLY_EMULATOR_PASSWORD'], [['--mdns'], '--bind 0.0.0.0']] as const) {
        const result = await runCli(['emulate', '--port', '0', '--json', ...args], {
            cwd: dir, env: { SHELLY_EMULATOR_PASSWORD: '' },
        });
        expect(result.exitCode).toBe(2);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, exitCode: 2,
            error: { code: 'USAGE', hint: expect.stringContaining(hint) } });
    }
});
