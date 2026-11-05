import { expect, test } from 'vitest';
import { createShellyRuntime } from '../../src/testing/index.js';

test('BLE accepts the capitalized scanner and GAP names used by earlier firmware', () => {
    const runtime = createShellyRuntime();
    runtime.load(`
        BLE.Scanner.Subscribe(function (event, result) { if (event === BLE.Scanner.SCAN_RESULT) print('subscribed', result.addr); });
        print('started', JSON.stringify(BLE.Scanner.Start({ duration_ms: BLE.Scanner.INFINITE_SCAN, active: false })));
        print('running', BLE.Scanner.isRunning(), JSON.stringify(BLE.Scanner.GetScanOptions()));
        print('both', typeof BLE.Scanner.start, typeof BLE.Scanner.Stop, typeof BLE.GAP.ParseManufacturerData);
    `);
    runtime.ble.advertise({ addr: 'aa:bb', rssi: -60 });
    runtime.load(`print('stopped', BLE.Scanner.Stop(), BLE.Scanner.isRunning());`);
    expect(runtime.crashed).toBeUndefined();
    expect(runtime.logs).toEqual([
        'started {"duration_ms":-1,"active":false}',
        'running true {"duration_ms":-1,"active":false}',
        'both function function function',
        'subscribed aa:bb',
        'stopped true false',
    ]);
});

test('JSON.parse accepts hex number literals like the device, and nothing else extra', () => {
    const runtime = createShellyRuntime();
    runtime.load(`
        print(JSON.parse('0x' + '0ba9'), JSON.parse('-0xff'), JSON.stringify(JSON.parse('{"id":0x10,"s":"0x10"}')));
        print(JSON.parse('[1,2]').length, JSON.parse('"text"'));
        try { JSON.parse('{bad'); } catch (error) { print('rejected', error.name); }
        try { JSON.parse('0xZZ'); } catch (error) { print('rejected', error.name); }
    `);
    expect(runtime.crashed).toBeUndefined();
    expect(runtime.logs).toEqual(['2985 -255 {"id":16,"s":"0x10"}', '2 text', 'rejected SyntaxError', 'rejected SyntaxError']);
});

test('RPC method names match case-insensitively, including overrides', () => {
    const runtime = createShellyRuntime({
        components: { 'switch:0': { status: { output: false } } },
        rpc: { 'HTTP.POST': params => ({ code: 200, body: JSON.stringify(params.body) }) },
    });
    runtime.load(`
        Shelly.call('switch.set', { id: 0, on: true }, function (result, code) { print('set', JSON.stringify(result), code); });
        Shelly.call('SWITCH.GETSTATUS', { id: 0 }, function (result) { print('status', result.output); });
        Shelly.call('kvs.set', { key: 'k', value: 'v' }, function (result, code) { print('kvs', code); });
        Shelly.call('http.post', { url: 'http://remote/rpc/switch.set', body: { id: 0 } }, function (result) { print('http', result.body); });
        Shelly.call('Nope.Method', {}, function (result, code, message) { print('unknown', code, message); });
    `);
    runtime.flush();
    expect(runtime.logs).toEqual([
        'set {"was_on":false} 0', 'status true', 'kvs 0', 'http {"id":0}', 'unknown -114 method not simulated: Nope.Method',
    ]);
});

test('component GetStatus and GetConfig work for any configured component', () => {
    const runtime = createShellyRuntime({
        components: {
            'temperature:101': { status: { tC: 41.5, tF: 106.7 }, config: { name: 'Tank' } },
            'wifi': { status: { sta_ip: '192.168.1.5' } },
        },
    });
    runtime.load(`
        function show(label) { return function (result, code, message) { print(label, JSON.stringify(result), code, message); }; }
        Shelly.call('Temperature.GetStatus', { id: 101 }, show('status'));
        Shelly.call('temperature.getconfig', { id: 101 }, show('config'));
        Shelly.call('Wifi.GetStatus', {}, show('wifi'));
    `);
    runtime.flush();
    runtime.load(`
        Shelly.call('Temperature.GetStatus', { id: 102 }, show('missing'));
        Shelly.call('Temperature.GetStatus', { id: '101' }, show('string id'));
        Shelly.call('Humidity.GetStatus', { id: 0 }, show('absent type'));
    `);
    runtime.flush();
    expect(runtime.logs).toEqual([
        'status {"id":101,"tC":41.5,"tF":106.7} 0 ',
        'config {"id":101,"name":"Tank"} 0 ',
        'wifi {"sta_ip":"192.168.1.5"} 0 ',
        'missing null -105 Bad id=102',
        'string id null -103 id must be a non-negative integer',
        'absent type null -114 method not simulated: Humidity.GetStatus',
    ]);
});
