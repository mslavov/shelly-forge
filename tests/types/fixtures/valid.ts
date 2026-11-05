const values = [1, 2];
values.push(3);
values.pop();
values.shift();
values.unshift(0);
values.splice(0, 1);
values.slice(0, 1);
values.concat([4]);
values.sort(function (left, right) { return left - right; });
values.reverse();
values.indexOf(1);
values.lastIndexOf(1);
values.join(',');
Object.keys({ value: true });
Math.floor(Date.now() / 1000);
const byte: number = 'abc'.at(0);
const publicEnv: string | undefined = process.env.SHELLY_PUBLIC_X;
function behavior() {}
behavior.replaceWith(function () {});
console.log(byte, publicEnv, btoa('abc'), atob('YWJj'), btoh('abc'));
print(JSON.stringify({ value: 1 }));

Shelly.call('Switch.Set', { id: 0, on: true }, function (result, errorCode, errorMessage, context) {
  const code: number = errorCode;
  const message: string = errorMessage;
  const label: string = context.label;
  if (result) {
    const wasOn: boolean = result.was_on;
    // @ts-expect-error The typed callback result is not any.
    const invalid: string = result.was_on;
    console.log(wasOn, code, message, label, invalid);
  }
}, { label: 'switch' });
Shelly.call('Switch.Toggle', { id: 0 });
Shelly.call('Switch.GetStatus', { id: 0 }, function (result) {
  if (result) console.log(result.output, result.apower);
});
Shelly.call('KVS.Get', { key: 'counter' }, function (result) {
  if (result) console.log(result.etag, result.value);
});
Shelly.call('KVS.Set', { key: 'counter', value: { count: 1 }, etag: 'etag' });
Shelly.call('KVS.GetMany', { match: 'counter*', offset: 0 }, function (result) {
  if (result) console.log(result.items.counter.value, result.total, result.offset);
});
Shelly.call('KVS.List', null, function (result) {
  if (result) console.log(result.keys.counter.etag, result.rev);
});
Shelly.call('KVS.Delete', { key: 'counter' });
Shelly.call('HTTP.GET', { url: 'http://example.com', ssl_ca: null }, function (result) {
  if (result) console.log(result.code, result.body, result.headers);
});
Shelly.call('HTTP.POST', { url: 'http://example.com', body: '{}' });
Shelly.call('HTTP.POST', { url: 'http://example.com', body_b64: 'YWJj' });
Shelly.call('HTTP.Request', { method: 'PUT', url: 'http://example.com', body: 'value' });
Shelly.call('Temperature.GetStatus', { id: 0 }, function (result) {
  if (result) {
    const temperature: number | null = result.tC;
    // @ts-expect-error Temperature readings can be null.
    const requiredTemperature: number = result.tC;
    console.log(temperature, requiredTemperature);
  }
});
Shelly.call('Input.GetStatus', { id: 0 });
Shelly.call('Sys.GetStatus', null);
Shelly.call('Shelly.GetDeviceInfo', { ident: true });
Shelly.call('Script.GetConfig', { id: Script.id });
Shelly.call('Script.SetConfig', { id: Script.id, config: { enable: true } });
Shelly.call('Script.GetStatus', { id: Script.id }, function (result) {
  if (result) {
    const memory: number | undefined = result.mem_used;
    // @ts-expect-error Stopped scripts may omit memory usage.
    const requiredMemory: number = result.mem_used;
    console.log(memory, requiredMemory);
  }
});
const stoppedScript: ShellyScriptStatus = { id: 3, running: false };
console.log(stoppedScript);
Shelly.call('Script.List', null);
Shelly.call('Script.Create', {});
Shelly.call('Script.Delete', { id: 3 });
Shelly.call('Script.Start', { id: 3 });
Shelly.call('Script.Stop', { id: 3 });
Shelly.call('Script.PutCode', { id: 3, code: 'print(1)', append: false });
Shelly.call('Script.GetCode', { id: 3, offset: 0, len: 1024 });
Shelly.call('Script.Eval', { id: 3, code: '1 + 1' });
Shelly.call('Future.UnknownMethod', null, function (result) {
  const unknownResult: unknown = result;
  console.log(unknownResult);
});
let dynamicMethod: string = 'Future.DynamicMethod';
Shelly.call(dynamicMethod, { value: 1 });

declare global {
  interface ShellyRpcMethods {
    'Custom.Measure': { params: { channel: number }; result: { measurement: number } };
  }
}
Shelly.call('Custom.Measure', { channel: 1 }, function (result) {
  if (result) {
    const measurement: number = result.measurement;
    console.log(measurement);
  }
});
// @ts-expect-error User-added RPC methods also validate their parameters.
Shelly.call('Custom.Measure', { channel: 'one' });

const eventHandle = Shelly.addEventHandler(function (event, context) {
  const name: string = event.info.event;
  const component: string = event.component;
  console.log(name, component, context.label);
}, { label: 'event' });
const statusHandle = Shelly.addStatusHandler(function (status) {
  const output: boolean | undefined = status.delta.output;
  console.log(output, status.component);
});
const removedEvent: boolean | undefined = Shelly.removeEventHandler(eventHandle);
const removedStatus: boolean | undefined = Shelly.removeStatusHandler(statusHandle);
Shelly.emitEvent('checked', { success: true });
const status = Shelly.getComponentStatus('temperature', 0);
if (status) console.log(status.tC);
console.log(Shelly.getDeviceInfo().model, Shelly.getComponentConfig('sys'));
console.log(Shelly.getCurrentScriptId(), Shelly.getUptimeMs(), removedEvent, removedStatus);

const timer = Timer.set(1000, false, function (context) { console.log(context.count); }, { count: 1 });
const info = Timer.getInfo(timer);
if (info) console.log(info.interval, info.next);
const cleared: boolean | undefined = Timer.clear(timer);
MQTT.subscribe('device/+', function (topic, message, context) {
  console.log(topic, message, context.prefix);
}, { prefix: 'received' });
MQTT.publish('device/status', 'online', 1, true);
MQTT.unsubscribe('device/+');
MQTT.setConnectHandler(function (context) { console.log(context); }, 'connected');
MQTT.setDisconnectHandler(function () {});
console.log(MQTT.isConnected(), cleared);

BLE.Scanner.subscribe(function (event, result, context) {
  if (event === BLE.Scanner.SCAN_RESULT) {
    const address: string = result.addr;
    console.log(address, context.label, BLE.GAP.parseName(result.advData));
    console.log(BLE.GAP.parseManufacturerData(result.advData));
    console.log(BLE.GAP.hasService(result.advData, '181a'));
    console.log(BLE.GAP.parseServiceData(result.advData, '181a'));
  }
}, { label: 'scan' });
BLE.Scanner.start({ duration_ms: BLE.Scanner.INFINITE_SCAN, rssi_thr: -70, filters: [{ name: 'SBDW*' }] });
BLE.Scanner.subscribe(null);
console.log(BLE.Scanner.getScanOptions(), BLE.Scanner.isRunning(), BLE.Scanner.stop());
BLE.Scanner.Subscribe(function (event, result) {
  if (event === BLE.Scanner.SCAN_RESULT && result) console.log(result.addr, BLE.GAP.ParseManufacturerData(result.advData));
});
BLE.Scanner.Start({ duration_ms: BLE.Scanner.INFINITE_SCAN, active: false }, function (event) { console.log(event); });
console.log(BLE.Scanner.GetScanOptions(), BLE.Scanner.Stop(), BLE.GAP.HasService('', '181a'), BLE.GAP.ParseServiceData('', '181a'), BLE.GAP.ParseName(''));

HTTPServer.registerEndpoint('status', function (request, response, context) {
  console.log(request.method, request.query, request.body, request.headers, context.name);
  response.code = 200;
  response.headers = [['Content-Type', 'application/json']];
  response.body = JSON.stringify({ ok: true });
  const sent: boolean = response.send();
  console.log(sent);
}, { name: 'status' });
Script.storage.setItem('key', 'value');
const stored: string | null = Script.storage.getItem('key');
const key: string | null = Script.storage.key(0);
console.log(stored, key, Script.storage.length);
Script.storage.removeItem('key');
Script.storage.clear();
const virtual = Virtual.getHandle('boolean:200');
if (virtual) {
  virtual.setValue(true);
  console.log(virtual.getValue(), virtual.getStatus(), virtual.getConfig());
  virtual.setConfig({ name: 'Value' });
  const listener = virtual.on('change', function (event) { console.log(event.source, event.value); });
  virtual.off(listener);
}
Script.getVcHandle('value');
