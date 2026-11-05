import { once } from 'node:events';
import { request } from 'node:http';
import { connect } from 'node:net';
import { expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { startEmulator } from '../../src/emulator/index.js';
import * as engines from '../../src/testing/engine.js';
import { fixture } from './helpers.js';

test('bounds script start, timers and eval at 1000 ms and continues serving requests', async () => {
    const { scripts, rpc } = await fixture();
    const id = await scripts.create('timeout');
    await scripts.putCode(id, 'while (true) {}');
    let started = performance.now();
    await scripts.start(id);
    expect(performance.now() - started).toBeLessThan(2500);
    expect(await scripts.getStatus(id)).toMatchObject({ running: false, errors: ['crashed'],
        error_msg: 'Shelly script error: Script execution timed out after 1000ms' });
    expect(await rpc.call('Script.List')).toMatchObject({ scripts: [{ id }] });

    await scripts.putCode(id, 'Timer.set(1, false, function () { while (true) {} });');
    await scripts.start(id);
    await vi.waitFor(async () => expect(await scripts.getStatus(id)).toMatchObject({ running: false, errors: ['crashed'],
        error_msg: 'Shelly script error: Script execution timed out after 1000ms' }), { timeout: 2500 });
    expect(await rpc.call('Sys.GetConfig')).toHaveProperty('debug.websocket.enable', false);

    await scripts.putCode(id, 'var value = 42;');
    await scripts.start(id);
    started = performance.now();
    await expect(scripts.eval(id, 'while (true) {}')).rejects.toMatchObject({ details: {
        code: -103, message: 'Shelly script error: Script execution timed out after 1000ms',
    } });
    expect(performance.now() - started).toBeLessThan(2500);
    expect(await scripts.getStatus(id)).toMatchObject({ running: true });
    expect(await scripts.eval(id, 'value')).toEqual({ result: '42' });
}, 10_000);

test('bounds eval result conversion without crashing the script', async () => {
    const { scripts, rpc } = await fixture();
    const id = await scripts.create('conversion');
    await scripts.start(id);
    await expect(scripts.eval(id, '({toString:function(){while(true){}}})')).rejects.toMatchObject({ details: {
        code: -103, message: 'Shelly script error: Script execution timed out after 1000ms',
    } });
    expect(await scripts.getStatus(id)).toMatchObject({ running: true });
    expect(await rpc.call('Script.List')).toMatchObject({ scripts: [{ id }] });
});

test('isolates a nested script start timeout and cross-script event timeout from the caller', async () => {
    const lines: string[] = [];
    const { scripts } = await fixture({ onLog: line => lines.push(line.data) });
    const target = await scripts.create('target');
    const caller = await scripts.create('caller');
    await scripts.putCode(target, 'while(true) {}');
    await scripts.putCode(caller, `Shelly.call("Script.Start", {id:${target}}, function (result, error) { print("started", error, result.was_running); });`);
    await scripts.start(caller);
    await vi.waitFor(() => expect(lines).toContain('started 0 false'), { timeout: 2500 });
    expect(await scripts.getStatus(target)).toMatchObject({ running: false, errors: ['crashed'] });
    expect(await scripts.getStatus(caller)).toMatchObject({ running: true });

    await scripts.putCode(target, 'Shelly.addEventHandler(function () { while(true) {} });');
    await scripts.start(target);
    expect(await scripts.eval(caller, 'Shelly.emitEvent("event", {}); "emitted";')).toEqual({ result: 'emitted' });
    await vi.waitFor(async () => expect(await scripts.getStatus(target)).toMatchObject({ running: false, errors: ['crashed'] }), { timeout: 2500 });
    expect(await scripts.getStatus(caller)).toMatchObject({ running: true });
}, 10_000);

test.each(['0.0.0.0', '::', '192.0.2.1', 'example.test'])('rejects an unauthenticated non-loopback bind %s before listening', async bind => {
    for (const password of [undefined, '']) {
        await expect(startEmulator({ bind, password })).rejects.toMatchObject({
            code: 'USAGE', exitCode: 2, message: 'A password is required for a non-loopback emulator bind',
            hint: 'Set SHELLY_EMULATOR_PASSWORD before using --bind with a non-loopback address.',
        });
    }
});

test.each(['127.0.0.1', '127.2.3.4', 'localhost', '::1'])('rejects mDNS on loopback bind %s before creating a publisher', async bind => {
    const createPublisher = vi.fn();
    await expect(startEmulator({ bind, mdns: true, createPublisher })).rejects.toMatchObject({
        code: 'USAGE', exitCode: 2, message: 'Multicast DNS requires a non-loopback emulator bind',
        hint: 'Use --bind 0.0.0.0 and set SHELLY_EMULATOR_PASSWORD to enable --mdns.',
    });
    expect(createPublisher).not.toHaveBeenCalled();
});

async function upgrade(host: string, headers: Record<string, string>): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://${host}/debug/log`, { headers });
        socket.on('error', reject);
        socket.on('unexpected-response', (_request, response) => {
            response.resume();
            resolve(response.statusCode);
            socket.terminate();
        });
        socket.on('open', () => { resolve(101); socket.terminate(); });
    });
}

function httpStatus(url: string, headers: Record<string, string>, body?: string): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
        const req = request(url, { headers, method: body === undefined ? 'GET' : 'POST' }, response => {
            response.resume();
            resolve(response.statusCode);
        });
        req.on('error', reject);
        req.end(body);
    });
}

test('rejects browser origins and rebinding hosts before HTTP dispatch or websocket authentication', async () => {
    const onRpc = vi.fn();
    const { emulator, rpc } = await fixture({ onRpc });
    await rpc.call('Sys.SetConfig', { config: { debug: { websocket: { enable: true } } } });
    onRpc.mockClear();
    const base = `http://${emulator.host}`;
    const blockedHeaders: Array<Record<string, string>> = [{ Origin: 'http://localhost' }, { Origin: 'null' }, { Origin: '' },
        { Host: 'attacker.example' }, { Host: '127.0.0.1.attacker.example' }, { Host: '127.1' }];
    for (const headers of blockedHeaders) {
        expect(await httpStatus(`${base}/shelly`, headers)).toBe(403);
        expect(await httpStatus(`${base}/rpc/Script.Create?name=blocked`, headers)).toBe(403);
        expect(await httpStatus(`${base}/rpc`, headers, '{"method":"Script.Create","params":{"name":"blocked"}}')).toBe(403);
        expect(await upgrade(emulator.host, headers)).toBe(403);
    }
    expect(onRpc).not.toHaveBeenCalled();
    expect(emulator.scripts()).toEqual([]);
    for (const Host of ['localhost', '127.0.0.1:1234', '[::1]:1234']) {
        expect(await httpStatus(`${base}/shelly`, { Host })).toBe(200);
        expect(await upgrade(emulator.host, { Host })).toBe(101);
    }
    expect(await rpc.call('Script.List')).toEqual({ scripts: [] });
});

test('routes script RPCs and component status through the emulator with asynchronous callbacks', async () => {
    const lines: string[] = [];
    const { scripts, rpc } = await fixture({ onLog: line => lines.push(line.data) });
    const id = await scripts.create('router');
    await scripts.putCode(id, `
        Shelly.call("Shelly.GetStatus", {}, function (result, code) {
            print("status", code, result["script:" + Script.id].running);
        });
        Shelly.call("Sys.GetConfig", {}, function (result) { print("debug", result.debug.websocket.enable); });
        Shelly.call("Script.List", {}, function (result) { print("scripts", result.scripts[0].id); });
        Shelly.call("Unknown.Method", {}, function (result, code, message) { print("missing", code, message); });
        print("loaded", Shelly.getComponentStatus("script", Script.id).running);
    `);
    await scripts.start(id);
    await vi.waitFor(() => expect(lines).toHaveLength(5));
    expect(lines).toEqual(['loaded true', 'status 0 true', 'debug false', `scripts ${id}`, 'missing 404 No handler for Unknown.Method']);
    expect(await rpc.call('Shelly.GetStatus')).toHaveProperty(`script:${id}.running`, true);
    await expect(rpc.call('Unknown.Method')).rejects.toMatchObject({ details: { code: 404, message: 'No handler for Unknown.Method' } });
});

test('defers a self stop until after its callback finishes and discards work queued by the stopped engine', async () => {
    const lines: string[] = [];
    const { scripts } = await fixture({ onLog: line => lines.push(line.data) });
    const id = await scripts.create('self-stop');
    await scripts.putCode(id, `
        Timer.set(1, false, function () {
            Shelly.call("Script.Stop", {id: Script.id});
            print("still running", Shelly.getComponentStatus("script", Script.id).running);
            Shelly.call("Script.Start", {id: Script.id});
        });
    `);
    await scripts.start(id);
    await vi.waitFor(async () => expect(await scripts.getStatus(id)).toMatchObject({ running: false }));
    expect(lines).toEqual(['still running true']);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(await scripts.getStatus(id)).toMatchObject({ running: false });
});

test('defers script management and reboot RPCs while retaining asynchronous results', async () => {
    const lines: string[] = [];
    const { scripts, rpc } = await fixture({ onLog: line => lines.push(line.data) });
    const target = await scripts.create('target');
    const caller = await scripts.create('caller');
    await scripts.putCode(caller, `
        Shelly.call("Script.PutCode", {id:${target}, code:'print("target started");'}, function (result, error) {
            print("code", error, result.len);
            Shelly.call("Script.Start", {id:${target}}, function (result, error) {
                print("start", error, result.was_running);
                Shelly.call("Script.Stop", {id:${target}}, function (result, error) {
                    print("stop", error, result.was_running);
                    Shelly.call("Script.Delete", {id:${target}}, function (result, error) {
                        print("delete", error);
                        Shelly.call("Shelly.Reboot", {}, function (result, error) { print("reboot", error); });
                    });
                });
            });
        });
        print("caller loaded");
    `);
    await scripts.start(caller);
    await vi.waitFor(() => expect(lines).toHaveLength(7));
    expect(lines).toEqual(['caller loaded', 'code 0 24', 'target started', 'start 0 false', 'stop 0 true', 'delete 0', 'reboot 0']);
    await vi.waitFor(async () => expect(await scripts.getStatus(caller)).toMatchObject({ running: false }), { timeout: 1500 });
    expect(await rpc.call('Script.List')).toMatchObject({ scripts: [{ id: caller }] });
});

test('disables both runtime histories in long-running emulator scripts', async () => {
    const createEngine = vi.spyOn(engines, 'createScriptEngine');
    try {
        let printed = 0;
        const { scripts } = await fixture({ onLog: () => { printed++; } });
        const id = await scripts.create('history');
        await scripts.putCode(id, 'function tick() { print("tick"); Shelly.call("Sys.GetStatus", {}, function () { Timer.set(1, false, tick); }); } tick();');
        await scripts.start(id);
        await vi.waitFor(() => expect(printed).toBeGreaterThan(15), { timeout: 2000 });
        expect(createEngine).toHaveBeenCalledWith(expect.objectContaining({ recordHistory: false, executionTimeoutMs: 1000 }));
        const engine = createEngine.mock.results[0].value as engines.ScriptEngine;
        expect(engine.runtime.logs).toEqual([]);
        expect(engine.runtime.calls).toEqual([]);
    } finally { createEngine.mockRestore(); }
});

test('returns 503 for a pending body during close and never dispatches it after close', async () => {
    const onRpc = vi.fn();
    const { emulator } = await fixture({ onRpc });
    const socket = connect({ host: '127.0.0.1', port: Number(emulator.host.split(':')[1]) });
    socket.on('error', () => {});
    await once(socket, 'connect');
    const body = JSON.stringify({ method: 'Script.Create', params: { name: 'after-close' } });
    const chunks: string[] = [];
    socket.on('data', chunk => chunks.push(String(chunk)));
    const disconnected = once(socket, 'close');
    socket.write(`POST /rpc HTTP/1.1\r\nHost: ${emulator.host}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body.slice(0, 1)}`);
    await new Promise(resolve => setTimeout(resolve, 20));
    await emulator.close();
    await disconnected;
    expect(chunks.join('')).toMatch(/^HTTP\/1\.1 503 Service Unavailable/);
    expect(onRpc).not.toHaveBeenCalled();
    expect(emulator.scripts()).toEqual([]);
    await expect(fetch(`http://${emulator.host}/rpc/Script.Create?name=late`)).rejects.toThrow();
});

test('does not dispatch if an RPC observer closes the emulator', async () => {
    let close: (() => Promise<void>) | undefined;
    let closing: Promise<void> | undefined;
    const { emulator } = await fixture({ onRpc: () => { closing = close?.(); } });
    close = () => emulator.close();
    const response = await fetch(`http://${emulator.host}/rpc/Script.Create?name=late`);
    expect(response.status).toBe(503);
    await closing;
    expect(emulator.scripts()).toEqual([]);
});

test('accepts unrelated Sys.SetConfig keys but validates websocket enable when present', async () => {
    const { rpc } = await fixture();
    for (const config of [{}, { device: { name: 'ignored' } }, { debug: { mqtt: { enable: true } } },
        { debug: { websocket: { unused: true } } }]) {
        expect(await rpc.call('Sys.SetConfig', { config })).toEqual({ restart_required: false });
        expect(await rpc.call('Sys.GetConfig')).toHaveProperty('debug.websocket.enable', false);
    }
    expect(await rpc.call('Sys.SetConfig', { config: { device: { name: 'ignored' }, debug: { websocket: { enable: true, other: 1 } } } }))
        .toEqual({ restart_required: false });
    for (const enable of [null, 0, 'true', {}, []]) {
        await expect(rpc.call('Sys.SetConfig', { config: { debug: { websocket: { enable } } } }))
            .rejects.toMatchObject({ details: { code: -103, message: 'Invalid debug config' } });
    }
    expect(await rpc.call('Sys.GetConfig')).toHaveProperty('debug.websocket.enable', true);
});
