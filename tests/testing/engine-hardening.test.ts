import { expect, test, vi } from 'vitest';
import { createScriptEngine, type ScriptEngine } from '../../src/testing/engine.js';

test('bounds load and evaluation separately without changing evaluation crash semantics', () => {
    const onCrash = vi.fn();
    const engine = createScriptEngine({ executionTimeoutMs: 20, onCrash });
    expect(() => engine.evaluate('while (true) {}')).toThrow('Script execution timed out after 20ms');
    expect(engine.runtime.crashed).toBeUndefined();
    expect(onCrash).not.toHaveBeenCalled();
    expect(engine.evaluate('40 + 2')).toBe(42);
    expect(() => engine.runtime.load('while (true) {}')).toThrow('Script execution timed out after 20ms');
    expect(engine.runtime.crashed?.message).toBe('Shelly script error: Script execution timed out after 20ms');
    expect(onCrash).toHaveBeenCalledTimes(1);
    engine.dispose();
});

test.each<[string, string, (engine: ScriptEngine) => void]>([
    ['timer', 'Timer.set(1, false, function () { while (true) {} });', engine => engine.runtime.advance(1)],
    ['RPC', 'Shelly.call("Sys.GetStatus", {}, function () { while (true) {} });', engine => engine.runtime.flush()],
    ['status', 'Shelly.addStatusHandler(function () { while (true) {} });', engine => engine.runtime.setStatus('switch:0', { output: true })],
    ['event', 'Shelly.addEventHandler(function () { while (true) {} });', engine => engine.runtime.emitEvent('input:0', { event: 'push' })],
    ['MQTT message', 'MQTT.subscribe("test", function () { while (true) {} });', engine => engine.runtime.mqtt.receive('test', 'message')],
    ['MQTT disconnect', 'MQTT.setDisconnectHandler(function () { while (true) {} });', engine => engine.runtime.mqtt.setConnected(false)],
    ['MQTT connect', 'MQTT.setConnectHandler(function () { while (true) {} });', engine => { engine.runtime.mqtt.setConnected(false); engine.runtime.mqtt.setConnected(true); }],
    ['HTTP', 'HTTPServer.registerEndpoint("test", function () { while (true) {} });', engine => engine.runtime.http.request('test')],
    ['BLE result', 'BLE.Scanner.start({duration_ms:-1}); BLE.Scanner.subscribe(function () { while (true) {} });', engine => engine.runtime.ble.advertise({ addr: 'test' })],
    ['BLE stop', 'BLE.Scanner.start({duration_ms:1}, function (event) { if (event === 1) while (true) {} });', engine => engine.runtime.advance(1)],
])('bounds every %s callback and crashes only once', (_kind, code, trigger) => {
    const onCrash = vi.fn();
    const engine = createScriptEngine({ executionTimeoutMs: 30, onCrash });
    engine.runtime.load(code);
    try { trigger(engine); } catch {}
    expect(engine.runtime.crashed?.message).toContain('Script execution timed out after 30ms');
    expect(onCrash).toHaveBeenCalledTimes(1);
    engine.runtime.advance(100);
    expect(onCrash).toHaveBeenCalledTimes(1);
    engine.dispose();
});

test('disables log and RPC history without suppressing output or executing fewer calls', () => {
    const onPrint = vi.fn();
    const execute = vi.fn(() => ({}));
    const engine = createScriptEngine({ recordHistory: false, onPrint, callRpc: execute });
    engine.runtime.load('Timer.set(1, true, function () { print("tick"); Shelly.call("Sys.GetStatus"); });');
    engine.runtime.advance(10_000);
    expect(engine.runtime.logs).toEqual([]);
    expect(engine.runtime.calls).toEqual([]);
    expect(onPrint).toHaveBeenCalledTimes(10_000);
    expect(execute).toHaveBeenCalledTimes(10_000);
    engine.dispose();
});

test('rejects invalid internal timeout limits', () => {
    for (const executionTimeoutMs of [0, -1, 1.5, NaN, Infinity, 0x100000000]) {
        expect(() => createScriptEngine({ executionTimeoutMs })).toThrow('executionTimeoutMs must be a positive integer');
    }
});
