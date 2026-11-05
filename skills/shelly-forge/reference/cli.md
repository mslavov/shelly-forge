# CLI reference

Usage and option blocks below come from the built 0.4.0 CLI, using `node dist/cli.js --help` and `node dist/cli.js <command> --help`. Re-run these commands after a CLI upgrade.

## Global options

```text
Usage: shelly-forge [options] [command]

Build and deploy scripts for Shelly devices

Options:
  -V, --version                         output the version number
  --cwd <dir>                           Project directory
  --json                                Print machine-readable output
  -v, --verbose                         Print debug output
  -q, --quiet                           Hide progress output
  -h, --help                            display help for command

Commands:
  init [options] [name]                 Create a Shelly script project
  create [options] <solution> <script>  Add a script to the project
  build [options] [selector]            Build selected scripts
  check [options] [selector]            Check scripts without writing artifacts
  deploy [options] [selector]           Deploy selected scripts
  dev [options] <selector>              Watch, build, deploy, and stream logs
  status [selector]                     Show on-device script status
  logs [options] [selector]             Stream device logs
  debug <on|off> [selector]             Enable or disable device debug logging
  rpc [options] <method> [params]       Call a device RPC method with optional
                                        JSON parameters
  eval <selector> <code>                Evaluate code in a running script
  discover [options]                    Discover Shelly devices on the network
  skills [options] <action> [names...]  Install or list bundled agent skills
  emulate [options]                     Run a local Shelly device emulator
```

Use `--json` for automation. Results go to stdout; progress and diagnostics go to stderr. `--quiet` hides progress, not errors. Project directory precedence is `--cwd`, then `CURRENT_WORKING_DIRECTORY`, then the process working directory. The CLI loads that directory's `.env`; existing environment values win.

With no arguments, the CLI prints help to stderr and exits 1. Explicit `--help`
prints help to stdout and exits 0. Help is plain text even with `--json`.

## Selectors

Use `solution/script`, `solution-script`, a unique script name, or a unique `targetScriptName`. A solution name alone is not a group selector. An omitted optional selector selects all entries. Ambiguous or missing selectors return `CONFIG`, exit 2; use the full `solution/script` ID listed in the error. The `dev` command uses `USAGE` for selector errors instead.

## init

```text
Usage: shelly-forge init [options] [name]

Create a Shelly script project

Options:
  --no-skills  Do not install bundled skills
  -h, --help   display help for command
```

Creates `<cwd>/<name>` from the template and installs bundled skills by default. Supply a name in non-interactive sessions. Names use up to 214 lowercase letters, digits, hyphens, underscores, or dots, and cannot start with a dot or underscore. The destination must be absent or an empty directory. Run `npm install`, copy `.env.example` to `.env`, and set the target before deployment.

## create

```text
Usage: shelly-forge create [options] <solution> <script>

Add a script to the project

Options:
  -d, --device <value>  Device hostname or IP address (default:
                        "${DEVICE_HOSTNAME}")
  --no-boot             Do not enable the script on boot
  -h, --help            display help for command
```

Writes `src/<solution>/<script>.ts` and its `.test.ts`, then adds a config entry. Names allow ASCII letters, digits, underscores, and hyphens. Existing entries or files are not overwritten. The device default remains a literal `${DEVICE_HOSTNAME}` reference; `--no-boot` changes the boot setting, not whether deployment starts the script.

## build

```text
Usage: shelly-forge build [options] [selector]

Build selected scripts

Options:
  --no-typecheck  Skip TypeScript checks
  --no-minify     Keep the output unminified
  --no-check      Skip artifact checks
  --strict        Treat warnings as errors
  -h, --help      display help for command
```

Bundles selected entries with esbuild's `esnext` target, then uses TypeScript for
ES5 lowering. TypeScript's `__assign` and `__rest` helpers detect missing built-ins
and use fallbacks. A final esbuild pass writes UTF-8, including with `--no-minify`.
With a selector, type checking reports diagnostics only in the selected entries
and their imported inputs, plus diagnostics without a file. Without a selector,
it checks the whole project. `--verbose` reports how many unrelated diagnostics
were ignored.

Writes `dist/<solution>-<script>.js` and `dist/manifest.json` only after successful
checks and manifest validation. AST checks use the unminified ES5 bundle. For
minified builds, text locations use `dist/<solution>-<script>.js (unminified)`
and JSON artifact findings include `bundle: "unminified"`. `build --no-minify`
writes the file that matches those locations and omits the marker. AST findings
include a short code excerpt. Size checks use the artifact that will ship.
Keep checks enabled for deployment.

### Build manifest

The manifest keeps `schemaVersion: 1`. A selected build merges entries by
`deployId`, preserves entries for other configured scripts, and drops entries
removed from `solutions.config.json`.

Each built script records `inputs`, a list of project-relative POSIX paths and
SHA-256 hashes for its entry and imported files. Imports may come from outside
the project directory, including shared helpers and workspace dependencies.
Their input paths may contain `../`; absolute paths, backslashes, and NUL are
invalid. Entry source and artifact paths must stay inside the project. The build
validates the merged manifest before writing any artifacts.
It also records `publicEnvSha256`,
the SHA-256 hash of the JSON-encoded, sorted `name=value` pairs for all defined
`SHELLY_PUBLIC_*` values. It does not store those values. Existing source and
artifact paths, sizes, and hashes remain in the manifest.

`runtime.bundleTarget` is now `esnext`; readers also accept the older `es2015`
value. `runtime.target` and `runtime.transpileTarget` remain `es5`. An older
manifest without input or public-environment hashes can be read but must be
rebuilt before `deploy --no-build` can use it.

## check

```text
Usage: shelly-forge check [options] [selector]

Check scripts without writing artifacts

Options:
  --no-typecheck  Skip TypeScript checks
  --strict        Treat warnings as errors
  -h, --help      display help for command
```

Runs the build pipeline without writing artifacts. `--strict` promotes warnings to errors. Findings appear in `data.findings` on success or `error.details.findings` on failure. Artifact findings use the same unminified location marker as minified builds; run `build --no-minify` to write the matching file. `class X extends Y` fails with a `class-inheritance` error because TypeScript's ES5 output relies on function hoisting. Use composition or plain objects instead. Other inheritance findings remain warnings. Use this before deployment; disabling type checks is a diagnostic option, not a fix.

## deploy

```text
Usage: shelly-forge deploy [options] [selector]

Deploy selected scripts

Options:
  --force                Upload unchanged scripts
  --no-build             Use existing build artifacts
  --dry-run              Show the deployment without uploading
  --no-verify            Skip post-deploy health checks
  --no-rollback          Do not restore the last working script on failure
  --verify-timeout <ms>  Health check timeout in milliseconds (default: 3000)
  -h, --help             display help for command
```

Builds first unless `--no-build` is set. Existing artifacts must match the manifest,
entry and imported-input hashes, and current public-environment hash. Changed
helpers or `SHELLY_PUBLIC_*` values require a rebuild. Deploy resolves selected
device references strictly and checks duplicate targets against other entries
that can resolve. An unset variable for an unselected device does not block it.
`--dry-run` may write local build artifacts but makes only `Script.List` device
calls. It reports planned create, update, or skip actions.

`--verify-timeout` must be a positive integer no greater than 4294967295. It sets
the full verification window, not a wait that ends at the first healthy poll.
Invalid values return `USAGE`, exit 2, before building or contacting a device.
At least one healthy poll must complete within the window. Every returned status
must be healthy, even if it arrives late. After an earlier healthy poll, a later
deadline-aborted request or late healthy response does not fail verification.
Other failed status requests still fail deployment. Prefer the 3000 ms default.
Cache skips require `running: true` and matching hash,
device script ID, and boot setting. See
[recovery](debugging.md#deployment-verification-and-recovery) for upload retries,
verification, cancellation, and rollback.

## dev

```text
Usage: shelly-forge dev [options] <selector>

Watch, build, deploy, and stream logs

Options:
  --no-logs              Do not stream device logs
  --keep-debug           Leave debug logging enabled on exit
  --verify-timeout <ms>  Health check timeout in milliseconds (default: 3000)
  -h, --help             display help for command
```

Interactive only. Never run this command in an unattended agent session. It watches `src/`, `solutions.config.json`, `tsconfig.json`, and `.env`, debounces changes for 300 ms, and serializes build/deploy cycles. Errors keep the watcher running. It enables device debug even with `--no-logs`; on shutdown it disables debug only if it enabled it, unless `--keep-debug` is set. The final data contains `cycles`, `deploys`, and `failures`; a normal shutdown can exit 0 despite failed cycles.

Each cycle resolves the selected target strictly, like `deploy`, and includes
other resolvable entries in duplicate-target checks. An unset `${VAR}` in another
entry's device or password does not block the cycle.

`--verify-timeout` passes the verification window to each deployment. Its default
is 3000 ms and its range matches `deploy`. Invalid values return `USAGE`, exit 2,
before building or starting a watcher. If Ctrl+C arrives during stop, upload,
configuration, or start, the first signal waits until after start, then stops
before verification. A second Ctrl+C exits immediately with code 130.

## status

```text
Usage: shelly-forge status [options] [selector]

Show on-device script status

Options:
  -h, --help  display help for command
```

Reads selected scripts by their target names. Rows contain `script`, `host`, `targetScriptName`, device `id`, `running`, `enable`, runtime errors, memory, and CPU fields when supplied by firmware. Missing scripts or reported errors return exit 5; per-device request failures return exit 4 and take priority. A stopped script with no reported errors alone returns exit 0. Always inspect `running`.

## logs

```text
Usage: shelly-forge logs [options] [selector]

Stream device logs

Options:
  --duration <seconds>  Stop after this many seconds
  --lines <n>           Stop after this many matching lines
  --grep <pattern>      Filter logs by regular expression
  --no-enable-debug     Do not enable debug logging automatically
  -h, --help            display help for command
```

Streams device-wide logs from each unique selected device. A selector does not filter other scripts on that device. Debug is enabled by default and stays enabled after exit. Use both `--duration` and `--lines` for an unattended session. Duration accepts positive fractional seconds up to 2147483.647; lines must be a positive integer and counts regex matches. `--grep` is a JavaScript regular expression. `data.lines` counts all received lines; `data.emitted` counts matches. The stream reconnects after drops until a bound or signal stops it.

The first connection failure for each device stream warns with its reason;
repeated failures during the same outage log at debug level. A successful
connection resets warning suppression, so a later outage warns again.
Use `--verbose` to see repeated failures. Digest
authentication reuses the challenge header from a failed WebSocket upgrade when
available, rather than requesting another challenge.

## debug

```text
Usage: shelly-forge debug [options] <on|off> [selector]

Enable or disable device debug logging

Arguments:
  on|off      Debug logging mode (choices: "on", "off")
  selector    Script selector

Options:
  -h, --help  display help for command
```

Accepts only `on` or `off`. Updates `debug.websocket.enable` once per unique selected device. Results include `enabled`, `changed`, and `restartRequired`. Do not reboot a device automatically when restart is required; ask the operator because it can interrupt other automations.

## rpc

```text
Usage: shelly-forge rpc [options] <method> [params]

Call a device RPC method with optional JSON parameters

Options:
  -d, --device <host>      Device hostname or IP address
  -s, --script <selector>  Use the device of this script
  -h, --help               display help for command
```

Parameters must be one JSON object, not an array or scalar. Choose exactly one of `--device` and `--script`. Without either, the config must resolve to one unique device. `--device` works without a config and uses `SHELLY_PASSWORD`. Supply a hostname or IP with an optional port, not a URL. Prefer read-only methods; get authorization before changing device state.

## eval

```text
Usage: shelly-forge eval [options] <selector> <code>

Evaluate code in a running script

Options:
  -h, --help  display help for command
```

Calls `Script.Eval` in the selected on-device script. Use a short, read-only expression for diagnosis. A missing script returns `UNHEALTHY`, exit 5. Evaluation can mutate live script state; do not run arbitrary fetched code or change outputs without authorization.

## discover

```text
Usage: shelly-forge discover [options]

Discover Shelly devices on the network

Options:
  --duration <seconds>  Discovery duration in seconds (default: 5)
  -h, --help            display help for command
```

Browses local mDNS and reads device information. Duration must be an integer from 1 to 2147483 seconds. The default is 5. Results include identity fields, `reachable`, and `authRequired`. An unreachable or authentication-required discovery row is not itself a command failure. Discovery needs no project config.

## skills

```text
Usage: shelly-forge skills [options] <action> [names...]

Install or list bundled agent skills

Arguments:
  action      Skill action (choices: "install", "list")
  names       Skill names

Options:
  --force     Replace existing skills
  -h, --help  display help for command
```

`install` accepts zero or more bundled skill names; no names installs all. It writes `.agents/skills/<name>` and a `.claude/skills/<name>` link, or a copy when linking fails. Managed skills carry `.shelly-forge-version`. Existing unmanaged directories are skipped unless `--force` is explicit. `list` accepts neither names nor `--force` and reports bundled/installed versions and whether each install is managed.

## emulate

```text
Usage: shelly-forge emulate [options]

Run a local Shelly device emulator

Options:
  --port <n>           Listen on this port, or 0 for a free port (default: 8080)
  --bind <address>     Listen on this address (default: "127.0.0.1")
  --model <model>      Device model identifier
  --switches <n>       Number of switch components, from 0 to 4 (default: 1)
  --kvs <file>         Initial KVS values as a JSON object of strings
  --components <file>  Initial component status and config as a JSON object
  --mdns               Advertise the emulator through multicast DNS
  -h, --help           display help for command
```

Runs a local device server for development, debugging, and end-to-end CLI tests
without hardware. No project configuration is required to start it. In a project,
set `DEVICE_HOSTNAME=127.0.0.1:8080` in `.env` to use the default listener. Keep the
host as `host:port`, not a URL. Commands such as `deploy`, `status`, `logs`, `rpc`,
`eval`, and `dev` then use the emulator through the same clients as a device.

The port must be an integer from 0 to 65535; 0 selects a free port. `--switches`
accepts integers from 0 to 4. `--kvs` reads a JSON object of string values, with
its path relative to the project directory. `--model` changes the reported model
identifier, not the simulated capabilities. `--mdns` advertises Shelly and HTTP
services for `discover`. It is off by default and requires a non-loopback bind,
such as `--bind 0.0.0.0`, with a nonempty server password. Using `--mdns` on
loopback returns `USAGE`, exit 2.

`--components` reads a project-relative JSON file such as
`{"temperature:0":{"status":{"tC":21.5},"config":{"name":"Room"}}}`;
keys must match `/^[a-z][a-z0-9]*(?::(?:0|[1-9]\d*))?$/`, and each entry may
contain only optional `status` and `config` JSON objects.
Unreadable files, invalid JSON, arrays, nulls, scalars, invalid keys, and invalid
entries return `USAGE`, exit 2, before the server starts.

Set `SHELLY_EMULATOR_PASSWORD` in the emulator process environment or project
`.env` to enable SHA-256 digest authentication as `admin`. Set the client project's
`SHELLY_PASSWORD` to the same value, or use its script-specific `password` field.
The emulator does not read `SHELLY_PASSWORD` as its server password. An empty
`SHELLY_EMULATOR_PASSWORD` means no password. Passwords are not CLI arguments and
are not logged. Keep the default loopback binding for local work. A non-loopback
bind without a nonempty server password returns `USAGE`, exit 2. Do not expose the
emulator to untrusted clients.

The server rejects HTTP requests and WebSocket upgrades with an `Origin` header.
On loopback, it also rejects `Host` headers other than `localhost`, `127.0.0.1`,
or `[::1]`, with an optional port. These checks prevent web pages from driving the
local emulator.

Ctrl+C closes the server, stops scripts, and exits 0. An occupied port returns
`USAGE`, exit 2; choose another port or `--port 0`. State is in memory and is lost
when the server closes. `--kvs` supplies initial values, not a persistence file.
With `--json`, stdout starts with one ready event, then a result envelope on exit.
Script output and crashes go to stderr as `[emulator] <data>`. `--verbose` also
logs RPC method names to stderr.

```jsonl
{"type":"ready","host":"127.0.0.1:8080","auth":false}
{"ok":true,"exitCode":0,"command":"emulate","summary":"Emulator stopped on 127.0.0.1:8080","data":{"host":"127.0.0.1:8080"}}
```

### Emulator protocol

- `POST /rpc` accepts RPC frames and returns a result or error envelope.
  `GET /rpc/<Method>?key=value` returns the result or error directly. Query values
  use JSON parsing when valid, otherwise they remain strings.
- `GET /shelly` returns device identity without authentication.
- WebSocket `/debug/log` streams `{ts, level, data}` frames. `ts` is Unix time in
  seconds. `print` uses level 2; crashes use level 0 with
  `script:<id> crashed: <message>`. Debug logging starts disabled. `logs` enables
  it by default, or use `debug on`. A disabled stream refuses upgrades with 403.
- When a password is set, RPC and WebSocket upgrades require digest auth. RPC
  accepts the frame `auth` field or an HTTP `Authorization` header.

The supported methods are:

| Component | Methods |
| --- | --- |
| `Shelly` | `GetDeviceInfo`, `GetStatus`, `GetConfig`, `ListMethods`, `Reboot` |
| `Sys` | `GetStatus`, `GetConfig`, `SetConfig` for `debug.websocket.enable` |
| `Switch` | `GetStatus`, `Set`, `Toggle` |
| `KVS` | `Set`, `Get`, `GetMany`, `List`, `Delete` |
| `Script` | `List`, `Create`, `Delete`, `GetConfig`, `SetConfig`, `PutCode`, `GetCode`, `Start`, `Stop`, `GetStatus`, `Eval` |

Scripts can use `Shelly.call` for the listed methods, including `Shelly.*`,
`Sys.*`, and `Script.*`. RPC names are case-insensitive; configured components
also expose `<Component>.GetStatus` and `<Component>.GetConfig`.
`Shelly.ListMethods` returns the current list. Unknown methods return code 404
with `No handler for <Method>`. The server allows ten stored scripts. Running
scripts share switch and KVS state; a callback crash stops only that script.
`Shelly.Reboot` waits 500 ms, disconnects log sockets, stops scripts, and restarts
those with `enable: true`. It does not close the server or clear shared state.
See [the RPC router](../../../src/emulator/rpc.ts) for dispatch and
[the script manager](../../../src/emulator/scripts.ts) for script behavior.

### Programmatic emulator

Import `startEmulator` from `shelly-forge/emulator` in Node-side code, not device
scripts. Unlike the CLI, the API defaults to port 0. Always close the server in
cleanup. This example starts a loopback listener, reads its identity, and closes:

```ts
import { startEmulator } from 'shelly-forge/emulator';

const emulator = await startEmulator({ switches: 1 });
try {
  const response = await fetch(`http://${emulator.host}/shelly`);
  if (!response.ok) throw new Error(`Device info failed: ${response.status}`);
  const deviceInfo = await response.json();
} finally {
  await emulator.close();
}
```

Options include `port`, `bind`, `password`, `deviceInfo`, `switches`, initial `kvs`
and `components`, `rpc`, `mdns`, `onLog`, and `onRpc`.
`components` uses the same key and entry shape as `--components`.
`rpc` maps method names to handler functions and overrides only script
`Shelly.call` calls, not HTTP RPC requests.
`onLog` receives every debug frame even when no
WebSocket is connected. The returned object has `host`, `setStatus(component,
delta)`, `emitEvent(component, info)`, `scripts()`, `reboot()`, and idempotent
`close()`. See [the exported types](../../../src/emulator/index.ts) for signatures
and logger and mDNS publisher hooks.

Use `emulator.ble.advertise(result)`, `emulator.mqtt.receive(topic, message)`, and
`emulator.mqtt.setConnected(connected)` to inject BLE advertisements, MQTT
messages, or connection changes into running scripts.
`emulator.mqtt.published` retains the last 1000 published messages with their
`scriptId`, `topic`, `message`, `qos`, and `retain` fields.
Call `emulator.advance(ms)` with a finite nonnegative integer to advance shared
device and script time through due callbacks and timers in chronological order
without waiting; real-time ticking continues afterward.
Each script has a limit of 1000 timer callbacks per engine advance and 1000 RPC
callbacks or zero-time iterations per simulated timestamp; exceeding either
limit crashes only that script.
The existing 1000 ms execution timeout applies to each script callback, not the
entire advance.

The same binding rules apply to the API. A non-loopback `bind` requires a
nonempty `password`, and `mdns: true` requires a non-loopback bind.

The emulator uses Node `vm`, which is not a security boundary. Only run code you
trust. Top-level code, each callback, and eval have a 1000 ms synchronous execution
limit. Exceeding it crashes the script; eval instead returns an error without
crashing the script. The emulator removes unsupported
built-ins and shares the simulator's device APIs, but memory, CPU, timing, and
engine quirks differ. Script memory and CPU fields are zero placeholders, not
measurements. It does not connect simulated MQTT, HTTP, or BLE APIs to real
services. Verify behavior on the target model and firmware before relying on it.
For the repository's emulator suite and opt-in hardware workflow, see
[CONTRIBUTING.md](../../../CONTRIBUTING.md). The hardware command is
`npm run test:device`; it requires `SHELLY_E2E_HOST` and accepts
`SHELLY_E2E_PASSWORD`.

## Exit codes

These mappings come from `src/core/errors.ts`. A command normally returns 0 on
success. `status` and `dev` may return data with a nonzero exit code instead of
throwing an error. A second SIGINT forces exit 130.

| Exit | Error codes |
| --- | --- |
| 1 | `NOT_IMPLEMENTED`, `INTERNAL` |
| 2 | `USAGE`, `CONFIG` |
| 3 | `BUILD`, `CHECK` |
| 4 | `DEVICE_UNREACHABLE`, `DEVICE_AUTH`, `DEVICE_RPC`, `DEPLOY` |
| 5 | `UNHEALTHY`; also missing or unhealthy rows returned by `status` |

Use the [debugging decision path](debugging.md#exit-code-next-steps) for recovery.

## JSON output

With `--json`, non-streaming commands write one JSON line to stdout. A successful
handler returns `{ "ok": true, "exitCode": 0, "command": "...", "summary": "...", "data": ... }`.
A thrown error returns `{ "ok": false, "exitCode": 2, "command": "...", "error": { "code": "...",
"message": "...", "hint": "...", "details": ... } }`. Optional fields such as
`hint`, `details`, and `data` disappear when undefined. Every result envelope has
`exitCode`, and `ok` is true if and only if that code is 0. The error example uses
2 for a usage failure; other errors use the table above. A `status` result can
contain `data` with `ok: false` and exit 4 or 5. Record the process exit code too.

`logs`, `dev`, and `emulate` write newline-delimited JSON events, then a final envelope. Parse
each line separately rather than treating all stdout as one JSON document.
Events have a `type`, not the result envelope's `ok` and `exitCode` fields.
Progress remains on stderr; it is not part of the JSON stream.

The examples below illustrate the shapes, not results from a live device.
Summaries and row counts are shortened. Paths, measurements, and hashes vary.

### Project creation

For `create lighting hallway`:

```json
{"ok":true,"exitCode":0,"command":"create","summary":"Created script \"lighting/hallway\".","data":{"id":"lighting/hallway","src":"src/lighting/hallway.ts","test":"src/lighting/hallway.test.ts","device":"${DEVICE_HOSTNAME}","enableOnBoot":true,"nextSteps":["npm run build -- lighting/hallway","npm test","npm run dev -- lighting/hallway"]}}
```

`init` instead returns `data` with `name`, `projectDir`, `nextSteps`, and optional
`skills` containing `installed` and `skipped` arrays.

### Build and check

```json
{"ok":true,"exitCode":0,"command":"check","summary":"Checked 1 script.","data":{"scripts":[{"id":"lighting/hallway","artifactPath":"/project/dist/lighting-hallway.js","sizeBytes":72,"sha256":"<sha256>","findings":[]}],"findings":[],"totals":{"scripts":1,"sizeBytes":72,"errors":0,"warnings":0}}}
```

`build` has the same shape and also returns `data.manifestPath` after writing.

### Deployment

```json
{"ok":true,"exitCode":0,"command":"deploy","summary":"Deployed 1 script(s), skipped 0.","data":{"scripts":[{"id":"lighting/hallway","host":"192.168.1.100","targetScriptName":"hallway","action":"updated","sizeBytes":72,"status":"running","scriptId":1}],"dryRun":false}}
```

On failure, `error.details.scripts` retains completed rows and the failed row.
`error.details.failure` contains failure-specific details, including rollback
fields for verification failures.

### Status

This response has `exitCode: 5` and `ok: false`, with the status data preserved:

```json
{"ok":false,"exitCode":5,"command":"status","summary":"Script\tHost\tTarget\tRunning\tEnable\tMemory used/peak/free\tCPU\tErrors\nlighting/hallway\t192.168.1.100\thallway\t-\t-\t-/-/-\t-\tmissing","data":{"scripts":[{"script":"lighting/hallway","host":"192.168.1.100","targetScriptName":"hallway","missing":true}]}}
```

Healthy rows include `id`, `running`, and `enable`, plus any firmware-provided
`errors`, `error_msg`, `mem_used`, `mem_peak`, `mem_free`, and `cpu`. Request failures
have a row-level `error` with `code`, `message`, and optional `hint`.

### Logs

```jsonl
{"type":"log","device":"192.168.1.100","message":"Counter 8"}
{"ok":true,"exitCode":0,"command":"logs","summary":"Received 1 log lines from 1 devices.\n[192.168.1.100] 1 lines","data":{"devices":[{"device":"192.168.1.100","lines":1}],"lines":1,"emitted":1}}
```

A log event can also contain `ts` and `level` if the device supplied them.

### Interactive development

```jsonl
{"type":"dev-cycle","cycle":1,"script":"lighting/hallway","status":"deployed","durationMs":3650}
{"ok":true,"exitCode":0,"command":"dev","summary":"Stopped dev after 1 cycles, 1 deploys, and 0 failures.","data":{"cycles":1,"deploys":1,"failures":0}}
```

Cycle status can be `deployed`, `unchanged`, `failed`, `interrupted`, or
`superseded`. A failed cycle has `error`. Other errors use a `dev-error` event with
`source` and `error`; logs use the normal log event. This is an interactive-only
workflow recommendation, not a CLI-enforced TTY requirement.

### RPC and evaluation

Both return the device result directly in `data`, not under a `result` field:

```json
{"ok":true,"exitCode":0,"command":"rpc","summary":"{\n  \"output\": false\n}","data":{"output":false}}
```

```json
{"ok":true,"exitCode":0,"command":"eval","summary":"42","data":42}
```

### Debug configuration

```json
{"ok":true,"exitCode":0,"command":"debug","summary":"192.168.1.100: debug off, changed","data":{"devices":[{"host":"192.168.1.100","enabled":false,"changed":true,"restartRequired":false}]}}
```

### Discovery

```json
{"ok":true,"exitCode":0,"command":"discover","summary":"No Shelly devices found.","data":[]}
```

Discovered rows contain `name`, `host`, `reachable`, and `authRequired`, with
optional `model`, `gen`, `app`, `ver`, `fw_id`, `mac`, and `auth_en`.

### Skill installation

```json
{"ok":true,"exitCode":0,"command":"skills","summary":"Installed 1 skill: shelly-forge.","data":{"installed":["shelly-forge"],"skipped":[]}}
```

`skills list` instead returns an array with `name`, `bundledVersion`, optional
`installedVersion`, and `managed`. Skipped install entries have `name` and `reason`.

### Error envelope

For an invalid RPC parameter string, the exit code is 2:

```json
{"ok":false,"exitCode":2,"command":"rpc","error":{"code":"USAGE","message":"RPC parameters must be valid JSON"}}
```

