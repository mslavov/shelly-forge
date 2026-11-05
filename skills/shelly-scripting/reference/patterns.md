# Device patterns

Each TypeScript block is self-contained and uses the device declarations. Register
callbacks after their definitions. Adapt identifiers and defaults to the application.
See [constraints](constraints.md) for the budgets these patterns must stay within.

## Sequence dependent calls

Use named callbacks instead of nesting anonymous functions. Check the result at
each step. This sequence has only one request in flight at a time.

```ts
function onSaved(
  result: { etag: string; rev: number } | undefined,
  errorCode: number,
  errorMessage: string
): void {
  if (errorCode !== 0 || result === undefined) {
    print("Could not save output state", errorCode, errorMessage);
    return;
  }
  print("Saved revision", result.rev);
}

function onOutput(
  result: ShellySwitchStatus | undefined,
  errorCode: number,
  errorMessage: string
): void {
  if (errorCode !== 0 || result === undefined) {
    print("Could not read output", errorCode, errorMessage);
    return;
  }
  Shelly.call("KVS.Set", { key: "lighting.output", value: result.output }, onSaved);
}

Shelly.call("Switch.GetStatus", { id: 0 }, onOutput);
```

## Validate persistent state through a typed store

KVS values may come from an older script version or another writer. Validate reads
and return an explicit default. A failed write must not look like success. This
store uses callback userdata rather than closing over callbacks at multiple levels.

```ts
type OutputMode = "on" | "off";

function onModeRead(
  result: ShellyKvsItem | undefined,
  errorCode: number,
  errorMessage: string,
  done: (mode: OutputMode) => void
): void {
  if (errorCode !== 0 || result === undefined) {
    print("Using default mode", errorCode, errorMessage);
    done("off");
    return;
  }
  done(result.value === "on" ? "on" : "off");
}

function onModeWritten(
  result: { etag: string; rev: number } | undefined,
  errorCode: number,
  errorMessage: string,
  done: (success: boolean) => void
): void {
  const success = errorCode === 0 && result !== undefined;
  if (!success) print("Could not save mode", errorCode, errorMessage);
  done(success);
}

const modeStore = {
  read: function (done: (mode: OutputMode) => void): void {
    Shelly.call("KVS.Get", { key: "lighting.mode" }, onModeRead, done);
  },
  write: function (mode: OutputMode, done: (success: boolean) => void): void {
    Shelly.call("KVS.Set", { key: "lighting.mode", value: mode }, onModeWritten, done);
  }
};

function onLoaded(mode: OutputMode): void {
  print("Loaded mode", mode);
}

modeStore.read(onLoaded);
```

## Use one timer and expire external data

Keep timing and thresholds in one configuration object. This example accepts only
a JSON object with an integer level from 0 to 100. It forgets the level after two
minutes without a valid message. A real controller must define the safe fallback
before applying the value to an output.

```ts
const CONFIG = {
  tickMs: 10000,
  maxAgeMs: 120000,
  topics: { input: "lighting/level/set", state: "lighting/level/state" }
};
let requestedLevel = 0;
let receivedAt: number | null = null;

function onLevelMessage(_topic: string, message: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch (error) {
    print("Invalid level JSON", String(error));
    return;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
  const level = (parsed as { level?: unknown }).level;
  if (typeof level !== "number" || !isFinite(level)) return;
  if (level < 0 || level > 100 || Math.floor(level) !== level) return;
  requestedLevel = level;
  receivedAt = Shelly.getUptimeMs();
}

function tick(): void {
  if (receivedAt === null) return;
  const age = Shelly.getUptimeMs() - receivedAt;
  if (age < 0 || age > CONFIG.maxAgeMs) {
    requestedLevel = 0;
    receivedAt = null;
    print("External level expired; using zero");
  }
  if (MQTT.isConnected()) {
    const sent = MQTT.publish(CONFIG.topics.state, String(requestedLevel));
    if (!sent) print("Could not publish level");
  }
}

MQTT.subscribe(CONFIG.topics.input, onLevelMessage);
Timer.set(CONFIG.tickMs, true, tick);
```

When a tick needs RPC data, track whether a call is pending. Clear the flag in the
callback on success and error. Do not let a slow response create five concurrent
requests. For bounded retries, use a later tick rather than a busy loop.

## Filter BLE senders and de-duplicate BTHome packets

This decoder accepts only unencrypted BTHome v2 payloads containing packet ID
`0x00` and battery `0x01` objects. It rejects unknown fields, malformed lengths,
missing IDs, and invalid battery values. It is not a general BTHome decoder.
Extend it with lengths and types from the [BTHome format](https://bthome.io/format/)
before using another sensor layout. Encrypted payloads require a separate decoder
with authentication checks.

Filter by address before decoding. Track duplicates per sender because different
devices can use the same packet ID. The 8-bit ID wraps, so this example only drops
matching IDs seen within ten seconds. An address allowlist does not authenticate
an unencrypted advertisement; do not use it as an authorization check.

```ts
interface BatteryPacket {
  packetId: number;
  battery: number;
}

const SENSOR_ADDRESSES = ["aa:bb:cc:dd:ee:ff"];
const lastPackets: Record<string, { id: number; time: number }> = {};

function decodeBattery(data: string): BatteryPacket | null {
  if (data.length < 5) return null;
  const info = data.at(0);
  if ((info >> 5) !== 2 || (info & 1) !== 0) return null;
  let packetId: number | null = null;
  let battery: number | null = null;
  let offset = 1;
  while (offset < data.length) {
    if (offset + 1 >= data.length) return null;
    const objectId = data.at(offset);
    const value = data.at(offset + 1);
    if (objectId === 0x00 && packetId === null) packetId = value;
    else if (objectId === 0x01 && battery === null && value <= 100) battery = value;
    else return null;
    offset += 2;
  }
  if (packetId === null || battery === null) return null;
  return { packetId: packetId, battery: battery };
}

function onBatteryScan(
  event: number,
  result: BLE.Scanner.ScanResult | null | undefined,
  _userdata: undefined
): void {
  if (event !== BLE.Scanner.SCAN_RESULT || result == null) return;
  const address = result.addr.toLowerCase();
  if (SENSOR_ADDRESSES.indexOf(address) === -1) return;
  const serviceData = result.service_data;
  const data = serviceData && serviceData["fcd2"];
  if (data === undefined) return;
  const packet = decodeBattery(data);
  if (packet === null) return;
  const now = Shelly.getUptimeMs();
  const previous = lastPackets[address];
  if (previous !== undefined && previous.id === packet.packetId
      && now >= previous.time && now - previous.time < 10000) return;
  lastPackets[address] = { id: packet.packetId, time: now };
  print("Battery", address, packet.battery);
}

BLE.Scanner.subscribe(onBatteryScan);
if (!BLE.Scanner.isRunning()) {
  const started = BLE.Scanner.start({
    duration_ms: BLE.Scanner.INFINITE_SCAN,
    active: false
  });
  if (started === null) print("Could not start BLE scan");
}
```

Strings are byte buffers here. Use `.at(i)` for numbers and `.slice(n)` for a byte
subsequence. Keep scan callbacks short; do not issue an HTTP request for every
advertisement. Read the [BLE API reference](runtime-api.md#ble-scanning-and-advertisement-parsing)
for scanner ownership and lowercase method names.

## Call a different device through HTTP

`Shelly.call("Switch.Set", ...)` controls the local device. To call a remote device,
use HTTP and serialize the request body. This example requires a target that permits
the request under its access policy. It does not implement digest authentication.
Do not put passwords into a URL or `SHELLY_PUBLIC_*` values.

```ts
function onRemoteReply(
  result: ShellyHttpResponse | undefined,
  errorCode: number,
  errorMessage: string
): void {
  if (errorCode !== 0 || result === undefined) {
    print("Remote request failed", errorCode, errorMessage);
    return;
  }
  if (result.code !== 200) {
    print("Remote HTTP status", result.code);
    return;
  }
  print("Remote request completed");
}

function setRemoteOutput(address: string, on: boolean): void {
  Shelly.call("HTTP.POST", {
    url: "http://" + address + "/rpc/Switch.Set",
    body: JSON.stringify({ id: 0, on: on }),
    content_type: "application/json",
    timeout: 5
  }, onRemoteReply);
}

const remoteAddress = process.env.SHELLY_PUBLIC_REMOTE_HOST;
if (remoteAddress) setRemoteOutput(remoteAddress, false);
```

## Compact boolean state

A seven-day selection needs seven bits rather than a JSON array of booleans. Keep
the day ordering stable across writers and readers. This example treats index zero
as the first day chosen by the application, not a specific calendar convention.

```ts
function daysToMask(days: boolean[]): number {
  let mask = 0;
  for (let i = 0; i < 7; i++) {
    if (days[i]) mask |= 1 << i;
  }
  return mask;
}

function maskHasDay(mask: number, dayIndex: number): boolean {
  if (dayIndex < 0 || dayIndex > 6 || Math.floor(dayIndex) !== dayIndex) return false;
  return (mask & (1 << dayIndex)) !== 0;
}

const selectedDays = daysToMask([true, true, true, true, true, false, false]);
print("First day selected", maskHasDay(selectedDays, 0));
```

## Inline public build values

Use direct property access with a literal `SHELLY_PUBLIC_` name. The project-root
`.env` can hold these build values as well as device configuration. Existing process
environment values take precedence. Never store credentials in public build values.

```ts
const sensorAddresses =
  (process.env.SHELLY_PUBLIC_SENSOR_ADDRESSES || "").toLowerCase().split(",");
const allowedAddresses: string[] = [];
for (let i = 0; i < sensorAddresses.length; i++) {
  const address = sensorAddresses[i].trim();
  if (address !== "") allowedAddresses.push(address);
}
print("Configured sensor count", allowedAddresses.length);
```

The fallback expression does not make an unset build variable safe: set
`SHELLY_PUBLIC_SENSOR_ADDRESSES` at build time, even to an empty string. Otherwise
the unresolved `process.env` access remains and fails `unresolved-env`.
Do not enumerate `process.env` or construct variable names dynamically.
Device `${VAR}` references in `solutions.config.json` are separate; they select
deployment targets and are not embedded in device code. Building does not require
those device references to resolve.

Keep source modules under `src/<solution>/` and put genuinely shared helpers in
`src/shared/`. Use the [CLI skill](../../shelly-forge/SKILL.md) for creation, testing
with `shelly-forge/testing`, deployment, and debugging.
