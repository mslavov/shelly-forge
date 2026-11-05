import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, onTestFinished, vi } from 'vitest';
import { dev } from '../../src/commands/dev.js';
import * as buildModule from '../../src/build/build-project.js';
import { RpcClient } from '../../src/device/rpc-client.js';
import { startFakeLogServer } from '../helpers/fake-log-server.js';
import { runCli } from '../helpers/project.js';
import { fixture, source } from './helpers.js';

it('rebuilds nested source edits, rejects type errors, recovers, and uses the deploy cache', async () => {
    const setup = await fixture();
    const pending = setup.start({ logs: false }, true);
    await setup.waitForCycle(event => event.status === 'deployed');
    expect(setup.device.scripts.get(1)?.code).toContain('first');
    const sourcePath = path.join(setup.project.dir, 'src/lights/room.ts');
    async function writeSource(content: string) {
        await writeFile(`${sourcePath}.tmp`, content);
        await rename(`${sourcePath}.tmp`, sourcePath);
    }
    let before = setup.cycles().length;
    await writeSource(source('second'));
    await setup.waitForCycle(event => event.status === 'deployed' && setup.device.scripts.get(1)?.code.includes('second') === true, before);
    expect(setup.device.scripts.get(1)?.code).toContain('second');
    const uploads = () => setup.device.requests.filter(request => request.method === 'Script.PutCode');
    expect(uploads()).toHaveLength(2);
    before = setup.cycles().length;
    await writeSource('const message: string = 42; print(message);');
    const failed = await setup.waitForCycle(event => event.status === 'failed', before);
    expect(failed).toMatchObject({ status: 'failed', error: { code: 'BUILD', details: { findings: [expect.objectContaining({ rule: 'typescript' })] } } });
    expect(setup.logger.error.mock.calls.flat().join('\n')).toContain('typescript');
    expect(uploads()).toHaveLength(2);
    before = setup.cycles().length;
    await writeSource(source('third'));
    await setup.waitForCycle(event => event.status === 'deployed' && setup.device.scripts.get(1)?.code.includes('third') === true, before);
    expect(setup.device.scripts.get(1)?.code).toContain('third');
    before = setup.cycles().length;
    await writeSource(source('third'));
    expect(await setup.waitForCycle(event => event.status === 'unchanged', before)).toMatchObject({ durationMs: expect.any(Number) });
    expect(uploads()).toHaveLength(3);
    expect(setup.text.some(line => /^\[lights\/room\] cycle \d+: deployed in \d+ ms$/.test(line))).toBe(true);
    setup.controller.abort();
    expect((await pending).data).toEqual({ cycles: setup.cycles().length, deploys: 3, failures: setup.cycles().filter(event => event.status === 'failed').length });
    const config = await new RpcClient({ host: setup.device.host, username: 'admin' }).call('Sys.GetConfig');
    expect(config).toMatchObject({ debug: { websocket: { enable: false } } });
});

it('does not deploy a build superseded by an edit and type-checks the queued revision', async () => {
    const setup = await fixture();
    let release!: () => void;
    let built!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { built = resolve; });
    const original = buildModule.buildProject;
    const spy = vi.spyOn(buildModule, 'buildProject').mockImplementationOnce(async (...args) => {
        const result = await original(...args);
        built();
        await held;
        return result;
    });
    onTestFinished(() => spy.mockRestore());
    const pending = setup.start();
    try {
        await ready;
        await setup.edit('const message: string = 42; print(message);');
    } finally {
        release();
    }
    expect((await setup.waitForCycles(2)).map(event => event.status)).toEqual(['superseded', 'failed']);
    expect(setup.device.requests.some(request => request.method === 'Script.PutCode')).toBe(false);
    await setup.edit(source('latest'));
    await setup.waitForCycles(3);
    setup.controller.abort();
    expect((await pending).data).toEqual({ cycles: 3, deploys: 1, failures: 1 });
});

it('keeps watching after a failed initial build and an artifact-check failure', async () => {
    const setup = await fixture({}, { 'src/lights/room.ts': 'const message: string = 42; print(message);' });
    const pending = setup.start();
    await setup.waitForCycles(1);
    expect(setup.device.requests.some(request => request.method === 'Script.PutCode')).toBe(false);
    await setup.edit('print(process.env.SHELLY_PUBLIC_MISSING);');
    expect((await setup.waitForCycles(2))[1]).toMatchObject({ status: 'failed', error: { code: 'CHECK' } });
    expect(setup.device.requests.some(request => request.method === 'Script.PutCode')).toBe(false);
    await setup.edit(source('fixed'));
    await setup.waitForCycles(3);
    setup.controller.abort();
    expect((await pending).data).toEqual({ cycles: 3, deploys: 1, failures: 2 });
});

it.each([
    ['Script.PutCode', { type: 'rpc' as const, code: 500, message: 'upload unavailable' }, 'DEPLOY'],
    ['Script.Start', { type: 'crash' as const, errors: ['crashed'], error_msg: 'bad script' }, 'UNHEALTHY'],
    ['Script.List', { type: 'rpc' as const, code: 500, message: 'device unavailable' }, 'DEVICE_RPC'],
    ['Sys.GetConfig', { type: 'rpc' as const, code: 500, message: 'debug unavailable' }, 'DEVICE_RPC'],
])('reports %s failures and deploys on the next edit', async (method, failure, code) => {
    const setup = await fixture({ failures: { [method]: failure } });
    const pending = setup.start();
    expect((await setup.waitForCycles(1))[0]).toMatchObject({ status: 'failed', error: { code } });
    await setup.edit(source('recovered'));
    expect((await setup.waitForCycles(2))[1]).toMatchObject({ status: 'deployed' });
    setup.controller.abort();
    expect((await pending).data).toEqual({ cycles: 2, deploys: 1, failures: 1 });
});

it.each([
    { debugWebsocket: true, keepDebug: false, expectedWrites: 0 },
    { debugWebsocket: false, keepDebug: true, expectedWrites: 1 },
])('does not disable debug it must preserve: %j', async ({ debugWebsocket, keepDebug, expectedWrites }) => {
    const setup = await fixture({ debugWebsocket });
    const pending = setup.start({ logs: false, keepDebug });
    await setup.waitForCycles(1);
    setup.controller.abort();
    await pending;
    expect(setup.device.requests.filter(request => request.method === 'Sys.SetConfig')).toHaveLength(expectedWrites);
    const config = await new RpcClient({ host: setup.device.host, username: 'admin' }).call('Sys.GetConfig');
    expect(config).toMatchObject({ debug: { websocket: { enable: true } } });
    for (const handle of setup.watcher.handles) expect(handle.close).toHaveBeenCalledOnce();
});

it('streams authenticated logs with the same text and JSON records as logs', async () => {
    const password = 'dev-test-password';
    const setup = await fixture({ password });
    const logServer = await startFakeLogServer({ password, rpcHost: setup.device.host, messages: [{ ts: 42, level: 'info', data: 'ready' }, 'plain'] });
    onTestFinished(() => logServer.close());
    await writeFile(path.join(setup.project.dir, 'solutions.config.json'), JSON.stringify({ lights: { room: {
        src: 'src/lights/room.ts', device: logServer.host,
    } } }));
    setup.ctx.json = true;
    const pending = setup.start({});
    await setup.waitForCycles(1);
    expect(setup.events.filter(event => event.type === 'log')).toEqual([
        { type: 'log', device: logServer.host, ts: 42, level: 'info', message: 'ready' },
        { type: 'log', device: logServer.host, ts: undefined, level: undefined, message: 'plain' },
    ]);
    expect(setup.text).toContain('[lights/room] ready');
    setup.controller.abort();
    await pending;
    await vi.waitFor(() => expect(logServer.connections.size).toBe(0));
    expect(JSON.stringify({ events: setup.events, logs: Object.values(setup.logger).map(log => log.mock.calls) })).not.toContain(password);
});

it('honors --no-logs while still enabling and restoring debug', async () => {
    const setup = await fixture();
    const logServer = await startFakeLogServer({ rpcHost: setup.device.host });
    onTestFinished(() => logServer.close());
    await writeFile(path.join(setup.project.dir, 'solutions.config.json'), JSON.stringify({ lights: { room: {
        src: 'src/lights/room.ts', device: logServer.host,
    } } }));
    const pending = setup.start();
    await setup.waitForCycles(1);
    setup.controller.abort();
    await pending;
    expect(logServer.connectionCount).toBe(0);
    expect(setup.device.requests.filter(request => request.method === 'Sys.SetConfig')).toHaveLength(2);
});

it('finishes an in-flight debug enable before restoring it after abort', async () => {
    const setup = await fixture({ failures: { 'Sys.SetConfig': { type: 'delay', ms: 150 } } });
    const pending = setup.start();
    await vi.waitFor(() => expect(setup.device.requests.some(request => request.method === 'Sys.SetConfig')).toBe(true));
    setup.controller.abort();
    expect((await pending).data).toEqual({ cycles: 1, deploys: 0, failures: 0 });
    expect(setup.device.requests.some(request => request.method === 'Script.PutCode')).toBe(false);
    expect(setup.device.requests.filter(request => request.method === 'Sys.SetConfig')).toHaveLength(2);
    expect(setup.events.at(-1)).toMatchObject({ status: 'interrupted' });
});

it('finishes an in-flight upload and starts the script on abort without running queued edits', async () => {
    const setup = await fixture({ failures: { 'Script.PutCode': { type: 'delay', ms: 150 } } });
    const pending = setup.start();
    await vi.waitFor(() => expect(setup.device.requests.some(request => request.method === 'Script.PutCode')).toBe(true));
    setup.watcher.change();
    setup.controller.abort();
    expect((await pending).data).toEqual({ cycles: 1, deploys: 0, failures: 0 });
    expect(setup.device.requests.some(request => request.method === 'Script.Start')).toBe(true);
    expect(setup.device.scripts.get(1)?.running).toBe(true);
    expect(setup.device.requests.filter(request => request.method === 'Sys.SetConfig')).toHaveLength(2);
});

it('reloads .env values on native file events', async () => {
    const setup = await fixture({}, {
        '.env': 'SHELLY_PUBLIC_MESSAGE=first\n',
        'src/lights/room.ts': 'print(process.env.SHELLY_PUBLIC_MESSAGE);',
    });
    const pending = setup.start({ logs: false }, true);
    await setup.waitForCycle(event => event.status === 'deployed');
    expect(setup.device.scripts.get(1)?.code).toContain('first');
    const before = setup.cycles().length;
    await writeFile(path.join(setup.project.dir, '.env'), 'SHELLY_PUBLIC_MESSAGE=second\n');
    await setup.waitForCycle(event => event.status === 'deployed' && setup.device.scripts.get(1)?.code.includes('second') === true, before);
    expect(setup.device.scripts.get(1)?.code).toContain('second');
    setup.controller.abort();
    expect((await pending).data).toEqual({ cycles: setup.cycles().length, deploys: 2, failures: 0 });
});

it('preserves inherited environment values over edited .env values', async () => {
    const setup = await fixture({}, {
        '.env': 'SHELLY_PUBLIC_MESSAGE=from-file\n',
        'src/lights/room.ts': 'print(process.env.SHELLY_PUBLIC_MESSAGE);',
    });
    const pending = dev(setup.ctx, 'room', { logs: false }, {
        watch: setup.watcher.watch, debounceMs: 1, inheritedEnv: { SHELLY_PUBLIC_MESSAGE: 'inherited' },
    });
    onTestFinished(async () => { setup.controller.abort(); await pending; });
    await setup.waitForCycles(1);
    expect(setup.device.scripts.get(1)?.code).toContain('inherited');
    await writeFile(path.join(setup.project.dir, '.env'), 'SHELLY_PUBLIC_MESSAGE=edited\n');
    setup.watcher.change();
    expect((await setup.waitForCycles(2))[1]).toMatchObject({ status: 'unchanged' });
    setup.controller.abort();
    expect((await pending).data).toEqual({ cycles: 2, deploys: 1, failures: 0 });
});

it('reloads changed target names and survives invalid project configuration', async () => {
    const setup = await fixture();
    const pending = setup.start();
    await setup.waitForCycles(1);
    const configPath = path.join(setup.project.dir, 'solutions.config.json');
    await writeFile(configPath, '{');
    setup.watcher.change();
    expect((await setup.waitForCycles(2))[1]).toMatchObject({ status: 'failed', error: { code: 'CONFIG' } });
    await writeFile(configPath, JSON.stringify({ lights: { room: {
        src: 'src/lights/room.ts', device: setup.device.host, targetScriptName: 'renamed',
    } } }));
    setup.watcher.change();
    await setup.waitForCycles(3);
    expect([...setup.device.scripts.values()].map(script => script.name)).toEqual(['controller', 'renamed']);
    setup.controller.abort();
    expect((await pending).data).toEqual({ cycles: 3, deploys: 2, failures: 1 });
});

it('deploys and rebuilds when unselected entries have unset device variables', async () => {
    const setup = await fixture();
    await writeFile(path.join(setup.project.dir, 'solutions.config.json'), JSON.stringify({ lights: {
        room: { src: 'src/lights/room.ts', device: setup.device.host, targetScriptName: 'controller' },
        missingHost: { src: 'src/lights/room.ts', device: '${MISSING_HOST}', targetScriptName: 'controller' },
        missingPassword: { src: 'src/lights/room.ts', device: setup.device.host, password: '${MISSING_PASSWORD}', targetScriptName: 'controller' },
    } }));
    const pending = setup.start();
    expect((await setup.waitForCycles(1))[0]).toMatchObject({ status: 'deployed' });
    await setup.edit(source('updated'));
    expect((await setup.waitForCycles(2))[1]).toMatchObject({ status: 'deployed' });
    setup.controller.abort();
    expect((await pending).data).toEqual({ cycles: 2, deploys: 2, failures: 0 });
    expect([...setup.device.scripts.values()]).toMatchObject([{ name: 'controller', running: true }]);
});

it.each([NaN, 0, -1, 1.5, Infinity, 0x100000000])('rejects invalid verify timeout %s before watching, building, or contacting the device', async verifyTimeout => {
    const setup = await fixture({}, { 'src/lights/room.ts': 'const message: string = 42;' });
    await expect(dev(setup.ctx, 'room', { verifyTimeout }, { watch: setup.watcher.watch }))
        .rejects.toMatchObject({ code: 'USAGE', exitCode: 2 });
    expect(setup.watcher.handles).toEqual([]);
    expect(setup.device.requests).toEqual([]);
    expect(setup.cycles()).toEqual([]);
});

it('reports log authentication failure without stopping the dev loop', async () => {
    const setup = await fixture();
    const logServer = await startFakeLogServer({ password: 'log-only-password', rpcHost: setup.device.host });
    onTestFinished(() => logServer.close());
    await writeFile(path.join(setup.project.dir, 'solutions.config.json'), JSON.stringify({ lights: { room: {
        src: 'src/lights/room.ts', device: logServer.host,
    } } }));
    setup.ctx.json = true;
    const pending = setup.start({});
    await setup.waitForCycles(1);
    expect(setup.events).toContainEqual(expect.objectContaining({
        type: 'dev-error', source: 'logs', error: expect.objectContaining({ code: 'DEVICE_AUTH' }),
    }));
    expect(setup.cycles()[0]).toMatchObject({ status: 'deployed' });
    setup.controller.abort();
    expect((await pending).data).toEqual({ cycles: 1, deploys: 1, failures: 0 });
});

it('reports watcher errors and still processes changes from the remaining watcher', async () => {
    const setup = await fixture();
    const pending = setup.start();
    await setup.waitForCycles(1);
    setup.watcher.handles[0].emit('error', new Error('watch unavailable'));
    expect(setup.logger.error).toHaveBeenCalledWith('watch: watch unavailable');
    await setup.edit(source('still-watching'));
    await setup.waitForCycle(event => event.status === 'deployed' && setup.device.scripts.get(1)?.code.includes('still-watching') === true, 1);
    setup.controller.abort();
    expect((await pending).data).toMatchObject({ deploys: 2, failures: 0 });
});

it('updates the reused log stream label when a selector moves to another solution', async () => {
    const setup = await fixture();
    const logServer = await startFakeLogServer({ rpcHost: setup.device.host });
    onTestFinished(() => logServer.close());
    const configPath = path.join(setup.project.dir, 'solutions.config.json');
    const entry = { src: 'src/lights/room.ts', device: logServer.host, targetScriptName: 'controller' };
    await writeFile(configPath, JSON.stringify({ lights: { room: entry } }));
    const pending = dev(setup.ctx, 'room', {}, { watch: setup.watcher.watch, debounceMs: 1 });
    onTestFinished(async () => { setup.controller.abort(); await pending; });
    await setup.waitForCycles(1);
    await logServer.waitForConnections(1);
    logServer.send('first-label');
    await vi.waitFor(() => expect(setup.text).toContain('[lights/room] first-label'));
    await writeFile(configPath, JSON.stringify({ heating: { room: entry } }));
    setup.watcher.change();
    await setup.waitForCycles(2);
    logServer.send('new-label');
    await vi.waitFor(() => expect(setup.text).toContain('[heating/room] new-label'));
    expect(logServer.connectionCount).toBe(1);
    expect(setup.cycles()[1]).toMatchObject({ script: 'heating/room', status: 'unchanged' });
    setup.controller.abort();
    await pending;
});

it('rejects absent, unknown, or ambiguous selectors as USAGE before device requests', async () => {
    const setup = await fixture();
    for (const selector of ['', 'missing']) await expect(dev(setup.ctx, selector)).rejects.toMatchObject({ code: 'USAGE' });
    await writeFile(path.join(setup.project.dir, 'solutions.config.json'), JSON.stringify({
        first: { room: { src: 'src/lights/room.ts', device: setup.device.host } },
        second: { room: { src: 'src/lights/room.ts', device: setup.device.host } },
    }));
    await expect(dev(setup.ctx, 'room')).rejects.toMatchObject({ code: 'USAGE', message: expect.stringContaining('ambiguous') });
    expect(setup.device.requests).toEqual([]);
});

it('reports cleanup failure and returns its nonzero exit code', async () => {
    const setup = await fixture();
    const pending = setup.start();
    await setup.waitForCycles(1);
    setup.device.setFailure('Sys.SetConfig', { type: 'rpc', code: 500, message: 'restore failed' });
    setup.controller.abort();
    expect((await pending).exitCode).toBe(4);
    expect(setup.logger.error.mock.calls.flat().join('\n')).toContain('debug cleanup:');
});

it('documents only the supported dev options in CLI help', async () => {
    const setup = await fixture();
    const result = await runCli(['dev', '--help'], { cwd: setup.project.dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('dev [options] <selector>');
    expect(result.stdout).toContain('--no-logs');
    expect(result.stdout).toContain('--keep-debug');
    expect(result.stdout).not.toContain('--debounce');
});
