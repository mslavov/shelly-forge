# Simulator tests

Use `shelly-forge/testing` from Node-side Vitest tests, not device code. The
template already separates `tsconfig.json` for device scripts from
`tsconfig.test.json` for tests. Keep tests named `src/**/*.test.ts`; the device
configuration excludes them. Run `npm test` and `npm run typecheck`.
Keep `moduleDetection: "force"` in both configurations. Test and device files do
not need an `export {}` marker just to avoid sharing a global scope.

Each TypeScript block below is a complete test file for an initialized project.
Save it at the path above the block. The first uses the template's existing
`src/example/hello.ts`; the others load small scripts from strings. No example
contacts a device, MQTT broker, or HTTP server.

## Load the real source and advance time

Save as `src/example/hello.skill.test.ts`.

```ts
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createShellyRuntime } from 'shelly-forge/testing';

test('the bundled starter increments its saved count after one minute', async () => {
  const runtime = createShellyRuntime({
    now: Date.UTC(2026, 0, 1),
    kvs: { 'example.hello.count': '7' },
  });
  const script = fileURLToPath(new URL('./hello.ts', import.meta.url));
  await runtime.loadScript(script, {
    projectDir: process.cwd(),
    env: { SHELLY_PUBLIC_GREETING: 'Welcome' },
  });

  runtime.advance(59999);
  expect(runtime.kvs.get('example.hello.count')).toBe('7');
  expect(runtime.logs).toEqual([]);
  runtime.advance(1);
  expect(runtime.kvs.entries()).toEqual({ 'example.hello.count': '8' });
  expect(runtime.logs).toEqual(['Welcome example/hello 8']);
  expect(runtime.calls.map(call => call.method)).toEqual(['KVS.Get', 'KVS.Set']);
  expect(runtime.now()).toBe(Date.UTC(2026, 0, 1) + 60000);
});
```

`loadScript` bundles TypeScript with minification disabled; it does not type-check
or run artifact checks. Supply `env` explicitly for public build values. The
template's empty `SHELLY_PUBLIC_GREETING` selects its fallback; omitting a public
value can leave an unresolved `process.env` access. Keep the CLI `check` step.

`advance(ms)` runs due timers in order and flushes queued RPC callbacks before
and between timer steps. It changes virtual time without waiting in real time.
`Date.now()` and `new Date()` inside the script use that clock.

## Inject status, events, and MQTT messages

Save as `src/testing/inputs.test.ts`.

```ts
import { expect, test } from 'vitest';
import { createShellyRuntime } from 'shelly-forge/testing';

test('inputs update a switch and publish its reported state', () => {
  const runtime = createShellyRuntime({
    components: { 'switch:0': { status: { output: false } } },
  });
  runtime.load(`
    function onStatus(event) {
      if (event.component === 'switch:0') {
        MQTT.publish('light/state', String(event.delta.output), 1, true);
      }
    }
    function onEvent(event) {
      if (event.component === 'input:0') print('input', event.info.event);
    }
    function onMessage(topic, message) {
      if (message === 'on' || message === 'off') {
        Shelly.call('Switch.Set', { id: 0, on: message === 'on' });
      }
    }
    Shelly.addStatusHandler(onStatus);
    Shelly.addEventHandler(onEvent);
    MQTT.subscribe('light/+', onMessage);
  `);

  runtime.setStatus('switch:0', { output: false });
  expect(runtime.mqtt.published).toEqual([
    { topic: 'light/state', message: 'false', qos: 1, retain: true },
  ]);
  runtime.emitEvent('input:0', { event: 'single_push' });
  expect(runtime.logs).toEqual(['input single_push']);

  runtime.mqtt.receive('light/set', 'invalid');
  expect(runtime.calls).toEqual([]);
  runtime.mqtt.receive('light/set', 'on');
  expect(runtime.calls).toEqual([{ method: 'Switch.Set', params: { id: 0, on: true } }]);
  expect(runtime.mqtt.published).toHaveLength(1);
  runtime.flush();
  expect(runtime.mqtt.published[1]).toEqual({
    topic: 'light/state', message: 'true', qos: 1, retain: true,
  });

  runtime.mqtt.setConnected(false);
  runtime.setStatus('switch:0', { output: false });
  expect(runtime.mqtt.published).toHaveLength(2);
});
```

`setStatus` merges a delta and calls status handlers. `emitEvent` creates an event
with `component`, `id`, and `info`. These methods run handlers immediately.
Both copy the host input before entering the script. Inputs that JSON cannot
serialize, such as circular references or `BigInt`, throw `TypeError` to the test
without crashing the runtime, changing component state, invoking handlers, or
clearing queued work. An uncaught error inside a script handler still crashes
the runtime as described below.
`mqtt.receive` injects messages into matching subscriptions, including `+` and `#`
wildcards. It does not create a broker connection.

`Shelly.call` queues work even without a callback. `flush()` runs that work and
drains callbacks, including calls queued by callbacks. Before flushing, `calls`
records the requests but side effects and callbacks have not occurred.

## Test HTTP and RPC failures

Save as `src/testing/http.test.ts`.

```ts
import { expect, test } from 'vitest';
import { createShellyRuntime, RpcError } from 'shelly-forge/testing';

test('an HTTP endpoint responds without opening a socket', () => {
  const runtime = createShellyRuntime();
  runtime.load(`
    function onRequest(request, response) {
      response.code = request.method === 'GET' ? 200 : 405;
      response.headers = [['Content-Type', 'application/json']];
      response.body = JSON.stringify({ ready: request.method === 'GET' });
      response.send();
    }
    HTTPServer.registerEndpoint('status', onRequest);
  `);
  expect(runtime.http.request('status')).toEqual({
    code: 200, body: '{"ready":true}', headers: [['Content-Type', 'application/json']],
  });
  expect(runtime.http.request('/script/1/status', { method: 'POST', body: '{}' }).code).toBe(405);
  expect(runtime.http.request('missing').code).toBe(404);
});

test('an injected RPC handler supplies success and failure callbacks', () => {
  let fail = false;
  const runtime = createShellyRuntime({
    rpc: {
      'HTTP.GET': params => {
        expect(params.url).toBe('https://example.test/state');
        if (fail) throw new RpcError(-104, 'test upstream unavailable');
        return { code: 200, body: 'ready' };
      },
    },
  });
  runtime.load(`
    function onResponse(result, errorCode, errorMessage) {
      if (errorCode !== 0) print('failed', errorCode, errorMessage);
      else print('received', result.body);
    }
    function requestState() {
      Shelly.call('HTTP.GET', { url: 'https://example.test/state' }, onResponse);
    }
    requestState();
    Timer.set(1000, false, requestState);
  `);
  expect(runtime.logs).toEqual([]);
  runtime.flush();
  expect(runtime.logs).toEqual(['received ready']);
  fail = true;
  runtime.advance(1000);
  expect(runtime.logs[1]).toBe('failed -104 test upstream unavailable');
});
```

Injected `rpc` handlers run at flush time and override built-ins. Their signature
is `(params, runtime) => result`. Throw `RpcError(code, message)` to deliver
`null`, the code, and the message to the device callback. Successful callbacks get
the result, `0`, and an empty message. Any other uncaught error fails the runtime
call as `ShellyScriptError` instead of simulating a device RPC failure.

Without a handler, outgoing `HTTP.*` and unknown RPC methods return `-114` with
`method not simulated: <name>`. Built-ins include KVS, Switch, `Sys.GetStatus`, and
`Shelly.GetDeviceInfo`. HTTP endpoints run synchronously; failing to call
`response.send()` returns 504, so asynchronous endpoint completion is not simulated.

## Keep strict built-ins and test resource failures

Save as `src/testing/limits.test.ts`.

```ts
import { expect, test } from 'vitest';
import { createShellyRuntime, ShellyScriptError } from 'shelly-forge/testing';

test('unsupported array methods fail by default', () => {
  const runtime = createShellyRuntime();
  expect(() => runtime.load('[1].map(function (value) { return value + 1; });'))
    .toThrow(ShellyScriptError);
});

test('strictBuiltins can be disabled for a diagnostic comparison', () => {
  const runtime = createShellyRuntime({ strictBuiltins: false });
  runtime.load('print([1].map(function (value) { return value + 1; })[0]);');
  expect(runtime.logs).toEqual(['2']);
});

test('undeclared modern built-ins also fail', () => {
  for (const code of [
    '"test".startsWith("t");',
    'Object.assign({}, { value: 1 });',
    'Array.from([1]);',
    'Number.isInteger(1);',
    'Math.trunc(1.5);',
  ]) {
    const runtime = createShellyRuntime();
    expect(() => runtime.load(code)).toThrow(ShellyScriptError);
  }
});

test('String.at returns a code number or undefined in both modes', () => {
  for (const strictBuiltins of [true, false]) {
    const runtime = createShellyRuntime({ strictBuiltins });
    runtime.load('print("A".at(0), "A".at(1));');
    expect(runtime.logs).toEqual(['65 undefined']);
  }
});

test('the sixth active timer exceeds the device budget', () => {
  const runtime = createShellyRuntime();
  expect(() => runtime.load(`
    function tick() {}
    for (var i = 0; i < 6; i++) Timer.set(1000, true, tick);
  `)).toThrow('timers limit exceeded (5)');
});

test('a missing KVS key returns an RPC error on flush', () => {
  const runtime = createShellyRuntime();
  runtime.load(`
    function onValue(result, errorCode) { print(errorCode, result === null); }
    Shelly.call('KVS.Get', { key: 'missing' }, onValue);
  `);
  expect(runtime.logs).toEqual([]);
  runtime.flush();
  expect(runtime.logs).toEqual(['-105 true']);
});
```

Keep `strictBuiltins` enabled for acceptance tests. Disabling it can explain a
failure but cannot establish device compatibility. The simulator removes the
unsupported globals, array methods, and undeclared modern String, Object, Array,
Number, Math, and other built-ins in the
[device constraints](../../shelly-scripting/reference/constraints.md).
TypeScript's generated `__assign` and `__rest` helpers feature-detect missing
methods and still work through their fallbacks. This does not permit direct
`Object.assign` calls. `String.prototype.at` returns a numeric character code or
`undefined` outside bounds, even with `strictBuiltins: false`. The VM still uses
JavaScript strings, so do not use it to prove UTF-8 byte indexing for non-ASCII text.
It enforces timer, handler, subscription, endpoint, in-flight call, and KVS limits.

## Inspect a crashed script without resuming it

Save as `src/testing/crash.test.ts`.

```ts
import { expect, test } from 'vitest';
import { createShellyRuntime, ShellyScriptError } from 'shelly-forge/testing';

test('the first uncaught error stops callbacks and preserves inspection state', () => {
  const runtime = createShellyRuntime({ now: 0, kvs: { saved: 'before' } });
  runtime.load(`
    function onInput() { print('input'); }
    function fail() {
      print('before failure');
      Shelly.call('KVS.Set', { key: 'queued', value: 'discarded' });
      throw new Error('timer failed');
    }
    Shelly.addEventHandler(onInput);
    Timer.set(10, true, fail);
  `);
  expect(runtime.crashed).toBeUndefined();
  expect(() => runtime.advance(10)).toThrow(ShellyScriptError);
  const failure = runtime.crashed;
  expect(failure).toBeInstanceOf(ShellyScriptError);
  expect(runtime.calls).toEqual([
    { method: 'KVS.Set', params: { key: 'queued', value: 'discarded' } },
  ]);

  runtime.advance(1000);
  runtime.flush();
  runtime.emitEvent('input:0', { event: 'single_push' });
  expect(runtime.now()).toBe(10);
  expect(runtime.logs).toEqual(['before failure']);
  expect(runtime.kvs.entries()).toEqual({ saved: 'before' });
  expect(() => runtime.load('print("cannot restart");')).toThrow(failure);
  expect(runtime.crashed).toBe(failure);
});
```

The triggering operation throws `ShellyScriptError`. Its `original` field holds
the thrown value, and the readonly `runtime.crashed` getter retains that first
error. This applies to top-level code and timer, RPC, event, status, MQTT, HTTP,
and BLE callbacks. An error caught by the script does not crash the runtime.

A crash clears timers, pending RPC calls, event and status handlers, MQTT
subscriptions and connection handlers, HTTP endpoints, and BLE scans and
listeners. Later `advance()` and `flush()` are no-ops, including no clock advance.
Later `load()` throws the same stored error. Calls, logs, completed KVS writes,
and `runtime.mqtt.published` remain inspectable. Create a new runtime to model a
restart.

## Other inputs and limits of the model

| API | Use |
| --- | --- |
| `runtime.load(code, { filename })` | Load JavaScript directly, with an optional diagnostic filename. |
| `await runtime.loadArtifact(path)` | Load an existing built artifact, including its minification. Run `build` first. |
| `createShellyRuntime({ deviceInfo })` | Supply identity fields returned by the simulated Shelly API. |
| `createShellyRuntime({ mqttConnected: false })` | Start with MQTT disconnected. |
| `components['switch:0'].config` | Seed local component configuration as well as status. |
| `runtime.ble.advertise(result)` | Inject a scan result after the script starts and subscribes to the scanner. |

Each new runtime starts with separate state and script ID 1. KVS seed and inspection
values are strings; other JSON values written by scripts appear serialized in
`runtime.kvs`. Recreate a runtime with a KVS snapshot to model saved state after a
restart. `Script.storage` is separate from KVS and has no seed option.

The simulator uses Node's VM and is not a security boundary for hostile scripts.
It does not model device CPU, memory exhaustion, radio behavior, digest auth,
network latency, or every firmware API. BLE GAP parsers throw `not simulated` and
virtual component handles return `null`. Keep device verification and bounded logs
in the [workflow](../SKILL.md) after tests pass.
