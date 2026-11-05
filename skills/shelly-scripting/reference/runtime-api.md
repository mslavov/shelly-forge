# Device API reference

The installed `node_modules/shelly-forge/types/shelly.d.ts` defines names and
signatures. Check the [official component RPC docs](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/)
for model-specific methods and the [script API docs](https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Shelly/)
for device globals. These are device APIs, not the host-side CLI client.

## Component RPC

`Shelly.call` takes a method name, a parameter object or `null` as allowed by that
method, an optional callback, and optional callback userdata. Do not serialize the
parameter object. A zero error code means success. Check both the error code and
result before reading fields because the typed result may be `undefined` on error.
The callback also receives the error message and the supplied userdata.

```ts
function onSwitchStatus(
  result: ShellySwitchStatus | undefined,
  errorCode: number,
  errorMessage: string
): void {
  if (errorCode !== 0 || result === undefined) {
    print("Switch.GetStatus failed", errorCode, errorMessage);
    return;
  }
  print("Output", result.output);
}

Shelly.call("Switch.GetStatus", { id: 0 }, onSwitchStatus);
```

The declarations type common Switch, KVS, HTTP, Temperature, Input, Sys, Shelly,
and Script RPC methods. For example, `Temperature.GetStatus` can return `null` for
`tC` and `tF`; do not turn a missing temperature into zero. Unknown method strings
have a fallback with an `unknown` result. Validate that result, or extend the global
`ShellyRpcMethods` interface with the firmware method's parameter and result types.
Keep at most five calls in flight, including outgoing HTTP requests.

## Local events and status

`Shelly.addEventHandler` receives a `ShellyEvent`. `Shelly.addStatusHandler` receives
a `ShellyStatusEvent` whose `delta` contains changed fields, not a full snapshot.
Each registration returns a handle. The matching remove method returns a boolean
or `undefined` for an invalid handle. Store handles if the registration is temporary.

```ts
function onTemperature(status: ShellyStatusEvent): void {
  if (status.component !== "temperature:0") return;
  const temperature = status.delta.tC;
  if (typeof temperature !== "number") return;
  if (MQTT.isConnected()) {
    MQTT.publish("sensors/temperature/state", String(temperature));
  }
}

Shelly.addStatusHandler(onTemperature);
```

`Shelly.getComponentStatus("switch:0")` reads local cached status synchronously and
may return `null`. `Shelly.getComponentConfig` also returns `null` when unavailable.
`Shelly.emitEvent(name, data)` accepts JSON data for a custom event.

## Timers

[`Timer`](https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Timer/) uses
milliseconds. `Timer.set(period, repeat, callback, userdata?)` returns a handle.
`Timer.clear(handle)` returns a boolean or `undefined`. `Timer.getInfo(handle)`
returns `{ interval, next }` or `undefined`; it requires the handle.

```ts
function reportUptime(label: string): void {
  print(label, Shelly.getUptimeMs());
}

const heartbeat = Timer.set(60000, true, reportUptime, "uptime_ms");
const timerInfo = Timer.getInfo(heartbeat);
if (timerInfo !== undefined) print("Interval", timerInfo.interval);
```

Use one repeating timer to dispatch related work rather than allocating a timer
for every condition. Userdata must be supplied when the callback requires it.

## MQTT

[`MQTT`](https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/MQTT/) provides
`isConnected`, `subscribe`, `unsubscribe`, `publish`, `setConnectHandler`, and
`setDisconnectHandler`. Configure the device's MQTT connection separately.
Subscriptions receive topic, message, and optional userdata. `publish` returns a
boolean and accepts optional QoS `0`, `1`, or `2` and a retain flag. Check connection
and publish results when delivery matters; a successful call is not proof that a
consumer processed the message. Validate payloads before changing device state.

## KVS and per-script storage

KVS methods use ordinary `Shelly.call` callbacks:

| Method | Parameters | Result on success |
| --- | --- | --- |
| `KVS.Get` | `{ key }` | `{ value, etag }` |
| `KVS.Set` | `{ key, value, etag? }` | `{ etag, rev }` |
| `KVS.GetMany` | `{ match?, offset? }` or `null` | `{ items, offset, total }` |
| `KVS.List` | `{ match? }` or `null` | `{ keys, rev }` |
| `KVS.Delete` | `{ key, etag? }` | `{ rev }` |

`GetMany.items` is typed as a key-to-item object; each item has `value` and `etag`.
`List.keys` maps keys to etag objects. Do not assume either is an array. Use the
limits in [constraints](constraints.md), and handle a missing key or invalid value.

`Script.storage` has `getItem`, `setItem`, `removeItem`, `clear`, `key`, and `length`.
`getItem` and `key` return `null` when absent. It is not the device-wide KVS.

```ts
const storedMode = Script.storage.getItem("mode");
const mode = storedMode === "active" ? "active" : "idle";
print("Mode", mode);
Script.storage.setItem("mode", mode);
```

## BLE scanning and advertisement parsing

The current [BLE API](https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/BLE/)
uses lowercase method names. Names are case-sensitive.

| API | Behavior |
| --- | --- |
| `BLE.Scanner.subscribe(callback, userdata?)` | Subscribes to scan events. Pass `null` to unsubscribe. Returns `void`. |
| `BLE.Scanner.start(options, callback?, userdata?)` | Starts scanning and returns scan options or `null`. |
| `BLE.Scanner.stop()` | Stops scanning and returns a boolean. |
| `BLE.Scanner.isRunning()` | Returns whether a scan is active. |
| `BLE.Scanner.getScanOptions()` | Returns current options or `null`. |
| `BLE.GAP.hasService(data, uuid)` | Tests for a service UUID in advertisement data. |
| `BLE.GAP.parseServiceData(data, uuid)` | Returns the service payload string or `null`. |
| `BLE.GAP.parseName(data)` | Parses one advertisement or scan-response data string. Returns a name or `null`. |
| `BLE.GAP.parseManufacturerData(data)` | Returns a company-ID-to-data object or `null`. |

Use `SCAN_RESULT` before accessing the result. Start and stop events have no scan
result. `ScanResult` includes `addr`, `addr_type`, `rssi`, `advData`, `scanRsp`, and
optional parsed fields such as `service_data` and `local_name`.

```ts
function onScan(
  event: number,
  result: BLE.Scanner.ScanResult | null | undefined,
  _userdata: undefined
): void {
  if (event !== BLE.Scanner.SCAN_RESULT || result == null) return;
  const name = BLE.GAP.parseName(result.advData)
    || BLE.GAP.parseName(result.scanRsp);
  if (name !== null) print(result.addr, name, result.rssi);
}

BLE.Scanner.subscribe(onScan);
if (!BLE.Scanner.isRunning()) {
  const started = BLE.Scanner.start({
    duration_ms: BLE.Scanner.INFINITE_SCAN,
    active: false
  });
  if (started === null) print("Could not start BLE scan");
}
```

Passive scanning avoids requesting scan responses. Use `active: true` only when
needed. Coordinate scanner use with other scripts and device configuration.
See [patterns](patterns.md) for BTHome filtering and de-duplication.

## Outgoing HTTP and incoming endpoints

[`HTTP.GET`, `HTTP.POST`, and `HTTP.Request`](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/HTTP/)
run through `Shelly.call`. `HTTP.POST.body` must be a string. Use `JSON.stringify`
for JSON, or `body_b64` for binary data. Do not supply both. Inspect both the RPC
error and HTTP status. Response `body` and `body_b64` are optional.
Keep the default TLS verification; do not disable it to hide certificate errors.

[`HTTPServer.registerEndpoint`](https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/HTTPServer/)
returns the endpoint path as a string. The handler receives request, response, and
optional userdata. Set the response, then call `send`. Request headers and response
headers use `[name, value]` pairs. Parse and validate any input before acting on it.

```ts
function onStatusRequest(
  request: HTTPServer.Request,
  response: HTTPServer.Response
): void {
  response.headers = [["Content-Type", "application/json"]];
  if (request.method !== "GET") {
    response.code = 405;
    response.body = JSON.stringify({ error: "method not allowed" });
  } else {
    response.code = 200;
    response.body = JSON.stringify({ uptimeMs: Shelly.getUptimeMs() });
  }
  response.send();
}

const statusPath = HTTPServer.registerEndpoint("status", onStatusRequest);
print("Endpoint", statusPath);
```

## Other globals and logging

`Script.id` identifies the current script. `Script.getVcHandle(role)` and
`Virtual.getHandle(key)` return a virtual component handle or `null` on supported
firmware. Check for `null` before use. `Virtual.off(listenerId)` returns `void`.

`print(...)` and `console.log(...)` write device logs. Avoid logging every BLE packet
or loop iteration, and never log credentials. Use the
[CLI skill](../../shelly-forge/SKILL.md) for log collection and debugging.
