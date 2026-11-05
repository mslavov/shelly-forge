import { expect, test, vi } from 'vitest';
import { VirtualClock } from '../../src/testing/clock.js';
import { DeviceState, type DeviceEvent, type DeviceStatusEvent } from '../../src/testing/device-state.js';
import { createScriptEngine, type ScriptEngine } from '../../src/testing/engine.js';
import { RpcError, ShellyScriptError } from '../../src/testing/index.js';

function sharedDevice() {
    const clock = new VirtualClock(1_000);
    const schedule = vi.fn((delay: number, callback: () => void) => ({ id: clock.schedule(delay, callback) }));
    const cancel = vi.fn((handle: unknown) => { clock.cancel((handle as { id: number }).id); });
    const device = new DeviceState({
        scheduler: { now: () => clock.now(), schedule, cancel },
        components: { 'switch:0': { status: { output: false }, config: { name: 'Lamp' } } },
        kvs: { seed: 'shared' },
    });
    return { device, clock, schedule, cancel };
}

test('shared device status handlers run before the calling engine receives its RPC result', () => {
    const { device } = sharedDevice();
    const order: string[] = [];
    const a = createScriptEngine({ device, onPrint: line => order.push(`a ${line}`) });
    const b = createScriptEngine({ device, onPrint: line => order.push(`b ${line}`) });
    b.runtime.load(`Shelly.addStatusHandler(function (event) { print(event.component, event.delta.output); });`);
    a.runtime.load(`Shelly.call('Switch.Toggle', {id: 0}, function (result) { print(result.was_on); });`);
    expect(order).toEqual([]);
    a.runtime.flush();
    expect(order).toEqual(['b switch:0 true', 'a false']);
    expect(b.evaluate(`Shelly.getComponentStatus('switch:0').output`)).toBe(true);
    a.runtime.load(`Shelly.call('KVS.Set', {key: 'other', value: {enabled: true}});`);
    a.runtime.flush();
    expect(b.runtime.kvs.entries()).toEqual({ seed: 'shared', other: '{"enabled":true}' });
    expect(b.runtime.kvs.get('missing')).toBeUndefined();
    expect(b.runtime.kvs.get('toString')).toBeUndefined();
    a.dispose();
    b.dispose();
});

test('a shared status handler crash stops only its engine and does not interrupt other subscribers', () => {
    const { device } = sharedDevice();
    const onCrash = vi.fn();
    const b = createScriptEngine({ device, onCrash });
    const a = createScriptEngine({ device });
    const c = createScriptEngine({ device });
    b.runtime.load(`Shelly.addStatusHandler(function () { throw new Error('b failed'); });
        Timer.set(1, false, function () { print('after crash'); });`);
    c.runtime.load(`Shelly.addStatusHandler(function () { print('c notified'); });`);
    a.runtime.load(`Shelly.call('Switch.Toggle', {id: 0}, function (result, code) { print(result.was_on, code); });`);
    expect(() => a.runtime.flush()).not.toThrow();
    expect(a.runtime.crashed).toBeUndefined();
    expect(c.runtime.crashed).toBeUndefined();
    expect(a.runtime.logs).toEqual(['false 0']);
    expect(c.runtime.logs).toEqual(['c notified']);
    expect(b.runtime.crashed?.message).toContain('b failed');
    expect(onCrash).toHaveBeenCalledExactlyOnceWith(b.runtime.crashed);
    device.setStatus('switch:0', { output: false });
    b.runtime.advance(10);
    expect(b.runtime.logs).toEqual([]);
    expect(onCrash).toHaveBeenCalledTimes(1);
    a.dispose();
    b.dispose();
    c.dispose();
});

test('nested cross-engine events retain the crash boundary of each subscriber', () => {
    const { device } = sharedDevice();
    const a = createScriptEngine({ device });
    const b = createScriptEngine({ device });
    a.runtime.load(`Shelly.addEventHandler(function () { throw new Error('a nested'); });
        Shelly.call('Switch.Toggle', {id: 0}, function () { print('after crash'); });`);
    b.runtime.load(`Shelly.addStatusHandler(function () { Shelly.emitEvent('nested', null); print('b running'); });`);
    expect(() => a.runtime.flush()).toThrow('a nested');
    expect(a.runtime.crashed?.message).toContain('a nested');
    expect(a.runtime.logs).toEqual([]);
    expect(b.runtime.crashed).toBeUndefined();
    expect(b.runtime.logs).toEqual(['b running']);
    expect(b.evaluate('2 + 3')).toBe(5);
    a.dispose();
    b.dispose();
});

test.each([false, true])('a suspended sender stops after a nested crash, even if caught=%s', caught => {
    const { device } = sharedDevice();
    const events: unknown[] = [];
    device.subscribe({ event: event => events.push(event.info.event) });
    const onCrash = vi.fn();
    const a = createScriptEngine({ device, onCrash });
    const b = createScriptEngine({ device });
    a.runtime.load(`Shelly.addEventHandler(function (event) {
        if (event.info.event === 'nested') throw new Error('nested failure');
    });`);
    b.runtime.load(`Shelly.addEventHandler(function (event) {
        if (event.info.event === 'start') { Shelly.emitEvent('nested', null); print('b running'); }
    });`);
    const emit = `Shelly.emitEvent('start', null);`;
    const code = caught ? `try { ${emit} } catch (error) {}
        try { print('after crash'); } catch (error) {}
        Shelly.emitEvent('after crash', null);` : `${emit} print('after crash');`;
    let failure: unknown;
    try { a.runtime.load(code); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ShellyScriptError);
    expect(failure).toBe(a.runtime.crashed);
    expect(a.runtime.crashed?.message).toContain('nested failure');
    expect(a.runtime.logs).toEqual([]);
    expect(events).toEqual(['start', 'nested']);
    expect(onCrash).toHaveBeenCalledExactlyOnceWith(a.runtime.crashed);
    expect(b.runtime.crashed).toBeUndefined();
    expect(b.runtime.logs).toEqual(['b running']);
    a.dispose();
    b.dispose();
});

test('runtime KVS inspection retains keys with embedded line terminators', () => {
    const engine = createScriptEngine({ kvs: { 'seed\nkey': 'seed value' } });
    for (const key of ['new\nkey', 'new\rkey', 'new\u2028key', 'new\u2029key']) {
        engine.runtime.load(`Shelly.call('KVS.Set', {key: ${JSON.stringify(key)}, value: 'saved'});`);
        engine.runtime.flush();
        expect(engine.runtime.kvs.get(key)).toBe('saved');
        expect(engine.runtime.kvs.entries()[key]).toBe('saved');
    }
    expect(engine.runtime.kvs.get('seed\nkey')).toBe('seed value');
    expect(engine.runtime.kvs.entries()['seed\nkey']).toBe('seed value');
    engine.dispose();
});

test.each([undefined, 7])('scriptId %s identifies the script and its emitted events', scriptId => {
    const { device } = sharedDevice();
    const events: DeviceEvent[] = [];
    const unsubscribe = device.subscribe({ event: event => events.push(event) });
    const engine = createScriptEngine({ device, scriptId });
    engine.runtime.load(`print(Script.id, Shelly.getCurrentScriptId()); Shelly.emitEvent('custom', {value: 42});`);
    const id = scriptId ?? 1;
    expect(engine.runtime.logs).toEqual([`${id} ${id}`]);
    expect(events).toEqual([{
        component: `script:${id}`, name: 'script', id,
        info: { component: `script:${id}`, id, ts: 1, event: 'custom', data: { value: 42 } },
    }]);
    unsubscribe();
    engine.dispose();
});

test('onPrint sees each captured line after it is appended, including console.log', () => {
    const snapshots: string[][] = [];
    const lines: string[] = [];
    const engine = createScriptEngine({ onPrint(line) { lines.push(line); snapshots.push([...engine.runtime.logs]); } });
    engine.runtime.load(`print('first', {value: 1}); console.log('second');`);
    expect(lines).toEqual(['first {"value":1}', 'second']);
    expect(snapshots).toEqual([['first {"value":1}'], ['first {"value":1}', 'second']]);
    engine.dispose();
});

test.each([
    ['load', (engine: ScriptEngine) => engine.runtime.load(`throw new Error('failed');`)],
    ['timer', (engine: ScriptEngine) => {
        engine.runtime.load(`Timer.set(1, true, function () { throw new Error('failed'); });`);
        engine.runtime.advance(1);
    }],
] as const)('onCrash runs once after a %s failure and cleanup', (_name, trigger) => {
    const onCrash = vi.fn((error: ShellyScriptError) => {
        expect(engine.runtime.crashed).toBe(error);
        engine.runtime.flush();
    });
    const engine = createScriptEngine({ onCrash });
    expect(() => trigger(engine)).toThrow(ShellyScriptError);
    expect(onCrash).toHaveBeenCalledExactlyOnceWith(engine.runtime.crashed);
    expect(() => engine.runtime.load(`print('not running');`)).toThrow(engine.runtime.crashed);
    expect(() => engine.evaluate('42')).toThrow(engine.runtime.crashed);
    engine.runtime.advance(100);
    engine.dispose();
    engine.dispose();
    expect(onCrash).toHaveBeenCalledTimes(1);
});

test('evaluate returns completion values and shares the loaded script realm', () => {
    const engine = createScriptEngine();
    engine.runtime.load(`var count = 40; function increment() { return ++count; }`);
    expect(engine.evaluate('increment(); increment();')).toBe(42);
    expect(engine.evaluate('var evaluated = count + 1;')).toBeUndefined();
    engine.runtime.load('print(evaluated);');
    expect(engine.runtime.logs).toEqual(['43']);
    const value = engine.evaluate('({value: count, map: typeof [].map})');
    expect(value).toEqual({ value: 42, map: 'undefined' });
    engine.dispose();
});

test('throwing evaluate preserves queued work and leaves the script running', () => {
    const onCrash = vi.fn();
    const engine = createScriptEngine({ onCrash });
    engine.runtime.load(`Timer.set(5, false, function () { print('timer'); });`);
    expect(() => engine.evaluate(`Shelly.call('KVS.Set', {key: 'saved', value: 'yes'}); throw new Error('eval failed');`))
        .toThrow(ShellyScriptError);
    expect(() => engine.evaluate('var =')).toThrow(ShellyScriptError);
    engine.runtime.advance(5);
    expect(engine.runtime.logs).toEqual(['timer']);
    expect(engine.runtime.kvs.get('saved')).toBe('yes');
    expect(engine.evaluate('21 * 2')).toBe(42);
    expect(engine.runtime.crashed).toBeUndefined();
    expect(onCrash).not.toHaveBeenCalled();
    engine.dispose();
});

test('evaluate can catch synchronous event handler errors without crashing', () => {
    const engine = createScriptEngine();
    engine.runtime.load(`Shelly.addEventHandler(function () { throw new Error('caught'); });`);
    expect(engine.evaluate(`try { Shelly.emitEvent('test', null); } catch (error) { error.message; }`)).toBe('caught');
    expect(() => engine.evaluate(`Shelly.emitEvent('test', null);`)).toThrow('caught');
    expect(engine.runtime.crashed).toBeUndefined();
    engine.dispose();
});

test('dispose clears pending work and subscriptions without calling onCrash', () => {
    const { device } = sharedDevice();
    const subscribe = device.subscribe.bind(device);
    const unsubscribes: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(device, 'subscribe').mockImplementation(listener => {
        const unsubscribe = vi.fn(subscribe(listener));
        unsubscribes.push(unsubscribe);
        return unsubscribe;
    });
    const onCrash = vi.fn();
    const engine = createScriptEngine({ device, onCrash, now: 1000 });
    engine.runtime.load(`
        Timer.set(1, true, function () { print('timer'); });
        Shelly.addStatusHandler(function () { print('status'); });
        Shelly.addEventHandler(function () { print('event'); });
        Shelly.call('KVS.Set', {key: 'pending', value: 'not saved'});
        MQTT.subscribe('input', function () { print('mqtt'); });
        MQTT.setDisconnectHandler(function () { print('disconnect'); });
        HTTPServer.registerEndpoint('state', function (request, response) { print('http'); response.send(); });
        BLE.Scanner.start({duration_ms: 2}, function (event) { if (event) print('ble'); });
    `);
    engine.dispose();
    engine.dispose();
    device.setStatus('switch:0', { output: true });
    device.emitEvent('input:0', { event: 'push' });
    engine.runtime.advance(100);
    engine.runtime.flush();
    engine.runtime.mqtt.receive('input', 'data');
    engine.runtime.mqtt.setConnected(false);
    engine.runtime.ble.advertise({ addr: 'test' });
    expect(engine.runtime.http.request('state')).toEqual({ code: 404, body: 'Not found', headers: [] });
    expect(engine.runtime.now()).toBe(1000);
    expect(engine.runtime.logs).toEqual([]);
    expect(engine.runtime.calls).toHaveLength(1);
    expect(engine.runtime.kvs.get('pending')).toBeUndefined();
    expect(engine.runtime.crashed).toBeUndefined();
    expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(onCrash).not.toHaveBeenCalled();
    expect(() => engine.runtime.load('42')).toThrow('disposed');
    expect(() => engine.evaluate('42')).toThrow('disposed');
});

test('shared device toggle_after uses its injected scheduler and survives engine disposal', () => {
    const { device, clock, schedule, cancel } = sharedDevice();
    const engine = createScriptEngine({ device });
    const statuses: DeviceStatusEvent[] = [];
    device.subscribe({ status: event => statuses.push(event) });
    engine.runtime.load(`Shelly.call('Switch.Set', {id: 0, on: true, toggle_after: 1});`);
    engine.runtime.flush();
    expect(schedule).toHaveBeenCalledWith(1000, expect.any(Function));
    engine.runtime.advance(5000);
    expect(device.getStatus('switch:0')?.output).toBe(true);
    clock.advance(999, () => {});
    expect(device.getStatus('switch:0')?.output).toBe(true);
    engine.dispose();
    clock.advance(1, () => {});
    expect(device.getStatus('switch:0')).toMatchObject({ output: false, source: 'timer' });
    expect(statuses).toHaveLength(2);
    device.call('Switch.Set', { id: 0, on: true, toggle_after: 2 });
    device.call('Switch.Toggle', { id: 0, toggle_after: 1 });
    expect(cancel).toHaveBeenCalledWith(schedule.mock.results[1].value);
    device.call('Switch.Set', { id: 0, on: true });
    expect(cancel).toHaveBeenCalledWith(schedule.mock.results[2].value);
    clock.advance(5000, () => {});
    expect(device.getStatus('switch:0')?.output).toBe(true);
});

test('DeviceState exposes copied state, system time and isolated notification snapshots', () => {
    const { device, clock } = sharedDevice();
    expect(device.componentKeys()).toEqual(['switch:0']);
    expect(device.getStatus('missing')).toBeNull();
    expect(device.getConfig('missing')).toBeNull();
    device.getConfig('switch:0')!.name = 'changed';
    device.getStatus('switch:0')!.output = true;
    expect(device.getConfig('switch:0')).toEqual({ name: 'Lamp' });
    expect(device.getStatus('switch:0')).toEqual({ output: false });
    const statuses: DeviceStatusEvent[] = [];
    const unsubscribe = device.subscribe({ status: event => { event.delta.output = 'mutated'; } });
    device.subscribe({ status: event => statuses.push(event) });
    device.setStatus('switch:0', { output: true });
    unsubscribe();
    unsubscribe();
    expect(statuses[0].delta).toEqual({ output: true });
    expect(device.getStatus('switch:0')).toEqual({ output: true });
    clock.advance(2500, () => {});
    expect(device.call('Sys.GetStatus', {})).toMatchObject({ uptime: 2, unixtime: 3, kvs_rev: 1 });
    expect(device.getStatus('sys')).toEqual(device.call('Sys.GetStatus', {}));
    expect(device.call('Shelly.GetDeviceInfo', {})).toMatchObject({ id: 'shelly-simulator', gen: 2 });
    expect(() => device.call('unknown', {})).toThrow(new RpcError(-114, 'method not simulated: unknown'));
});

test('RPC overrides still take precedence over a shared device', () => {
    const { device } = sharedDevice();
    const engine = createScriptEngine({ device, rpc: { 'Switch.Toggle': () => ({ overridden: true }) } });
    engine.runtime.load(`Shelly.call('Switch.Toggle', {id: 0}, function (result) { print(result.overridden); });`);
    engine.runtime.flush();
    expect(engine.runtime.logs).toEqual(['true']);
    expect(device.getStatus('switch:0')?.output).toBe(false);
    engine.dispose();
});
