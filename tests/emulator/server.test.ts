import { once } from 'node:events';
import { describe, expect, test, vi } from 'vitest';
import { SCRIPT_MAX_BYTES } from '../../src/core/runtime-profile.js';
import { startEmulator, type EmulatorOptions } from '../../src/emulator/index.js';
import { RPC_METHODS } from '../../src/emulator/rpc.js';
import { setDebugWebsocket } from '../../src/device/scripts.js';
import { fixture, logs, upgradeStatus, websocket } from './helpers.js';

test('runs the script lifecycle through the existing clients with chunked UTF-8 code', async () => {
    const { emulator, rpc, scripts, target } = await fixture();
    const id = await scripts.create('example');
    expect(await scripts.list()).toEqual([{ id, name: 'example', enable: false, running: false }]);
    const code = `var message = "${'é🙂'.repeat(450)}"; print(message);`;
    await scripts.putCode(id, code, { chunkSize: 13 });
    expect(await rpc.call('Script.GetCode', { id, offset: 0, len: 1 })).toEqual({ data: 'v', left: Buffer.byteLength(code) - 1 });
    await setDebugWebsocket(rpc, true);
    const stream = logs(target);
    await stream.connected;
    await scripts.setConfig(id, { name: 'renamed', enable: true });
    expect(await rpc.call('Script.GetConfig', { id })).toEqual({ id, name: 'renamed', enable: true });
    await scripts.start(id);
    await vi.waitFor(() => expect(stream.lines).toHaveLength(1));
    expect(stream.lines[0]).toMatchObject({ message: 'é🙂'.repeat(450), level: 2 });
    expect(JSON.parse(stream.lines[0].raw)).toEqual({ ts: expect.any(Number), level: 2, data: 'é🙂'.repeat(450) });
    expect(await scripts.eval(id, 'message.length')).toEqual({ result: '1350' });
    expect(await rpc.call('Script.Start', { id })).toEqual({ was_running: true });
    await expect(scripts.putCode(id, 'print(1);')).rejects.toMatchObject({ details: { code: -114 } });
    await scripts.stop(id);
    await scripts.stop(id);
    expect(await scripts.getStatus(id)).toMatchObject({ running: false });
    await expect(scripts.eval(id, '1')).rejects.toMatchObject({ details: { code: -114 } });
    await rpc.call('Script.Delete', { id });
    expect(emulator.scripts()).toEqual([]);
    await expect(scripts.getStatus(id)).rejects.toMatchObject({ details: { code: -105 } });
});

test('enforces ten scripts, deletes running scripts, and reuses free ids', async () => {
    const { rpc, scripts } = await fixture();
    for (let i = 0; i < 10; i++) expect(await scripts.create(`script-${i}`)).toBe(i + 1);
    await expect(scripts.create('extra')).rejects.toMatchObject({ details: { code: -108 } });
    await scripts.putCode(2, 'Timer.set(20, true, function () { print("alive"); });');
    await scripts.start(2);
    await rpc.call('Script.Delete', { id: 2 });
    expect(await scripts.create('replacement')).toBe(2);
    expect(await scripts.getStatus(2)).toMatchObject({ running: false });
});

test('uses exact byte slices and limits code by UTF-8 bytes without changing stored code on failure', async () => {
    const { scripts, rpc } = await fixture();
    const id = await scripts.create('bytes');
    await scripts.putCode(id, 'é🙂');
    expect(await rpc.call('Script.GetCode', { id, offset: 0, len: 1 })).toEqual({ data: '\uFFFD', left: 5 });
    expect(await rpc.call('Script.GetCode', { id, offset: 2, len: 4 })).toEqual({ data: '🙂', left: 0 });
    expect(await rpc.call('Script.GetCode', { id, offset: 99 })).toEqual({ data: '', left: 0 });
    await rpc.call('Script.PutCode', { id, code: 'x'.repeat(SCRIPT_MAX_BYTES) });
    await expect(rpc.call('Script.PutCode', { id, code: 'é', append: true })).rejects.toMatchObject({ details: { code: -103 } });
    expect(await rpc.call('Script.GetCode', { id, len: 1 })).toEqual({ data: 'x', left: SCRIPT_MAX_BYTES - 1 });
});

test.each([
    { method: 'Script.Create', params: { name: '' } },
    { method: 'Script.GetStatus', params: { id: -1 } },
    { method: 'Script.GetStatus', params: { id: '1' } },
    { method: 'Script.SetConfig', params: { id: 1, config: { enable: 'yes' } } },
    { method: 'Script.PutCode', params: { id: 1, code: 123 } },
    { method: 'Script.PutCode', params: { id: 1, code: 'x', append: 'yes' } },
    { method: 'Script.GetCode', params: { id: 1, offset: -1 } },
    { method: 'Script.GetCode', params: { id: 1, len: 1.5 } },
    { method: 'Sys.SetConfig', params: { config: { debug: { websocket: { enable: 1 } } } } },
])('rejects invalid arguments for $method', async ({ method, params }) => {
    const { scripts, rpc } = await fixture();
    await scripts.create('valid');
    await expect(rpc.call(method, params)).rejects.toMatchObject({ details: { code: -103 } });
});

test.each(['throw new Error("load failed");', 'Timer.set(10, false, function () { throw new Error("timer failed"); });'])
('records crashes and emits one level zero frame for %s', async code => {
    const frames: Array<{ level: number; data: string }> = [];
    const { rpc, scripts, target } = await fixture({ onLog: line => frames.push(line) });
    await setDebugWebsocket(rpc, true);
    const stream = logs(target);
    await stream.connected;
    const id = await scripts.create('crash');
    await scripts.putCode(id, code);
    await scripts.start(id);
    await vi.waitFor(async () => expect(await scripts.getStatus(id)).toMatchObject({ running: false, errors: ['crashed'] }));
    await vi.waitFor(() => expect(stream.lines).toHaveLength(1));
    expect(stream.lines[0]).toMatchObject({ level: 0, message: expect.stringMatching(/^script:1 crashed: .*failed/) });
    expect(frames).toHaveLength(1);
    expect((await scripts.getStatus(id)).error_msg).toContain('failed');
    await scripts.putCode(id, 'print("recovered");');
    await scripts.start(id);
    expect(await scripts.getStatus(id)).not.toHaveProperty('errors');
});

test('an eval error leaves the realm and script running', async () => {
    const { scripts } = await fixture();
    const id = await scripts.create('eval');
    await scripts.putCode(id, 'var count = 4;');
    await scripts.start(id);
    await expect(scripts.eval(id, 'throw new Error("bad eval");')).rejects.toMatchObject({ details: { code: -103, message: expect.stringContaining('bad eval') } });
    expect(await scripts.eval(id, '++count')).toEqual({ result: '5' });
    expect(await scripts.getStatus(id)).toMatchObject({ running: true });
});

test('shares switch, KVS, status and event handlers between scripts and external calls', async () => {
    const frames: string[] = [];
    const { emulator, rpc, scripts } = await fixture({ kvs: { seed: 'value' }, onLog: line => frames.push(line.data) });
    const a = await scripts.create('a');
    const b = await scripts.create('b');
    await scripts.putCode(a, 'Shelly.addStatusHandler(function (e) { print(e.component, e.delta.output); }); Shelly.addEventHandler(function (e) { print(e.info.event); });');
    await scripts.putCode(b, 'Shelly.addStatusHandler(function () { throw new Error("b failed"); }); Shelly.call("KVS.Set", {key:"script", value:"stored"});');
    await scripts.start(a);
    await scripts.start(b);
    expect(await rpc.call('KVS.Get', { key: 'seed' })).toMatchObject({ value: 'value' });
    expect(await rpc.call('KVS.Get', { key: 'script' })).toMatchObject({ value: 'stored' });
    expect(await rpc.call('Switch.Toggle', { id: 0 })).toEqual({ was_on: false });
    expect(frames).toContain('switch:0 true');
    expect(await scripts.getStatus(a)).toMatchObject({ running: true });
    expect(await scripts.getStatus(b)).toMatchObject({ running: false, errors: ['crashed'] });
    await scripts.eval(a, 'Shelly.call("Switch.Set", {id:0, on:false});');
    expect(await rpc.call('Switch.GetStatus', { id: 0 })).toMatchObject({ output: false });
    emulator.setStatus('switch:0', { output: true });
    emulator.emitEvent('input:0', { event: 'single_push' });
    expect(frames).toContain('single_push');
    expect(await rpc.call('Switch.GetStatus', { id: 0 })).toMatchObject({ output: true });
    await rpc.call('Switch.Set', { id: 0, on: false, toggle_after: 0.02 });
    await vi.waitFor(async () => expect(await rpc.call('Switch.GetStatus', { id: 0 })).toMatchObject({ output: true }));
});

test('HTTP GET endpoints expose identity, parse query values, and return all supported methods', async () => {
    const { emulator, rpc } = await fixture({ switches: 2, deviceInfo: { id: 'shelly-test', model: 'test-model' } });
    const info = await fetch(`http://${emulator.host}/shelly`).then(response => response.json());
    expect(info).toMatchObject({ id: 'shelly-test', model: 'test-model', gen: 2, auth_en: false });
    expect(await fetch(`http://${emulator.host}/rpc/Switch.Set?id=1&on=true`).then(r => r.json())).toEqual({ was_on: false });
    const get = (method: string) => fetch(`http://${emulator.host}/rpc/${method}`).then(r => r.json());
    expect(await get('Shelly.GetStatus')).toMatchObject({ sys: { uptime: expect.any(Number) }, 'switch:1': { output: true } });
    expect(await get('Shelly.GetConfig')).toMatchObject({ sys: { debug: { websocket: { enable: false } } }, 'switch:1': { id: 1 } });
    expect(await get('Sys.GetStatus')).toMatchObject({ mac: expect.any(String) });
    expect(await get('Shelly.ListMethods')).toEqual({ methods: [...RPC_METHODS, 'Switch.GetConfig'] });
    expect(await fetch(`http://${emulator.host}/rpc/Script.Create?name=hello`).then(r => r.json())).toEqual({ id: 1 });
    expect(await rpc.call('Shelly.GetStatus')).toHaveProperty('script:1.running', false);
    await expect(rpc.call('Script.Unknown')).rejects.toMatchObject({ details: { code: 404, message: 'No handler for Script.Unknown' } });
    const missing = await fetch(`http://${emulator.host}/rpc/Script.Unknown`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ code: 404, message: 'No handler for Script.Unknown' });
    expect((await fetch(`http://${emulator.host}/missing`)).status).toBe(404);
});

test('rejects malformed, oversized and non-object requests', async () => {
    const { emulator } = await fixture();
    for (const body of ['{', 'null', '[]', '{"method":"Script.List","params":[]}']) {
        expect((await fetch(`http://${emulator.host}/rpc`, { method: 'POST', body })).status).toBe(400);
    }
    expect((await fetch(`http://${emulator.host}/rpc`, { method: 'POST', body: 'x'.repeat(80_000) })).status).toBe(413);
});

test('debug logging starts disabled and onLog still receives output', async () => {
    const onLog = vi.fn();
    const { emulator, rpc, scripts } = await fixture({ onLog });
    expect(await upgradeStatus(emulator.host)).toBe(403);
    const id = await scripts.create('print');
    await scripts.putCode(id, 'print("offline");');
    await scripts.start(id);
    expect(onLog).toHaveBeenCalledWith({ ts: expect.any(Number), level: 2, data: 'offline' });
    expect(await setDebugWebsocket(rpc, true)).toEqual({ changed: true, restartRequired: false });
    expect(await setDebugWebsocket(rpc, true)).toEqual({ changed: false, restartRequired: false });
});

test('reboot replies before restarting enabled scripts and disconnects log sockets', async () => {
    const frames: string[] = [];
    const { rpc, scripts, emulator } = await fixture({ onLog: line => frames.push(line.data) });
    await setDebugWebsocket(rpc, true);
    const socket = await websocket(emulator.host);
    const disconnected = once(socket, 'close');
    const enabled = await scripts.create('enabled');
    const disabled = await scripts.create('disabled');
    for (const id of [enabled, disabled]) {
        await scripts.putCode(id, `print("start-${id}");`);
        await scripts.start(id);
    }
    await scripts.setConfig(enabled, { enable: true });
    expect(await rpc.call('Shelly.Reboot')).toEqual({});
    expect(await scripts.getStatus(disabled)).toMatchObject({ running: true });
    await disconnected;
    await vi.waitFor(async () => expect(await scripts.getStatus(disabled)).toMatchObject({ running: false }));
    expect(await scripts.getStatus(enabled)).toMatchObject({ running: true });
    expect(frames).toEqual(['start-1', 'start-2', 'start-1']);
});

test('close is idempotent, cancels pending reboot and switch timers, and clears its unreferenced ticker', async () => {
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    try {
        const { emulator, rpc, scripts } = await fixture();
        const index = intervals.mock.calls.findIndex(call => call[1] === 20);
        const ticker = intervals.mock.results[index].value as NodeJS.Timeout;
        expect(ticker.hasRef()).toBe(false);
        await setDebugWebsocket(rpc, true);
        const socket = await websocket(emulator.host);
        const disconnected = once(socket, 'close');
        const id = await scripts.create('timer');
        await scripts.putCode(id, 'Timer.set(50, true, function () { print("tick"); });');
        await scripts.start(id);
        await rpc.call('Switch.Set', { id: 0, on: true, toggle_after: 60 });
        const reboot = emulator.reboot();
        const closing = emulator.close();
        expect(emulator.close()).toBe(closing);
        await Promise.all([closing, reboot, disconnected]);
        expect(cleared).toHaveBeenCalledWith(ticker);
        expect(emulator.scripts()[0].running).toBe(false);
        await expect(fetch(`http://${emulator.host}/shelly`)).rejects.toThrow();
    } finally { intervals.mockRestore(); cleared.mockRestore(); }
});

describe('option boundaries', () => {
    test.each([
        { port: -1 }, { port: 65536 }, { port: 0.5 }, { bind: 'http://localhost' },
        { switches: -1 }, { switches: 5 }, { switches: 1.2 }, { kvs: { key: 1 } },
        { deviceInfo: { id: 'bad\nrealm' } }, { deviceInfo: { gen: 1 } },
    ])('rejects %j before listening', async options => {
        await expect(startEmulator(options as EmulatorOptions)).rejects.toMatchObject({ code: 'USAGE' });
    });
    test('allows zero switches and returns an RPC not-found error', async () => {
        const { rpc } = await fixture({ switches: 0 });
        await expect(rpc.call('Switch.GetStatus', { id: 0 })).rejects.toMatchObject({ details: { code: -105 } });
    });
});

test('system status injection does not replace debug configuration', async () => {
    const { emulator, rpc } = await fixture();
    emulator.setStatus('sys', { temperature: 25 });
    expect(await rpc.call('Shelly.GetStatus')).toMatchObject({ sys: { temperature: 25 } });
    expect(await rpc.call('Shelly.GetConfig')).toMatchObject({ sys: { debug: { websocket: { enable: false } } } });
});

test('a queued callback crash does not turn a successful eval into an evaluation error', async () => {
    const { scripts } = await fixture();
    const id = await scripts.create('callback');
    await scripts.putCode(id, 'var value = 1;');
    await scripts.start(id);
    expect(await scripts.eval(id, 'Shelly.call("Switch.Toggle", {id:0}, function () { throw new Error("callback failed"); }); 42;'))
        .toEqual({ result: '42' });
    expect(await scripts.getStatus(id)).toMatchObject({ running: false, errors: ['crashed'], error_msg: expect.stringContaining('callback failed') });
});
