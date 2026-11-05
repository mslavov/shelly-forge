import { expect, test } from 'vitest';
import { RESOURCE_LIMITS, UNSUPPORTED_ARRAY_METHODS, UNSUPPORTED_GLOBALS } from '../../src/core/runtime-profile.js';
import { createShellyRuntime, ShellyScriptError } from '../../src/testing/index.js';

test('virtual Date and uptime advance without changing the host clock', () => {
    const now = Date.UTC(2026, 3, 8, 12, 0, 0);
    const runtime = createShellyRuntime({ now });
    runtime.load(`print(Date.now(), new Date().getTime(), Shelly.getUptimeMs());
        print(new Date(2000, 0, 1).getFullYear(), Date.parse('2000-01-01T00:00:00Z'), Date.UTC(2000, 0, 1));
        print(new Date() instanceof Date, typeof Date());`);
    expect(runtime.logs).toEqual([`${now} ${now} 0`, '2000 946684800000 946684800000', 'true string']);
    runtime.advance(1250);
    runtime.load('print(Date.now(), new Date().getTime(), Shelly.getUptimeMs());');
    expect(runtime.now()).toBe(now + 1250);
    expect(runtime.logs.at(-1)).toBe(`${now + 1250} ${now + 1250} 1250`);
    expect(new Date().getFullYear()).not.toBe(2000);
});

test('strict builtins are removed only in the sandbox realm', () => {
    const runtime = createShellyRuntime();
    for (const method of UNSUPPORTED_ARRAY_METHODS) {
        runtime.load(`print(typeof [1][${JSON.stringify(method)}]);`);
    }
    for (const name of UNSUPPORTED_GLOBALS) runtime.load(`print(typeof globalThis[${JSON.stringify(name)}]);`);
    expect(runtime.logs.every(line => line === 'undefined')).toBe(true);
    try {
        runtime.load('[1].map(function (x) { return x; });');
        expect.fail('map should fail');
    } catch (error) {
        expect(error).toBeInstanceOf(ShellyScriptError);
        expect((error as ShellyScriptError).original).toMatchObject({ name: 'TypeError' });
    }
    expect([1].map(value => value + 1)).toEqual([2]);
    expect(typeof Promise).toBe('function');
    const permissive = createShellyRuntime({ strictBuiltins: false });
    permissive.load('print([1].map(function (x) { return x + 1; })[0], typeof Promise);');
    expect(permissive.logs).toEqual(['2 function']);
});

test('storage, encoding, output and virtual handles match the globals', () => {
    const runtime = createShellyRuntime();
    runtime.load(`
        print(Script.id, Shelly.getCurrentScriptId(), Virtual.getHandle('switch:1'), Script.getVcHandle('role'));
        print(Script.storage.length, Script.storage.getItem('absent'));
        Script.storage.setItem('__proto__', 'safe'); Script.storage.setItem('two', '2');
        print(Script.storage.length, Script.storage.key(0), Script.storage.getItem('__proto__'));
        Script.storage.removeItem('two'); print(Script.storage.length, Script.storage.key(2));
        Script.storage.clear(); print(Script.storage.length);
        print(btoa('hello'), atob('aGVsbG8='), btoh('AZ\\x00\\xff'));
        console.log('message', 12, { ok: true }, [1, 2]);
    `);
    expect(runtime.logs).toEqual([
        '1 1 null null', '0 null', '2 __proto__ safe', '1 null', '0',
        'aGVsbG8= hello 415a00ff', 'message 12 {"ok":true} [1,2]',
    ]);
});

test('component state and events return snapshots and preserve userdata', () => {
    const runtime = createShellyRuntime({ components: { 'switch:0': { status: { output: false }, config: { name: 'Lamp' } } }, deviceInfo: { id: 'unit' } });
    runtime.load(`
        var user = {count: 0};
        var statusHandle = Shelly.addStatusHandler(function (event, data) { data.count++; print(event.component, event.name, event.id, event.delta.output, data.count); }, user);
        var eventHandle = Shelly.addEventHandler(function (event, data) { print(event.component, event.info.event, event.info.data, data); }, 'event-user');
        var snapshot = Shelly.getComponentStatus('switch', 0); snapshot.output = true;
        print(Shelly.getComponentStatus('switch:0').output, Shelly.getComponentConfig('switch', 0).name, Shelly.getDeviceInfo().id);
        print(Shelly.getComponentStatus('absent'), Shelly.getComponentConfig('absent'));
    `);
    runtime.setStatus('switch:0', { output: true });
    runtime.emitEvent('input:2', { event: 'single_push', data: 12 });
    runtime.load(`Shelly.emitEvent('custom', 'data');
        print(Shelly.removeStatusHandler(statusHandle), Shelly.removeStatusHandler(statusHandle));
        print(Shelly.removeEventHandler(eventHandle), Shelly.removeEventHandler(eventHandle));`);
    runtime.setStatus('switch:0', { output: false });
    runtime.emitEvent('input:2', { event: 'ignored' });
    expect(runtime.logs).toEqual([
        'false Lamp unit', 'null null', 'switch:0 switch 0 true 1',
        'input:2 single_push 12 event-user', 'script:1 custom data event-user', 'true false', 'true false',
    ]);
});

test.each(['setStatus', 'emitEvent'] as const)('%s rejects non-JSON host input without crashing the runtime', method => {
    const runtime = createShellyRuntime({ components: { 'switch:0': { status: { output: false } } } });
    runtime.load(`
        Shelly.addStatusHandler(function () { print('status'); });
        Shelly.addEventHandler(function () { print('event'); });
        Timer.set(1, false, function () { print('timer'); });
        Shelly.call('KVS.Set', {key: 'pending', value: 'saved'});
    `);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const input of [circular, { value: 1n }]) {
        expect(() => runtime[method]('switch:0', input)).toThrow(TypeError);
        expect(runtime.crashed).toBeUndefined();
        expect(runtime.logs).toEqual([]);
    }
    runtime.load('print(Shelly.getComponentStatus("switch:0").output);');
    runtime.setStatus('switch:0', { output: true });
    runtime.emitEvent('switch:0', { event: 'changed' });
    runtime.advance(1);
    expect(runtime.logs).toEqual(['false', 'status', 'event', 'timer']);
    expect(runtime.kvs.get('pending')).toBe('saved');
    expect(runtime.crashed).toBeUndefined();
});

test('timers run in due order and flush callbacks before and between timers', () => {
    const runtime = createShellyRuntime({ rpc: { echo: params => params } });
    runtime.load(`
        var data = { label: 'tick' };
        var repeating = Timer.set(10, true, function (user) { print(user.label, Shelly.getUptimeMs()); Shelly.call('echo', {}, function () { print('rpc', Shelly.getUptimeMs()); }); }, data);
        Timer.set(20, false, function () { print('same-deadline'); Timer.clear(repeating); });
        var cancelled = Timer.set(5, false, function () { print('never'); });
        print(Timer.clear(cancelled), Timer.clear(cancelled), Timer.getInfo(cancelled));
        var info = Timer.getInfo(repeating); print(info.interval, info.next);
        Shelly.call('echo', {}, function () { print('before-timers'); });
    `);
    runtime.advance(30);
    expect(runtime.logs).toEqual(['true false undefined', '10 10', 'before-timers', 'tick 10', 'rpc 10', 'same-deadline']);
    expect(runtime.now()).toBe(Date.UTC(2026, 0, 1) + 30);
});

test('zero-delay one-shot timers release capacity before their callback', () => {
    const runtime = createShellyRuntime();
    runtime.load(`Timer.set(0, false, function () { print('first'); Timer.set(0, false, function () { print('second'); }); });`);
    runtime.advance(0);
    expect(runtime.logs).toEqual(['first', 'second']);
});

test.each([
    ['timers', 'Timer.set(100, false, function () {})'],
    ['eventHandlers', 'Shelly.addEventHandler(function () {})'],
    ['statusHandlers', 'Shelly.addStatusHandler(function () {})'],
] as const)('%s limit is enforced', (name, register) => {
    const runtime = createShellyRuntime();
    runtime.load(`for (var i = 0; i < ${RESOURCE_LIMITS[name]}; i++) { ${register}; }`);
    expect(() => runtime.load(register)).toThrow(new RegExp(`${name}.*${RESOURCE_LIMITS[name]}`));
});

test.each([
    ['load', 'throw new Error("top");', (runtime: ReturnType<typeof createShellyRuntime>) => runtime.load('throw new Error("top");'), 'top'],
    ['timer', 'Timer.set(1, false, function () { throw new Error("timer"); });', (runtime: ReturnType<typeof createShellyRuntime>) => runtime.advance(1), 'timer'],
    ['RPC', 'Shelly.call("unknown", {}, function () { throw new Error("callback"); });', (runtime: ReturnType<typeof createShellyRuntime>) => runtime.flush(), 'callback'],
    ['event', 'Shelly.addEventHandler(function () { throw new Error("event"); });', (runtime: ReturnType<typeof createShellyRuntime>) => runtime.emitEvent('input:0', { event: 'push' }), 'event'],
    ['status', 'Shelly.addStatusHandler(function () { throw new Error("status"); });', (runtime: ReturnType<typeof createShellyRuntime>) => runtime.setStatus('switch:0', { output: true }), 'status'],
] as const)('uncaught %s errors have the original error', (kind, setup, trigger, message) => {
    const runtime = createShellyRuntime();
    if (kind !== 'load') runtime.load(setup);
    try { trigger(runtime); expect.fail('Expected a script error'); } catch (error) {
        expect(error).toBeInstanceOf(ShellyScriptError);
        expect((error as ShellyScriptError).original).toMatchObject({ message });
        expect(runtime.crashed).toBe(error);
    }
});

test('API wrappers preserve uninspectable values thrown by guest callbacks', () => {
    const runtime = createShellyRuntime({ strictBuiltins: false });
    runtime.load(`var thrownProxy = new Proxy({}, {
        getPrototypeOf: function () { throw new Error('prototype'); },
        has: function () { throw new Error('formatting'); }
    });
    Shelly.addEventHandler(function () { throw thrownProxy; });
    try { Shelly.emitEvent('test', null); } catch (error) { print(error === thrownProxy); }`);
    expect(runtime.logs).toEqual(['true']);
    expect(() => runtime.emitEvent('input:0', { event: 'test' })).toThrow(ShellyScriptError);
});

test('invalid clock input is rejected without changing time', () => {
    expect(() => createShellyRuntime({ now: NaN })).toThrow('now');
    const runtime = createShellyRuntime({ now: 0 });
    for (const invalid of [-1, Infinity, NaN]) expect(() => runtime.advance(invalid)).toThrow('advance');
    expect(runtime.now()).toBe(0);
    expect(runtime.crashed).toBeUndefined();
});

test('API objects, callbacks, getters and caught host errors use guest prototypes', () => {
    const runtime = createShellyRuntime();
    runtime.load(`
        print(Shelly.call.constructor('return typeof process')());
        print(Date.now.constructor('return typeof process')());
        print(Object.getOwnPropertyDescriptor(Script.storage, 'length').get.constructor('return typeof process')());
        print(globalThis.constructor.constructor('return typeof process')());
        Shelly.constructor.prototype.realmMarker = 'guest-only';
        print(Shelly.realmMarker, Timer.realmMarker);
        try { Timer.set(-1, false, function () {}); } catch (error) {
            print(error.constructor.constructor('return typeof process')(), error instanceof Error);
        }
        HTTPServer.registerEndpoint('realm', function (request, response) {
            print(response.send.constructor('return typeof process')()); response.send();
        });
    `);
    runtime.http.request('realm');
    expect(runtime.logs).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'guest-only guest-only', 'undefined true', 'undefined']);
    expect(Object.hasOwn(Object.prototype, 'realmMarker')).toBe(false);
    const other = createShellyRuntime();
    other.load('print(Shelly.realmMarker);');
    expect(other.logs).toEqual(['undefined']);
});

test.each([
    'Object.create(null)',
    '{ get message() { throw new Error("formatting"); } }',
    '{ toString: function () { throw new Error("formatting"); } }',
    'new Proxy({}, { getPrototypeOf: function () { throw new Error("prototype"); }, has: function () { throw new Error("formatting"); } })',
])('unprintable thrown values retain the original object: %s', expression => {
    const runtime = createShellyRuntime({ strictBuiltins: false });
    runtime.load(`var originalThrown = ${expression};`);
    let first: unknown;
    for (let index = 0; index < 2; index++) {
        try { runtime.load('throw originalThrown;'); expect.fail('Expected a script error'); } catch (error) {
            expect(error).toBeInstanceOf(ShellyScriptError);
            expect((error as ShellyScriptError).message).toContain('Unprintable thrown value');
            if (first) expect(error).toBe(first);
            expect(runtime.crashed).toBe(error);
            first = error;
        }
    }
});
