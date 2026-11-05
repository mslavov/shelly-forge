import { expect, test } from 'vitest';
import { RESOURCE_LIMITS } from '../../src/core/runtime-profile.js';
import { createShellyRuntime, ShellyScriptError } from '../../src/testing/index.js';

test('MQTT routes exact, single-level and multi-level wildcards', () => {
    const runtime = createShellyRuntime();
    runtime.load(`
        MQTT.subscribe('home/+/state', function (topic, message, userdata) { print('plus', topic, message, userdata); }, 'user');
        MQTT.subscribe('home/#', function (topic) { print('hash', topic); });
        MQTT.subscribe('home/kitchen/state', function (topic) { print('exact', topic); });
        MQTT.subscribe('#', function (topic) { print('all', topic); });
        MQTT.subscribe('$SYS/#', function (topic) { print('system', topic); });
    `);
    runtime.mqtt.receive('home/kitchen/state', 'on');
    runtime.mqtt.receive('home', 'root');
    runtime.mqtt.receive('home/room/nested/state', 'deep');
    runtime.mqtt.receive('$SYS/uptime', '1');
    runtime.mqtt.receive('home//state', 'empty');
    expect(runtime.logs).toEqual([
        'plus home/kitchen/state on user', 'hash home/kitchen/state', 'exact home/kitchen/state', 'all home/kitchen/state',
        'hash home', 'all home', 'hash home/room/nested/state', 'all home/room/nested/state',
        'system $SYS/uptime', 'plus home//state empty user', 'hash home//state', 'all home//state',
    ]);
});

test('MQTT limits subscriptions, releases them and validates topic filters', () => {
    const runtime = createShellyRuntime();
    runtime.load(`for (var i = 0; i < ${RESOURCE_LIMITS.mqttSubscriptions}; i++) MQTT.subscribe('topic/' + i, function () {});`);
    runtime.load(`try { MQTT.subscribe('overflow', function () {}); } catch (error) { print(error.message); }`);
    runtime.load(`print(MQTT.unsubscribe('topic/0'), MQTT.unsubscribe('topic/0')); MQTT.subscribe('replacement', function () {});`);
    expect(runtime.logs).toEqual(['mqttSubscriptions limit exceeded (10)', 'true false']);
    for (const filter of ['room/#/state', 'room/part+', 'room/#bad']) {
        expect(() => createShellyRuntime().load(`MQTT.subscribe(${JSON.stringify(filter)}, function () {});`)).toThrow('wildcard');
    }
});

test('MQTT connection transitions and publish metadata are deterministic', () => {
    const runtime = createShellyRuntime({ mqttConnected: false });
    runtime.load(`
        MQTT.setConnectHandler(function (user) { print('connected', user); }, 'up');
        MQTT.setDisconnectHandler(function (user) { print('disconnected', user); }, 'down');
        MQTT.subscribe('input', function (topic, message) { print(message); });
        print(MQTT.isConnected(), MQTT.publish('output', 'dropped'));
    `);
    runtime.mqtt.receive('input', 'not-connected');
    runtime.mqtt.setConnected(true);
    runtime.mqtt.setConnected(true);
    runtime.mqtt.receive('input', 'delivered');
    runtime.load(`print(MQTT.isConnected(), MQTT.publish('output', 'value', 2, true)); print(MQTT.publish('output', 'default'));`);
    runtime.mqtt.setConnected(false);
    runtime.mqtt.setConnected(false);
    expect(runtime.logs).toEqual(['false false', 'connected up', 'delivered', 'true true', 'true', 'disconnected down']);
    expect(runtime.mqtt.published).toEqual([
        { topic: 'output', message: 'value', qos: 2, retain: true },
        { topic: 'output', message: 'default', qos: 0, retain: false },
    ]);
});

test('MQTT callback errors retain the script error and clear connection handlers', () => {
    const runtime = createShellyRuntime();
    runtime.load(`MQTT.subscribe('input', function () { throw new Error('receive'); });
        MQTT.setDisconnectHandler(function () { throw new Error('disconnect'); });`);
    expect(() => runtime.mqtt.receive('input', 'message')).toThrow(ShellyScriptError);
    expect(() => runtime.mqtt.setConnected(false)).not.toThrow();
    expect(runtime.crashed?.original).toMatchObject({ message: 'receive' });
});

test('HTTP endpoints receive request fields and capture a sent response', () => {
    const runtime = createShellyRuntime();
    runtime.load(`
        print(HTTPServer.registerEndpoint('state', function (request, response, userdata) {
            print(request.method, request.query, request.body, request.headers[0], userdata);
            response.code = 201; response.body = 'created'; response.headers = [['Content-Type', 'text/plain']];
            print(response.send(), response.send()); response.body = 'not-sent';
        }, 'http-user'));
    `);
    expect(runtime.http.request('/script/1/state', { method: 'POST', query: 'x=1', body: 'data', headers: [['X-Test', 'yes']] })).toEqual({
        code: 201, body: 'created', headers: [['Content-Type', 'text/plain']],
    });
    expect(runtime.http.request('missing')).toEqual({ code: 404, body: 'Not found', headers: [] });
    expect(runtime.logs).toEqual(['/script/1/state', 'POST x=1 data ["X-Test","yes"] http-user', 'true false']);
});

test('HTTP defaults use sandbox arrays without requiring their iterator or map methods', () => {
    const runtime = createShellyRuntime();
    runtime.load(`
        HTTPServer.registerEndpoint('empty', function (request, response) {
            print(request.method, request.headers.length, typeof request.headers.map);
            response.headers = [['X-Test', 'safe']]; response.send();
        });
    `);
    expect(runtime.http.request('empty')).toEqual({ code: 200, body: '', headers: [['X-Test', 'safe']] });
    expect(runtime.logs).toEqual(['GET 0 undefined']);
});

test('HTTP endpoint limits, duplicates and callback failures are reported', () => {
    const runtime = createShellyRuntime();
    runtime.load(`for (var i = 0; i < ${RESOURCE_LIMITS.httpEndpoints}; i++) HTTPServer.registerEndpoint('endpoint' + i, function () {});`);
    runtime.load(`try { HTTPServer.registerEndpoint('overflow', function () {}); } catch (error) { print(error.message); }
        try { HTTPServer.registerEndpoint('endpoint0', function () {}); } catch (error) { print(error.message); }`);
    expect(runtime.logs).toEqual(['httpEndpoints limit exceeded (5)', 'HTTP endpoint already registered: endpoint0']);
    expect(runtime.http.request('endpoint0')).toEqual({ code: 504, body: 'Response not sent', headers: [] });
    const broken = createShellyRuntime();
    broken.load(`HTTPServer.registerEndpoint('broken', function () { throw new Error('endpoint error'); });`);
    expect(() => broken.http.request('broken')).toThrow(ShellyScriptError);
});

test('BLE lowercase API delivers start, result and stop events with userdata', () => {
    const runtime = createShellyRuntime();
    runtime.ble.advertise({ addr: 'ignored' });
    runtime.load(`
        print(BLE.Scanner.SCAN_START, BLE.Scanner.SCAN_STOP, BLE.Scanner.SCAN_RESULT, BLE.Scanner.INFINITE_SCAN);
        print(BLE.Scanner.isRunning(), BLE.Scanner.getScanOptions());
        print(BLE.Scanner.subscribe(function (event, result, userdata) { print(event, result && result.addr, userdata); }, 'subscriber'));
        var options = BLE.Scanner.start({duration_ms: 10, active: true}, function (event, result, userdata) { print('callback', event, userdata); }, 'start-user');
        print(options.duration_ms, BLE.Scanner.isRunning(), BLE.Scanner.getScanOptions().active);
        print(BLE.Scanner.start({duration_ms: -1}));
    `);
    runtime.ble.advertise({ addr: 'AA:BB', service_uuids: ['1809'] });
    runtime.advance(10);
    runtime.ble.advertise({ addr: 'ignored-after-stop' });
    runtime.load(`print(BLE.Scanner.isRunning(), BLE.Scanner.getScanOptions(), BLE.Scanner.stop());`);
    expect(runtime.logs).toEqual([
        '0 1 2 -1', 'false null', 'undefined', '0 null subscriber', 'callback 0 start-user', '10 true true', 'null',
        '2 AA:BB subscriber', 'callback 2 start-user', '1 null subscriber', 'callback 1 start-user', 'false null false',
    ]);
});

test('BLE can unsubscribe and stop an infinite scan', () => {
    const runtime = createShellyRuntime();
    runtime.load(`BLE.Scanner.subscribe(function () { print('subscribed'); });
        BLE.Scanner.start({duration_ms: BLE.Scanner.INFINITE_SCAN});
        BLE.Scanner.subscribe(null);`);
    runtime.advance(1_000_000);
    runtime.ble.advertise({ addr: 'ignored' });
    runtime.load(`print(BLE.Scanner.isRunning(), BLE.Scanner.stop(), BLE.Scanner.stop());`);
    expect(runtime.logs).toEqual(['subscribed', 'true true false']);
});

test.each(['hasService', 'parseServiceData', 'parseName', 'parseManufacturerData'])('BLE.GAP.%s explicitly fails as not simulated', method => {
    expect(() => createShellyRuntime().load(`BLE.GAP.${method}('data', 'uuid');`)).toThrow('not simulated');
});

test('BLE script callback errors propagate from advertisements and the clock', () => {
    const runtime = createShellyRuntime();
    runtime.load(`BLE.Scanner.start({duration_ms: 5}, function (event) { if (event !== BLE.Scanner.SCAN_START) throw new Error('scan event'); });`);
    expect(() => runtime.ble.advertise({ addr: 'test' })).toThrow(ShellyScriptError);
    expect(() => runtime.advance(5)).not.toThrow();
    expect(runtime.crashed?.original).toMatchObject({ message: 'scan event' });
    const timed = createShellyRuntime();
    timed.load(`BLE.Scanner.start({duration_ms: 5}, function (event) { if (event === BLE.Scanner.SCAN_STOP) throw new Error('scan stopped'); });`);
    expect(() => timed.advance(5)).toThrow('scan stopped');
    expect(timed.crashed).toBeInstanceOf(ShellyScriptError);
});
