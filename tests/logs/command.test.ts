import { expect, it, onTestFinished, vi } from 'vitest';
import { logs, type LogsOptions } from '../../src/commands/logs.js';
import { createContext } from '../../src/core/command.js';
import type { Logger } from '../../src/core/logger.js';
import { startFakeDevice } from '../helpers/fake-device.js';
import { startFakeLogServer, type FakeLogServerOptions } from '../helpers/fake-log-server.js';
import { createTempProject, runCli } from '../helpers/project.js';

const quietLogger: Logger = { info() {}, success() {}, warn() {}, error() {}, debug() {} };

async function setup(options: FakeLogServerOptions = {}, extraScripts = false) {
    const fake = await startFakeLogServer(options);
    onTestFinished(() => fake.close());
    const entry = { src: 'src/lights/room.ts', device: fake.host };
    const project = await createTempProject({
        'solutions.config.json': JSON.stringify({ lights: { room: entry, ...(extraScripts ? { hall: { ...entry, src: 'src/lights/hall.ts' } } : {}) } }),
    });
    const events: Record<string, unknown>[] = [];
    const text: string[] = [];
    const controller = new AbortController();
    const ctx = createContext({}, {
        projectDir: project.dir, env: {}, signal: controller.signal, logger: quietLogger,
        emit(event, line) { events.push(event); text.push(line); },
    });
    return { fake, project, ctx, controller, events, text };
}

it('stops after the requested matching lines and summarizes all received lines', async () => {
    const { ctx, fake, text, events } = await setup({ messages: ['skip', 'match one', 'skip', { data: 'match two', ts: 2, level: 3 }, 'match excess'] });
    const result = await logs(ctx, 'room', { enableDebug: false, grep: 'match', lines: 2 });
    expect(text).toEqual(['[lights/room] match one', '[lights/room] match two']);
    expect(events).toEqual([
        { type: 'log', device: fake.host, message: 'match one', ts: undefined, level: undefined },
        { type: 'log', device: fake.host, message: 'match two', ts: 2, level: 3 },
    ]);
    expect(result.data).toEqual({ devices: [{ device: fake.host, lines: 4 }], lines: 4, emitted: 2 });
});

it('deduplicates configured devices and uses the host prefix without a selector', async () => {
    const { ctx, fake, text } = await setup({ messages: ['one'] }, true);
    const result = await logs(ctx, undefined, { enableDebug: false, lines: 1 });
    expect(fake.connectionCount).toBe(1);
    expect(text).toEqual([`[${fake.host}] one`]);
    expect(result.data?.devices).toEqual([{ device: fake.host, lines: 1 }]);
});

it('stops after a duration with no messages', async () => {
    const { ctx } = await setup();
    const result = await logs(ctx, undefined, { enableDebug: false, duration: 0.1 });
    expect(result.data?.lines).toBe(0);
    expect(result.data?.devices).toHaveLength(1);
});

it('warns through the command logger when the log endpoint refuses the upgrade', async () => {
    const { ctx, fake } = await setup({ upgradeStatus: 503 });
    ctx.logger = { ...quietLogger, warn: vi.fn() };
    await logs(ctx, undefined, { enableDebug: false, duration: 0.2 });
    expect(ctx.logger.warn).toHaveBeenCalledExactlyOnceWith(`Could not stream logs from ${fake.host}: HTTP 503`);
});

it('also bounds debug setup by the duration', async () => {
    const device = await startFakeDevice({ failures: { 'Sys.GetConfig': { type: 'delay', ms: 5000 } } });
    onTestFinished(() => device.close());
    const { ctx } = await setup({ rpcHost: device.host });
    const start = performance.now();
    const result = await logs(ctx, undefined, { duration: 0.1 });
    expect(performance.now() - start).toBeLessThan(2000);
    expect(result.data?.lines).toBe(0);
});

it('stops when the command context is aborted', async () => {
    const { ctx, fake, controller } = await setup();
    const pending = logs(ctx, undefined, { enableDebug: false });
    await fake.waitForConnections(1);
    controller.abort();
    expect((await pending).data?.lines).toBe(0);
});

it('counts lines across multiple devices', async () => {
    const first = await startFakeLogServer({ messages: ['a', 'b'] });
    const second = await startFakeLogServer({ messages: ['c', 'd'] });
    onTestFinished(async () => { await first.close(); await second.close(); });
    const project = await createTempProject({ 'solutions.config.json': JSON.stringify({ lights: {
        first: { src: 'src/first.ts', device: first.host },
        second: { src: 'src/second.ts', device: second.host },
    } }) });
    const ctx = createContext({}, { projectDir: project.dir, env: {}, logger: quietLogger, emit() {} });
    const result = await logs(ctx, undefined, { enableDebug: false, lines: 4 });
    expect(result.data).toEqual({ devices: [{ device: first.host, lines: 2 }, { device: second.host, lines: 2 }], lines: 4, emitted: 4 });
});

it.each<LogsOptions>([
    { duration: 0 }, { duration: -1 }, { duration: NaN }, { duration: Infinity }, { duration: 2147484 },
    { lines: 0 }, { lines: -1 }, { lines: 0.5 }, { lines: NaN }, { lines: Infinity }, { grep: '[' },
])('rejects invalid options before loading the project: %j', async options => {
    const { dir } = await createTempProject();
    const ctx = createContext({}, { projectDir: dir, env: {}, logger: quietLogger });
    await expect(logs(ctx, undefined, options)).rejects.toMatchObject({ code: 'USAGE' });
});

it('returns an empty summary for an empty configuration', async () => {
    const { dir } = await createTempProject({ 'solutions.config.json': '{}' });
    const ctx = createContext({}, { projectDir: dir, env: {}, logger: quietLogger });
    expect((await logs(ctx)).data).toEqual({ devices: [], lines: 0, emitted: 0 });
});

it('enables debug via RPC and emits NDJSON plus the final envelope', async () => {
    const device = await startFakeDevice();
    onTestFinished(() => device.close());
    const { fake, project } = await setup({ rpcHost: device.host, messages: [{ ts: 42, level: 'info', data: 'ready' }, 'plain'] });
    const result = await runCli(['--json', 'logs', '--lines', '2'], { cwd: project.dir });
    expect(result.exitCode).toBe(0);
    const output = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(output.slice(0, 2)).toEqual([
        { type: 'log', device: fake.host, ts: 42, level: 'info', message: 'ready' },
        { type: 'log', device: fake.host, message: 'plain' },
    ]);
    expect(output[2]).toMatchObject({ ok: true, exitCode: 0, command: 'logs', data: { lines: 2, emitted: 2, devices: [{ device: fake.host, lines: 2 }] } });
    expect(device.requests.map(request => request.method)).toEqual(['Sys.GetConfig', 'Sys.SetConfig']);
    expect(result.stderr).toContain(`Enabled debug websocket logging on ${fake.host}.`);
});

it('does not report a debug change when already enabled', async () => {
    const device = await startFakeDevice({ debugWebsocket: true });
    onTestFinished(() => device.close());
    const { project } = await setup({ rpcHost: device.host, messages: ['hello'] });
    const result = await runCli(['logs', 'room', '--lines', '1'], { cwd: project.dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[lights/room] hello');
    expect(result.stderr).not.toContain('Enabled debug');
    expect(device.requests.map(request => request.method)).toEqual(['Sys.GetConfig']);
});

it('runs without project npm scripts and honors --no-enable-debug', async () => {
    const { project, fake } = await setup({ messages: ['hello'] });
    const result = await runCli(['logs', '--no-enable-debug', '--lines', '1'], { cwd: project.dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`[${fake.host}] hello`);
    expect(result.stderr).toBe('');
});

it('bounds a CLI stream by duration', async () => {
    const { project } = await setup();
    const result = await runCli(['--json', 'logs', '--no-enable-debug', '--duration', '0.1'], { cwd: project.dir });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { lines: 0, emitted: 0 } });
});

it('shows all bounded-stream options in help', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['logs', '--help'], { cwd: dir });
    expect(result.exitCode).toBe(0);
    for (const option of ['--duration <seconds>', '--lines <n>', '--grep <pattern>', '--no-enable-debug']) {
        expect(result.stdout).toContain(option);
    }
});
