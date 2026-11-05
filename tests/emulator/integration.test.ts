import { expect, test, vi } from 'vitest';
import { startEmulator, type EmulatorOptions } from '../../src/emulator/index.js';
import { RpcError } from '../../src/testing/errors.js';
import { fixture } from './helpers.js';

test('routes mixed-case methods and generic component methods over POST, GET and script calls', async () => {
    const lines: string[] = [];
    const { emulator, rpc, scripts } = await fixture({
        components: {
            'temperature:101': { status: { tC: 21.5 }, config: { name: 'boiler' } },
            'temperature:102': { status: { tC: 22 } },
            humidity: { status: { rh: 50 } },
        },
        onLog: line => lines.push(line.data),
    });
    expect(await rpc.call('sHeLlY.gEtDeViCeInFo')).toMatchObject({ id: 'shelly-emulator' });
    expect(await rpc.call('sYs.SeTcOnFiG', { config: { debug: { websocket: { enable: true } } } })).toEqual({ restart_required: false });
    expect(await rpc.call('sys.getconfig')).toHaveProperty('debug.websocket.enable', true);
    expect(await rpc.call('temperature.getstatus', { id: 101 })).toEqual({ id: 101, tC: 21.5 });
    expect(await rpc.call('Temperature.GetConfig', { id: 101 })).toEqual({ id: 101, name: 'boiler' });
    expect(await rpc.call('humidity.getstatus')).toEqual({ rh: 50 });
    expect(await rpc.call('switch.getconfig', { id: 0 })).toMatchObject({ id: 0, initial_state: 'off' });
    await expect(rpc.call('Temperature.GetStatus', { id: 999 })).rejects.toMatchObject({ details: { code: -105 } });
    await expect(rpc.call('Temperature.GetStatus', { id: '101' })).rejects.toMatchObject({ details: { code: -103 } });

    const get = async (method: string, query = '') => {
        const response = await fetch(`http://${emulator.host}/rpc/${method}${query}`);
        expect(response.status).toBe(200);
        return response.json();
    };
    expect(await get('TeMpErAtUrE.GeTsTaTuS', '?id=101')).toEqual({ id: 101, tC: 21.5 });
    expect(await get('sYs.GeTcOnFiG')).toHaveProperty('debug.websocket.enable', true);
    expect(await get('ScRiPt.LiSt')).toEqual({ scripts: [] });
    expect(await get('switch.set', '?id=0&on=true')).toEqual({ was_on: false });
    expect(await get('sHeLlY.GeTsTaTuS')).toHaveProperty('temperature:101.tC', 21.5);
    const listed = await rpc.call<{ methods: string[] }>('shelly.listmethods');
    expect(listed.methods).toEqual(expect.arrayContaining(['Temperature.GetStatus', 'Temperature.GetConfig', 'Humidity.GetStatus', 'Humidity.GetConfig', 'Switch.GetConfig']));
    expect(new Set(listed.methods).size).toBe(listed.methods.length);
    const id = await scripts.create('casing');
    await scripts.putCode(id, `
        Shelly.call("switch.set", {id:0, on:false}, function (result, code) { print("switch", code, result.was_on); });
        Shelly.call("Temperature.GetStatus", {id:101}, function (result, code) { print("temperature", code, result.tC); });
        Shelly.call("sys.getconfig", {}, function (result) { print("debug", result.debug.websocket.enable); });
        Shelly.call("script.getstatus", {id:Script.id}, function (result) { print("running", result.running); });
        Shelly.call("sHeLlY.GeTDeViCeInFo", {}, function (result) { print("device", result.id); });
    `);
    await rpc.call('sCrIpT.sTaRt', { id });
    await vi.waitFor(() => expect(lines).toHaveLength(5));
    expect(lines).toEqual(expect.arrayContaining(['switch 0 true', 'temperature 0 21.5', 'debug true', 'running true', 'device shelly-emulator']));
    expect(await rpc.call('Switch.GetStatus', { id: 0 })).toMatchObject({ output: false });
    emulator.setStatus('temperature:101', { tC: 19 });
    expect(await get('Temperature.GetStatus', '?id=101')).toEqual({ id: 101, tC: 19 });
    emulator.setStatus('voltmeter:100', { voltage: 12 });
    expect((await rpc.call<{ methods: string[] }>('Shelly.ListMethods')).methods).toContain('Voltmeter.GetStatus');
});

test('preserves the requested method in 404 errors over both transports and script calls', async () => {
    const lines: string[] = [];
    const { emulator, rpc, scripts } = await fixture({ onLog: line => lines.push(line.data) });
    const method = 'tEmPeRaTuRe.GetStatus';
    await expect(rpc.call(method, { id: 101 })).rejects.toMatchObject({ details: { code: 404, message: `No handler for ${method}` } });
    const response = await fetch(`http://${emulator.host}/rpc/${method}?id=101`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 404, message: `No handler for ${method}` });
    const id = await scripts.create('missing');
    await scripts.putCode(id, `Shelly.call("${method}", {id:101}, function (result, code, message) { print(code, message); });`);
    await scripts.start(id);
    await vi.waitFor(() => expect(lines).toEqual([`404 No handler for ${method}`]));
});

test('uses case-insensitive script RPC overrides without exposing them to HTTP clients', async () => {
    const lines: string[] = [];
    const post = vi.fn((params, runtime) => {
        expect(runtime.now()).toBeGreaterThan(0);
        return { code: 200, body: params.body };
    });
    const { emulator, rpc, scripts } = await fixture({
        rpc: {
            'http.post': post,
            'switch.set': () => ({ was_on: 'overridden' }),
            'Custom.Fail': () => { throw new RpcError(-123, 'injected failure'); },
        },
        onLog: line => lines.push(line.data),
    });
    const id = await scripts.create('overrides');
    await scripts.putCode(id, `
        Shelly.call("HTTP.POST", {url:"http://other-shelly.invalid/rpc", body:"payload"}, function (result, code) { print("post", code, result.code, result.body); });
        Shelly.call("SWITCH.SET", {id:0,on:true}, function (result) { print("switch", result.was_on); });
        Shelly.call("custom.fail", {}, function (result, code, message) { print("failure", code, message); });
    `);
    await scripts.start(id);
    await vi.waitFor(() => expect(lines).toHaveLength(3));
    expect(lines).toEqual(['post 0 200 payload', 'switch overridden', 'failure -123 injected failure']);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toEqual({ url: 'http://other-shelly.invalid/rpc', body: 'payload' });
    expect(await rpc.call('Switch.GetStatus', { id: 0 })).toMatchObject({ output: false });
    expect(await rpc.call('switch.set', { id: 0, on: true })).toEqual({ was_on: false });
    await expect(rpc.call('HTTP.POST', {})).rejects.toMatchObject({ details: { code: 404 } });
    expect((await fetch(`http://${emulator.host}/rpc/http.post`)).status).toBe(404);
    expect(post).toHaveBeenCalledTimes(1);
});

test('advertises to running scanners with capitalized aliases and isolates a scanner crash', async () => {
    const { emulator, scripts } = await fixture();
    const ids: number[] = [];
    for (const name of ['crashes', 'first', 'second', 'not-scanning', 'stopped']) {
        const id = await scripts.create(name);
        ids.push(id);
        await scripts.putCode(id, `
            var seen = [];
            BLE.Scanner.Subscribe(function (event, result) {
                if (event !== BLE.Scanner.SCAN_RESULT) return;
                ${name === 'crashes' ? 'throw new Error("scanner failed");' : 'seen.push(result.service_data["fcd2"]); result.service_data["fcd2"] = "changed";'}
            });
            ${name === 'not-scanning' ? '' : 'BLE.Scanner.Start({duration_ms:BLE.Scanner.INFINITE_SCAN});'}
        `);
        await scripts.start(id);
    }
    await scripts.stop(ids[4]);
    const advertisement = { addr: 'aa:bb:cc:dd:ee:ff', service_data: { fcd2: 'door-open' } };
    expect(() => emulator.ble.advertise(advertisement)).not.toThrow();
    expect(await scripts.getStatus(ids[0])).toMatchObject({ running: false, error_msg: expect.stringContaining('scanner failed') });
    for (const id of ids.slice(1, 3)) {
        expect(await scripts.eval(id, 'JSON.stringify(seen)')).toEqual({ result: '["door-open"]' });
        expect(await scripts.getStatus(id)).toMatchObject({ running: true });
    }
    expect(await scripts.eval(ids[3], 'seen.length')).toEqual({ result: '0' });
    expect(advertisement.service_data.fcd2).toBe('door-open');
    await scripts.eval(ids[1], 'BLE.Scanner.Stop();');
    emulator.ble.advertise(advertisement);
    expect(await scripts.eval(ids[1], 'seen.length')).toEqual({ result: '1' });
    expect(await scripts.eval(ids[2], 'seen.length')).toEqual({ result: '2' });
});

test('delivers MQTT subscriptions, tracks connection state and records publications per script', async () => {
    const { emulator, scripts } = await fixture();
    const ids: number[] = [];
    for (const name of ['first', 'second']) {
        const id = await scripts.create(name);
        ids.push(id);
        await scripts.putCode(id, `
            var connections = [];
            MQTT.setConnectHandler(function () { connections.push("up"); });
            MQTT.setDisconnectHandler(function () { connections.push("down"); });
            MQTT.subscribe("control/+", function (topic, message) { MQTT.publish("state/" + Script.id, topic + ":" + message, 1, true); });
        `);
        await scripts.start(id);
    }
    emulator.mqtt.receive('other/boiler', 'ignored');
    expect(emulator.mqtt.published).toEqual([]);
    emulator.mqtt.receive('control/boiler', 'on');
    expect(emulator.mqtt.published).toEqual(ids.map(scriptId => ({ scriptId, topic: `state/${scriptId}`, message: 'control/boiler:on', qos: 1, retain: true })));
    emulator.mqtt.setConnected(false);
    emulator.mqtt.setConnected(false);
    emulator.mqtt.receive('control/boiler', 'off');
    expect(emulator.mqtt.published).toHaveLength(2);
    for (const id of ids) expect(await scripts.eval(id, 'MQTT.isConnected()')).toEqual({ result: 'false' });
    const later = await scripts.create('later');
    await scripts.start(later);
    expect(await scripts.eval(later, 'MQTT.isConnected()')).toEqual({ result: 'false' });
    emulator.mqtt.setConnected(true);
    emulator.mqtt.receive('control/boiler', 'off');
    expect(emulator.mqtt.published).toHaveLength(4);
    for (const id of ids) expect(await scripts.eval(id, 'JSON.stringify(connections)')).toEqual({ result: '["down","up"]' });
    await scripts.stop(ids[0]);
    emulator.mqtt.receive('control/boiler', 'on');
    expect(emulator.mqtt.published).toHaveLength(5);
    expect(emulator.mqtt.published[4].scriptId).toBe(ids[1]);
});

test('isolates MQTT receive and connection handler crashes', async () => {
    const { emulator, scripts } = await fixture();
    const broken = await scripts.create('broken');
    const connected = await scripts.create('connection-crash');
    const healthy = await scripts.create('healthy');
    await scripts.putCode(broken, 'MQTT.subscribe("cmd/#", function () { throw new Error("receive failed"); });');
    await scripts.putCode(connected, 'MQTT.setDisconnectHandler(function () { throw new Error("disconnect failed"); });');
    await scripts.putCode(healthy, 'var count = 0; MQTT.subscribe("cmd/#", function () { count++; }); MQTT.setDisconnectHandler(function () { count++; });');
    for (const id of [broken, connected, healthy]) await scripts.start(id);
    expect(() => emulator.mqtt.receive('cmd/boiler', 'on')).not.toThrow();
    expect(await scripts.getStatus(broken)).toMatchObject({ running: false, error_msg: expect.stringContaining('receive failed') });
    expect(() => emulator.mqtt.setConnected(false)).not.toThrow();
    expect(await scripts.getStatus(connected)).toMatchObject({ running: false, error_msg: expect.stringContaining('disconnect failed') });
    expect(await scripts.eval(healthy, 'count')).toEqual({ result: '2' });
});

test('keeps the last 1000 MQTT publications across starts, async callbacks, crashes and deletion', async () => {
    const { emulator, rpc, scripts } = await fixture();
    const first = await scripts.create('first');
    const second = await scripts.create('second');
    await scripts.putCode(first, 'for (var i = 0; i < 1005; i++) MQTT.publish("sequence", String(i));');
    await scripts.start(first);
    expect(emulator.mqtt.published).toHaveLength(1000);
    expect(emulator.mqtt.published[0]).toEqual({ scriptId: first, topic: 'sequence', message: '5', qos: 0, retain: false });
    await scripts.putCode(second, 'Shelly.call("Sys.GetStatus", {}, function () { MQTT.publish("sequence", "async"); throw new Error("after publish"); });');
    await scripts.start(second);
    await vi.waitFor(() => expect(emulator.mqtt.published.at(-1)).toMatchObject({ scriptId: second, message: 'async' }));
    await rpc.call('Script.Delete', { id: second });
    await scripts.eval(first, 'MQTT.publish("sequence", "eval");');
    await scripts.stop(first);
    await scripts.start(first);
    expect(emulator.mqtt.published).toHaveLength(1000);
    expect(emulator.mqtt.published.at(-1)).toMatchObject({ scriptId: first, message: '1004' });
    await emulator.close();
    const saved = emulator.mqtt.published;
    emulator.mqtt.receive('sequence', 'ignored');
    emulator.ble.advertise({});
    expect(emulator.mqtt.published).toEqual(saved);
});

test('captures MQTT publications made by status handlers before stopping their engine', async () => {
    const { emulator, scripts } = await fixture();
    const id = await scripts.create('status');
    await scripts.putCode(id, 'Shelly.addStatusHandler(function () { MQTT.publish("status", "changed"); });');
    await scripts.start(id);
    emulator.setStatus('switch:0', { output: true });
    await scripts.stop(id);
    expect(emulator.mqtt.published).toEqual([{ scriptId: id, topic: 'status', message: 'changed', qos: 0, retain: false }]);
});

test.each(['status', 'event'] as const)('retains publication order after a crashing %s handler and newer MQTT messages', async notification => {
    const { emulator, scripts } = await fixture();
    const old = await scripts.create('old');
    const newer = await scripts.create('newer');
    await scripts.putCode(old, `Shelly.${notification === 'status' ? 'addStatusHandler' : 'addEventHandler'}(function () {
        MQTT.publish("sequence", "old"); throw new Error("after publish");
    });`);
    await scripts.putCode(newer, 'MQTT.subscribe("cmd", function () { for (var i = 0; i < 1000; i++) MQTT.publish("sequence", String(i)); });');
    await scripts.start(old);
    await scripts.start(newer);
    if (notification === 'status') emulator.setStatus('switch:0', { output: true });
    else emulator.emitEvent('input:0', { event: 'single_push' });
    emulator.mqtt.receive('cmd', 'publish');
    expect(emulator.mqtt.published).toHaveLength(1000);
    expect(emulator.mqtt.published[0]).toMatchObject({ scriptId: newer, message: '0' });
    expect(emulator.mqtt.published.at(-1)).toMatchObject({ scriptId: newer, message: '999' });
    expect(await scripts.getStatus(old)).toMatchObject({ running: false });
});

test('collects device publications in listener order after scripts restart in a different order', async () => {
    const { emulator, scripts } = await fixture();
    const first = await scripts.create('first');
    const second = await scripts.create('second');
    for (const id of [second, first]) {
        await scripts.putCode(id, 'Shelly.addStatusHandler(function () { MQTT.publish("sequence", String(Script.id)); });');
        await scripts.start(id);
    }
    emulator.setStatus('switch:0', { output: true });
    expect(emulator.mqtt.published.map(message => message.scriptId)).toEqual([second, first]);
    await scripts.stop(second);
    await scripts.start(second);
    emulator.setStatus('switch:0', { output: false });
    expect(emulator.mqtt.published.map(message => message.scriptId)).toEqual([second, first, first, second]);
});

test.each([
    { components: null }, { components: [] }, { components: { 'bad key': {} } },
    { components: { 'temperature:-1': {} } }, { components: { 'temperature:01': {} } },
    { components: { 'temperature:101': null } }, { components: { 'temperature:101': { status: [] } } },
    { components: { 'temperature:101': { config: false } } }, { components: { 'temperature:101': { value: 12 } } },
    { rpc: { 'HTTP.POST': true } },
])('rejects invalid emulator options %j before listening', async options => {
    await expect(startEmulator(options as unknown as EmulatorOptions)).rejects.toMatchObject({ code: 'USAGE', exitCode: 2 });
});

test('rejects invalid external BLE and MQTT inputs without crashing scripts', async () => {
    const { emulator, scripts } = await fixture();
    const id = await scripts.create('healthy');
    await scripts.start(id);
    expect(() => emulator.ble.advertise(null as unknown as Record<string, unknown>)).toThrow();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => emulator.ble.advertise(circular)).toThrow();
    for (const topic of ['', 'cmd/+', 'cmd/#', 'cmd\0bad']) expect(() => emulator.mqtt.receive(topic, '')).toThrow();
    expect(() => emulator.mqtt.setConnected('false' as unknown as boolean)).toThrow();
    expect(await scripts.getStatus(id)).toMatchObject({ running: true });
});
