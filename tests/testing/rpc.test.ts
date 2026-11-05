import { expect, test } from 'vitest';
import { RESOURCE_LIMITS } from '../../src/core/runtime-profile.js';
import { createShellyRuntime, RpcError, ShellyScriptError } from '../../src/testing/index.js';

test('RPC calls are recorded as snapshots and callbacks are asynchronous', () => {
    const runtime = createShellyRuntime({ rpc: { echo: (params, rt) => ({ value: params.values.map((value: number) => value * 2), time: rt.now() }) } });
    runtime.load(`var params = {values: [1, 2]}; var user = {value: 'user'};
        Shelly.call('echo', params, function (result, code, message, data) { print(result.value, code, message, data.value, result.time); }, user);
        params.values[0] = 100; print('queued');`);
    expect(runtime.logs).toEqual(['queued']);
    expect(runtime.calls).toEqual([{ method: 'echo', params: { values: [1, 2] } }]);
    runtime.flush();
    expect(runtime.logs.at(-1)).toBe(`[2,4] 0  user ${runtime.now()}`);
});

test('RPC callbacks may enqueue callbacks in the same flush and use removed-array-method-free host code', () => {
    const runtime = createShellyRuntime({ rpc: { echo: params => params } });
    runtime.load(`Shelly.call('echo', {values: [1, 2]}, function (result) {
        print(typeof result.values.map, result.values.length);
        Shelly.call('echo', {}, function () { print('nested'); });
    });`);
    runtime.flush();
    expect(runtime.logs).toEqual(['undefined 2', 'nested']);
});

test('RPC in-flight limit includes calls without callbacks and resets after flush', () => {
    const runtime = createShellyRuntime();
    runtime.load(`for (var i = 0; i < ${RESOURCE_LIMITS.inFlightCalls}; i++) Shelly.call('unknown', {});`);
    runtime.load(`try { Shelly.call('unknown', {}); } catch (error) { print(error.message); }`);
    expect(runtime.logs).toEqual(['inFlightCalls limit exceeded (5)']);
    runtime.flush();
    expect(() => runtime.load(`Shelly.call('unknown', {});`)).not.toThrow();
});

test('RPC unknown methods and custom errors return null and error codes', () => {
    const runtime = createShellyRuntime({ rpc: { denied: () => { throw new RpcError(-109, 'denied'); } } });
    runtime.load(`function result(value, code, message) { print(value, code, message); }
        Shelly.call('HTTP.GET', {url: 'https://invalid.local'}, result);
        Shelly.call('not.real', {}, result); Shelly.call('denied', {}, result);`);
    runtime.flush();
    expect(runtime.logs).toEqual(['null -114 method not simulated: HTTP.GET', 'null -114 method not simulated: not.real', 'null -109 denied']);
});

test('overrides replace built-ins, and unexpected handler errors propagate', () => {
    const runtime = createShellyRuntime({ rpc: {
        'KVS.Get': () => ({ value: 'override' }),
        broken: () => { throw new Error('handler broke'); },
    } });
    runtime.load(`Shelly.call('KVS.Get', {key: 'missing'}, function (result) { print(result.value); });`);
    runtime.flush();
    expect(runtime.logs).toEqual(['override']);
    runtime.load(`Shelly.call('broken', {});`);
    expect(() => runtime.flush()).toThrow(ShellyScriptError);
});

test('Switch.Set, Toggle and GetStatus update components and notify status handlers', () => {
    const runtime = createShellyRuntime({ components: { 'switch:0': { status: { output: false }, config: { name: 'Desk' } } } });
    runtime.load(`
        Shelly.addStatusHandler(function (event) { print(event.component, event.id, event.delta.output); });
        Shelly.call('Switch.Set', {id: 0, on: true}, function (result) { print(result.was_on); });
        Shelly.call('Switch.Toggle', {id: 0}, function (result) { print(result.was_on); });
        Shelly.call('Switch.GetStatus', {id: 0}, function (result) { print(result.id, result.output, result.source); });
        Shelly.call('Switch.GetStatus', {id: 12}, function (result, code) { print(result, code); });
        Shelly.call('Switch.Set', {id: 0, on: 1}, function (result, code) { print(result, code); });
    `);
    runtime.flush();
    expect(runtime.logs).toEqual(['switch:0 0 true', 'false', 'switch:0 0 false', 'true', '0 false script', 'null -105', 'null -103']);
});

test('switch toggle_after uses virtual time and a new command cancels it', () => {
    const runtime = createShellyRuntime({ components: { 'switch:0': { status: { output: false } } } });
    runtime.load(`Shelly.call('Switch.Set', {id: 0, on: true, toggle_after: 1});`);
    runtime.advance(1000);
    runtime.load(`print(Shelly.getComponentStatus('switch:0').output);
        Shelly.call('Switch.Set', {id: 0, on: true, toggle_after: 1});`);
    runtime.flush();
    runtime.advance(500);
    runtime.load(`Shelly.call('Switch.Set', {id: 0, on: true});`);
    runtime.advance(500);
    runtime.load(`print(Shelly.getComponentStatus('switch:0').output);`);
    expect(runtime.logs).toEqual(['false', 'true']);
});

test('device info and system status use configured identity and virtual time', () => {
    const runtime = createShellyRuntime({ now: 1000, deviceInfo: { id: 'test', mac: 'ABC' } });
    runtime.advance(2500);
    runtime.load(`Shelly.call('Shelly.GetDeviceInfo', null, function (result) { print(result.id); });
        Shelly.call('Sys.GetStatus', null, function (result) { print(result.mac, result.uptime, result.unixtime); });
        print(Shelly.getComponentStatus('sys').uptime);`);
    runtime.flush();
    expect(runtime.logs).toEqual(['2', 'test', 'ABC 2 3']);
});

test('RPC-triggered status handlers preserve uninspectable thrown values', () => {
    const runtime = createShellyRuntime({ strictBuiltins: false, components: { 'switch:0': { status: { output: false } } } });
    runtime.load(`var thrownProxy = new Proxy({}, { getPrototypeOf: function () { throw new Error('prototype'); } });
        Shelly.addStatusHandler(function () { throw thrownProxy; }); Shelly.call('Switch.Set', {id: 0, on: true});`);
    try { runtime.flush(); expect.fail('Expected a script error'); } catch (error) {
        expect(error).toBeInstanceOf(ShellyScriptError);
        expect(runtime.crashed).toBe(error);
        expect(() => Object.getPrototypeOf((error as ShellyScriptError).original)).toThrow('prototype');
    }
});
