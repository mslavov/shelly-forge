import { expect, test } from 'vitest';
import { createShellyRuntime, ShellyScriptError, type ShellyRuntime } from '../../src/testing/index.js';

const callbacks = `
    print('ready');
    MQTT.publish('output', 'before');
    Timer.set(10, true, function () { print('timer'); });
    Shelly.addEventHandler(function () { print('event'); });
    Shelly.addStatusHandler(function () { print('status'); });
    MQTT.subscribe('input', function () { print('mqtt'); });
    MQTT.setConnectHandler(function () { print('connect'); });
    MQTT.setDisconnectHandler(function () { print('disconnect'); });
    HTTPServer.registerEndpoint('state', function (request, response) { print('http'); response.send(); });
    BLE.Scanner.subscribe(function (event) { if (event !== 0) print('ble'); });
    BLE.Scanner.start({duration_ms: 100}, function (event) { if (event !== 0) print('scan'); });
`;

const failures: Array<[string, string, (runtime: ShellyRuntime) => void]> = [
    ['top level', '', runtime => runtime.load('throw new Error("failed");')],
    ['timer', 'Timer.set(1, true, function () { throw new Error("failed"); });', runtime => runtime.advance(1)],
    ['RPC callback', 'Shelly.call("unknown", {}, function () { throw new Error("failed"); });', runtime => runtime.flush()],
    ['event handler', 'Shelly.addEventHandler(function () { throw new Error("failed"); });', runtime => runtime.emitEvent('input:0', {})],
    ['status handler', 'Shelly.addStatusHandler(function () { throw new Error("failed"); });', runtime => runtime.setStatus('switch:0', { output: true })],
    ['MQTT subscription', 'MQTT.subscribe("input", function () { throw new Error("failed"); });', runtime => runtime.mqtt.receive('input', 'value')],
    ['MQTT disconnect', 'MQTT.setDisconnectHandler(function () { throw new Error("failed"); });', runtime => runtime.mqtt.setConnected(false)],
    ['MQTT connect', 'MQTT.setConnectHandler(function () { throw new Error("failed"); });', runtime => { runtime.mqtt.setConnected(false); runtime.mqtt.setConnected(true); }],
    ['HTTP endpoint', 'HTTPServer.registerEndpoint("broken", function () { throw new Error("failed"); });', runtime => { runtime.http.request('broken'); }],
    ['BLE subscriber', 'BLE.Scanner.subscribe(function (event) { if (event === 2) throw new Error("failed"); });', runtime => runtime.ble.advertise({ addr: 'device' })],
    ['BLE scan callback', 'BLE.Scanner.stop(); BLE.Scanner.start({duration_ms: 100}, function (event) { if (event === 2) throw new Error("failed"); });', runtime => runtime.ble.advertise({ addr: 'device' })],
    ['BLE scan start', '', runtime => runtime.load('BLE.Scanner.stop(); BLE.Scanner.start({}, function () { throw new Error("failed"); });')],
    ['BLE scan stop', 'BLE.Scanner.subscribe(function (event) { if (event === 1) throw new Error("failed"); });', runtime => runtime.advance(100)],
];

test.each(failures)('%s errors stop all script callbacks and keep recorded state', (_name, setup, trigger) => {
    const runtime = createShellyRuntime({ kvs: { saved: 'before' } });
    runtime.load(callbacks + setup);
    expect(runtime.crashed).toBeUndefined();
    let thrown: unknown;
    try { trigger(runtime); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(ShellyScriptError);
    expect(runtime.crashed).toBe(thrown);
    expect(runtime.crashed?.original).toMatchObject({ message: 'failed' });
    const logs = [...runtime.logs];
    const calls = [...runtime.calls];
    const now = runtime.now();

    runtime.advance(10_000);
    runtime.flush();
    runtime.emitEvent('input:0', { event: 'push' });
    runtime.setStatus('switch:0', { output: false });
    runtime.mqtt.receive('input', 'after');
    runtime.mqtt.setConnected(false);
    runtime.mqtt.setConnected(true);
    runtime.ble.advertise({ addr: 'after' });
    expect(runtime.http.request('state')).toEqual({ code: 404, body: 'Not found', headers: [] });
    expect(() => runtime.load('print("after");')).toThrow(thrown as ShellyScriptError);

    expect(runtime.now()).toBe(now);
    expect(runtime.logs).toEqual(logs);
    expect(runtime.calls).toEqual(calls);
    expect(runtime.kvs.entries()).toEqual({ saved: 'before' });
    expect(runtime.mqtt.published).toEqual([{ topic: 'output', message: 'before', qos: 0, retain: false }]);
    expect(runtime.crashed).toBe(thrown);
});

test('a repeating timer stops after its first uncaught error', () => {
    const runtime = createShellyRuntime({ now: 0 });
    runtime.load(`var ticks = 0;
        Timer.set(1, true, function () { print(++ticks); if (ticks === 1) throw new Error('first tick'); });
        Timer.set(1, false, function () { print('other timer'); });`);
    expect(() => runtime.advance(20)).toThrow('first tick');
    runtime.advance(20);
    expect(runtime.logs).toEqual(['1']);
    expect(runtime.now()).toBe(1);
});

test('a failed RPC callback discards queued calls without undoing completed calls', () => {
    const runtime = createShellyRuntime();
    runtime.load(`
        Shelly.call('KVS.Set', {key: 'before', value: 'saved'}, function () { print('completed'); });
        Shelly.call('unknown', {}, function () { throw new Error('callback failed'); });
        Shelly.call('KVS.Set', {key: 'after', value: 'not saved'}, function () { print('after'); });
    `);
    expect(() => runtime.flush()).toThrow('callback failed');
    runtime.flush();
    runtime.advance(100);
    expect(runtime.kvs.entries()).toEqual({ before: 'saved' });
    expect(runtime.calls).toHaveLength(3);
    expect(runtime.logs).toEqual(['completed']);
});

test('unexpected RPC handler errors stop the runtime', () => {
    const runtime = createShellyRuntime({ rpc: { broken: () => { throw new Error('handler failed'); } } });
    runtime.load(`Shelly.call('broken'); Timer.set(1, false, function () { print('after'); });`);
    expect(() => runtime.flush()).toThrow('handler failed');
    runtime.advance(10);
    expect(runtime.crashed?.original).toMatchObject({ message: 'handler failed' });
    expect(runtime.logs).toEqual([]);
});

test('caught script and API errors leave the runtime running', () => {
    const runtime = createShellyRuntime();
    runtime.load(`
        try { throw new Error('caught'); } catch (error) { print(error.message); }
        try { Timer.set(-1, false, function () {}); } catch (error) { print(error.message); }
        var handler = Shelly.addEventHandler(function () { throw new Error('nested'); });
        try { Shelly.emitEvent('event', null); } catch (error) { print(error.message); }
        Shelly.removeEventHandler(handler);
        Timer.set(1, false, function () { print('running'); });
    `);
    runtime.advance(1);
    expect(runtime.crashed).toBeUndefined();
    expect(runtime.logs).toEqual(['caught', 'Timer period must be a finite non-negative number', 'nested', 'running']);
});

test('a switch timer status-handler error stops subsequent script work', () => {
    const runtime = createShellyRuntime({ components: { 'switch:0': { status: { output: false } } } });
    runtime.load(`
        Shelly.call('Switch.Set', {id: 0, on: true, toggle_after: 1});
        Shelly.addStatusHandler(function (event) { if (!event.delta.output) throw new Error('switch timer'); });
    `);
    expect(() => runtime.advance(1_000)).toThrow('switch timer');
    expect(runtime.crashed?.original).toMatchObject({ message: 'switch timer' });
});
