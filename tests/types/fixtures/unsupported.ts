const numbers = [1, 2, 3];
const readonlyNumbers: ReadonlyArray<number> = numbers;

// @ts-expect-error Shelly arrays do not implement map.
numbers.map;
// @ts-expect-error Shelly arrays do not implement forEach.
numbers.forEach;
// @ts-expect-error Shelly arrays do not implement filter.
numbers.filter;
// @ts-expect-error Shelly arrays do not implement reduce.
numbers.reduce;
// @ts-expect-error Shelly arrays do not implement reduceRight.
numbers.reduceRight;
// @ts-expect-error Shelly arrays do not implement some.
numbers.some;
// @ts-expect-error Shelly arrays do not implement every.
numbers.every;
// @ts-expect-error Shelly arrays do not implement find.
numbers.find;
// @ts-expect-error Shelly arrays do not implement findIndex.
numbers.findIndex;
// @ts-expect-error Shelly arrays do not implement flat.
numbers.flat;
// @ts-expect-error Shelly arrays do not implement flatMap.
numbers.flatMap;
// @ts-expect-error Shelly arrays do not implement includes.
numbers.includes;
// @ts-expect-error Shelly arrays do not implement fill.
numbers.fill;
// @ts-expect-error Shelly arrays do not implement copyWithin.
numbers.copyWithin;
// @ts-expect-error Shelly arrays do not implement entries.
numbers.entries;
// @ts-expect-error Shelly arrays do not implement keys.
numbers.keys;
// @ts-expect-error Shelly arrays do not implement values.
numbers.values;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.map;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.forEach;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.filter;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.reduce;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.reduceRight;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.some;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.every;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.find;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.findIndex;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.flat;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.flatMap;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.includes;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.fill;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.copyWithin;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.entries;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.keys;
// @ts-expect-error ReadonlyArray must not restore unsupported array methods.
readonlyNumbers.values;

// @ts-expect-error Use Timer.set on the device.
setTimeout(function () {}, 1000);
// @ts-expect-error Use Timer.set on the device.
setInterval(function () {}, 1000);
// @ts-expect-error Use Timer.clear on the device.
clearTimeout(1);
// @ts-expect-error Use Timer.clear on the device.
clearInterval(1);
// @ts-expect-error The device has no immediate task queue.
setImmediate(function () {});
// @ts-expect-error The device has no microtask queue.
queueMicrotask(function () {});
// @ts-expect-error Use the HTTP RPC methods on the device.
fetch('http://example.com');
// @ts-expect-error Use the HTTP RPC methods on the device.
new XMLHttpRequest();
// @ts-expect-error Modules must be bundled before deployment.
require('module');
// @ts-expect-error The device has no Promise constructor.
new Promise(function () {});
// @ts-expect-error The device has no Symbol constructor.
Symbol('key');
// @ts-expect-error The device has no Proxy constructor.
new Proxy({}, {});
// @ts-expect-error The device has no Reflect object.
Reflect;
// @ts-expect-error The device has no WeakMap constructor.
new WeakMap();
// @ts-expect-error The device has no WeakSet constructor.
new WeakSet();
// @ts-expect-error Only the build-time environment shape is available.
process.cwd();
// @ts-expect-error A build-time environment value can be absent.
const requiredEnv: string = process.env.SHELLY_PUBLIC_MISSING;
// @ts-expect-error Shelly string byte access returns a number.
const character: string = 'abc'.at(0);
// @ts-expect-error A known RPC method must not fall through to the untyped overload.
Shelly.call('Switch.Set', { id: 0, on: 'yes' });
// @ts-expect-error Required RPC parameters cannot be omitted.
Shelly.call('Switch.Set', { id: 0 });
// @ts-expect-error Shelly.call receives an object or null, not serialized JSON.
Shelly.call('Custom.Method', '{}');
// @ts-expect-error An HTTP GET request cannot contain a body.
Shelly.call('HTTP.Request', { method: 'GET', url: 'http://example.com', body: 'data' });
// @ts-expect-error An HTTP POST request needs a body.
Shelly.call('HTTP.POST', { url: 'http://example.com' });
// @ts-expect-error Timer information is requested for one handle.
Timer.getInfo();
// @ts-expect-error parseName takes one advertising data string.
BLE.GAP.parseName('', '');
// @ts-expect-error Scanner options must be an object.
BLE.Scanner.Start('all');
// @ts-expect-error A two-argument scan callback receives null on start and stop events.
BLE.Scanner.subscribe(function (event, result) { console.log(result.addr); });
// @ts-expect-error A callback that requires user data must receive it.
Timer.set(1000, false, function (data: { value: string }) { print(data.value); });
// @ts-expect-error An explicit user-data type must not make the argument optional.
Timer.set<string>(1000, false, function (data) { print(data); });
// @ts-expect-error A typed RPC callback that requires user data must receive it.
Shelly.call('Switch.Set', { id: 0, on: true }, function (_result, _code, _message, data: string) { print(data); });
// @ts-expect-error An untyped RPC callback that requires user data must receive it.
Shelly.call('Future.Method', null, function (_result, _code, _message, data: string) { print(data); });
// @ts-expect-error An event callback that requires user data must receive it.
Shelly.addEventHandler(function (_event, data: string) { print(data); });
// @ts-expect-error A status callback that requires user data must receive it.
Shelly.addStatusHandler(function (_status, data: string) { print(data); });
// @ts-expect-error An MQTT callback that requires user data must receive it.
MQTT.subscribe('test', function (_topic, _message, data: string) { print(data); });
// @ts-expect-error A connect callback that requires user data must receive it.
MQTT.setConnectHandler(function (data: string) { print(data); });
// @ts-expect-error A disconnect callback that requires user data must receive it.
MQTT.setDisconnectHandler(function (data: string) { print(data); });
// @ts-expect-error A scan callback that requires user data must receive it.
BLE.Scanner.subscribe(function (_event, _result, data: string) { print(data); });
// @ts-expect-error A scan callback that requires user data must receive it.
BLE.Scanner.start({}, function (_event, _result, data: string) { print(data); });
// @ts-expect-error An HTTP callback that requires user data must receive it.
HTTPServer.registerEndpoint('test', function (_request, _response, data: string) { print(data); });
