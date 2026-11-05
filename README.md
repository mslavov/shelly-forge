# Shelly Forge

[![npm version](https://badge.fury.io/js/shelly-forge.svg)](https://badge.fury.io/js/shelly-forge)

Shelly Forge is a TypeScript CLI for building, testing, and deploying scripts to Shelly devices with scripting support. It checks device code, provides a local runtime simulator and device emulator, and verifies scripts after deployment.

## Install and start a project

Use Node.js 22.12 or newer. Run through `npx`, or install the CLI with `npm install --global shelly-forge`.

```sh
npx shelly-forge init my-home
cd my-home
npm install
cp .env.example .env
```

Set `DEVICE_HOSTNAME` in `.env` to the intended device's hostname or IP address. Set `SHELLY_PASSWORD` if the device requires authentication. Keep `SHELLY_PUBLIC_GREETING` defined for the starter scripts.

```sh
npx shelly-forge create lighting hallway
npm test
npm run typecheck
npx shelly-forge check lighting/hallway --strict
npx shelly-forge deploy lighting/hallway
npx shelly-forge status lighting/hallway
npx shelly-forge logs lighting/hallway --duration 10 --lines 100
```

`create` adds a source file, a simulator test, and a configuration entry. The project also contains `example/hello`. Both starter scripts increment a KVS counter once per minute. Replace that logic with your automation before deploying it.

Use an explicit selector to avoid deploying every configured script. Deployment stops and replaces the selected on-device script, starts it, and checks its status throughout a 3000 ms window. At least one healthy poll must complete within the window. Every returned status must report running without errors, even if it arrives late. After a healthy poll, a later request cut off by the deadline or a late healthy response does not fail verification. A failed health check attempts to restore a different last-good artifact when one exists. The original deployment still fails after a successful rollback.

A cache skip requires a matching artifact hash, script ID, boot setting, and a running script. It does not repeat health verification or read back the device code. Inspect `status` afterward, or use `deploy --force` after out-of-band edits.

For interactive development:

```sh
npx shelly-forge dev lighting/hallway
```

`dev` watches source and configuration changes, rebuilds, deploys, and streams logs until Ctrl+C. Use bounded `logs` instead in unattended sessions. Logs include every script on the selected device and enable device debug logging by default. They leave debug enabled after exit; use `shelly-forge debug off lighting/hallway` to disable it when no longer needed.

Both `deploy` and `dev` accept `--verify-timeout <ms>` to change the health window. The value must be an integer from 1 to 4294967295. Invalid values return `USAGE`, exit 2, before building or starting a watcher. The first Ctrl+C during stop, upload, configuration, or start waits for that sequence to finish before cancelling verification. This prevents cancellation alone from leaving the script stopped. An upload failure can still leave partial code; a second Ctrl+C forces exit 130 and can interrupt any step.

## Configuration

`solutions.config.json` groups scripts by solution. Each entry selects a source file and target device:

```json
{
  "$schema": "./node_modules/shelly-forge/schema/solutions.config.schema.json",
  "lighting": {
    "hallway": {
      "src": "src/lighting/hallway.ts",
      "device": "${DEVICE_HOSTNAME}",
      "targetScriptName": "hallway",
      "enableOnBoot": true,
      "password": "${HALLWAY_PASSWORD}"
    }
  }
}
```

- `src` is relative to the project directory and must stay inside it.
- `device` accepts a hostname or IP address with an optional port, not a URL.
- `targetScriptName` defaults to the script name. Two entries cannot target the same name on the same device.
- `enableOnBoot` defaults to `true`. Deployment starts the script even when this is `false`.
- `password` is optional. It overrides `SHELLY_PASSWORD`; without either, the CLI sends no password. Authentication uses the device's `admin` user and SHA-256 digest authentication.

`${VAR}` references in `device` and `password` must resolve to nonempty values. The example above requires `HALLWAY_PASSWORD`; omit the `password` field to use `SHELLY_PASSWORD` instead. The CLI reads the project-root `.env`, and existing process environment values take precedence. Never commit `.env` or put credentials in device URLs.

`deploy` and `dev` resolve selected entries strictly. An unset reference in an unselected entry does not block either command, but other resolvable entries still participate in duplicate-target checks.

Builds and checks do not resolve device references, so they do not need device hostnames or passwords. Only direct `process.env.SHELLY_PUBLIC_*` accesses use build-time inlining. These values enter the generated JavaScript and must never contain secrets. An unresolved public value fails the default artifact checks even if the source has a fallback. Set it to an empty string when you intend to use the fallback.

Build output goes to `dist/<solution>-<script>.js` and `dist/manifest.json`. Deployment metadata, last-good scripts, and diagnostic logs live under `.shelly-forge/`. Keep that directory out of version control, but retain it locally for rollback.

## Build and deployment checks

The bundler keeps syntax at `esnext` until TypeScript lowers it to ES5. This uses TypeScript's feature-detecting helpers instead of esbuild helpers that require newer device built-ins. A final esbuild pass emits raw UTF-8, including with `--no-minify`.

Artifact findings use the unminified ES5 bundle's line and column and include a code excerpt. For minified builds and `check`, text locations include `(unminified)` and JSON findings include `bundle: "unminified"`. `build --no-minify` writes the file that matches those locations. Size checks use the shipped code. The `use-before-declaration` error rejects a function reference evaluated before its declaration in the same execution scope. `class X extends Y` fails with a `class-inheritance` error because TypeScript's ES5 output relies on function hoisting. Use composition or plain objects instead. Other inheritance findings remain warnings. The `unicode-escape` error rejects `\u` escapes in string literals. The unsupported-array-method warning checks callback-taking methods such as `map` and `forEach`; it skips known built-in receivers and declared object methods. Device types reject unsupported methods that this heuristic does not cover.

A selected build reports type errors in its entries and imported inputs, plus global and configuration errors. Unrelated script errors do not block it. Imports may come from outside the project directory, including shared helpers and workspace dependencies. Selected builds merge manifest entries by `deployId`, preserve other configured scripts, and remove entries deleted from the configuration. Manifest schema 1 records input paths and SHA-256 hashes plus `publicEnvSha256`, a hash of sorted public name/value pairs rather than their values. Input paths may contain `../` for external imports; entry source and artifact paths must stay inside the project. The build validates the merged manifest before writing any artifacts. `deploy --no-build` rejects changes to the artifact, entry source, imported inputs, or public environment. Older manifests without the added hashes require a rebuild.

Uploads use replace mode for the first chunk and append for later chunks. An ambiguous `DEVICE_UNREACHABLE` chunk failure restarts the whole upload at most twice. An explicit RPC rejection does not trigger that restart. The final `Script.PutCode` response's `len` checks the stored UTF-8 byte length. If `len` is absent, the CLI falls back to `Script.GetCode` and handles a partial multibyte character in its one-byte sample. The deploy command reuses an RPC client only for the same normalized host and password; HTTP 429 responses wait 2000 ms before retrying, at most twice. Malformed responses include their HTTP status, and HTTP 404 suggests checking for a Gen2+ device. Log streams warn on the first failure in each connection outage per device and log repeated failures only with `--verbose`. A successful connection resets warning suppression.

## Commands

See the [CLI reference](skills/shelly-forge/reference/cli.md) for options, selectors, JSON output, and exit codes. Global options include `--cwd`, `--json`, `--verbose`, and `--quiet`. Every JSON result envelope includes `exitCode`, and `ok` is true only when it is 0. A failed `status` can still return result data. No arguments prints help to stderr and exits 1; explicit `--help` prints to stdout and exits 0.

| Command | Purpose |
| --- | --- |
| `init [name]` | Create a project and install the bundled agent skills. |
| `create <solution> <script>` | Add a source file, test, and configuration entry. |
| `build [selector]` | Type-check, bundle to ES5, check artifacts, and write output. |
| `check [selector]` | Run the build checks without writing build artifacts. |
| `deploy [selector]` | Build, upload, start, and verify scripts. |
| `dev <selector>` | Watch, rebuild, deploy, and stream logs. |
| `status [selector]` | Read on-device script status and reported errors. |
| `logs [selector]` | Stream logs from the selected devices. |
| `debug <on\|off> [selector]` | Enable or disable device WebSocket debug logging. |
| `rpc <method> [params]` | Call a device RPC method with optional JSON parameters. |
| `eval <selector> <code>` | Evaluate code in a running on-device script. |
| `discover` | Find devices through mDNS and read their identity. |
| `skills <action> [names...]` | Install or list bundled agent skills. |
| `emulate` | Run a local device server for development and CLI tests. |

Selectors accept `solution/script`, `solution-script`, a unique script name, or a unique `targetScriptName`. Omitting an optional selector selects all entries. A solution name alone does not select a group.

## Test without a device

Import `shelly-forge/testing` in Node-side tests, not device scripts. The generated project separates device and test TypeScript configurations and includes Vitest tests. Both configurations use `moduleDetection: "force"`, so scripts can reuse top-level names without an empty export. For example, a test beside the template's `hello.ts` can advance its timer without waiting a minute:

```ts
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createShellyRuntime } from 'shelly-forge/testing';

test('the starter saves its first counter value', async () => {
  const runtime = createShellyRuntime();
  const script = fileURLToPath(new URL('./hello.ts', import.meta.url));
  await runtime.loadScript(script, { env: { SHELLY_PUBLIC_GREETING: '' } });
  runtime.advance(60000);
  expect(runtime.kvs.get('example.hello.count')).toBe('1');
});
```

The first uncaught script error throws `ShellyScriptError` and sets `runtime.crashed`. It clears scheduled work, handlers, subscriptions, and HTTP endpoints. Later `advance()` and `flush()` do nothing; calls, logs, saved KVS values, and published messages remain inspectable. Create a new runtime to restart the script. Invalid host inputs such as circular references or `BigInt` passed to `setStatus` or `emitEvent` throw `TypeError` without crashing the runtime, changing state, or clearing queued work.

Strict mode removes undeclared modern built-ins, including modern String methods, `Object.assign`, `Object.entries`, `Array.from`, and `Number.isInteger`. TypeScript helpers that detect missing built-ins still work. `String.prototype.at` returns a numeric character code or `undefined` outside the string, even with `strictBuiltins: false`. The simulator otherwise uses Node string semantics, not the device's UTF-8 byte indexing.

See the [testing reference](skills/shelly-forge/reference/testing.md) for events, MQTT, KVS, HTTP, and RPC failure injection. The simulator does not model every firmware API or device resource. Passing tests does not replace on-device verification.

## Develop against a local emulator

Run `npx shelly-forge emulate` to start a device server without hardware. Set
`DEVICE_HOSTNAME=127.0.0.1:8080` in your project's `.env`, then use the normal
`deploy`, `status`, `logs`, `rpc`, `eval`, or interactive `dev` commands. Ctrl+C
stops the server. Its state is in memory and does not survive shutdown.

Set `SHELLY_EMULATOR_PASSWORD` for the server and the same value as
`SHELLY_PASSWORD` for the client when testing authentication. Keep the default
loopback binding. A non-loopback bind requires a nonempty server password or
exits 2. `--mdns` requires a non-loopback bind, such as `--bind 0.0.0.0`, and a
password. The server rejects requests with an `Origin` header and rejects
non-local `Host` headers on loopback. See the [emulator reference](skills/shelly-forge/reference/cli.md#emulate)
for options, supported RPC methods, log frames, and the `shelly-forge/emulator`
programmatic API.

Use `--components <file>` to load a JSON object of component keys and optional
`status` and `config` objects, or pass `components` to `startEmulator`.
RPC names are case-insensitive, and the programmatic API can inject BLE
advertisements and MQTT messages or connection changes for running scripts.
Call `emulator.advance(ms)` with a finite nonnegative integer to advance shared
device and script time through due callbacks and timers without waiting; real-time
ticking continues afterward.
Each script has a limit of 1000 timer callbacks per engine advance and 1000 RPC
callbacks or zero-time iterations per simulated timestamp; exceeding either
limit crashes only that script.
The existing 1000 ms execution timeout applies to each script callback, not the
entire advance.

Scripts run in Node `vm`, which is not a security boundary. Only run code you
trust. Top-level code, each callback, and eval have a 1000 ms synchronous execution
limit. Exceeding it crashes the script, except eval returns an error. Scripts can
use `Shelly.call` for the emulator's `Shelly.*`, `Sys.*`, and `Script.*` methods;
unknown methods return 404 `No handler for <Method>`. Memory, CPU, timing, and
engine quirks differ from hardware. Verify on hardware too.
The emulator also runs end-to-end CLI tests in CI. See
[CONTRIBUTING.md](CONTRIBUTING.md) for that suite and the opt-in
`npm run test:device` workflow with `SHELLY_E2E_HOST` and optional
`SHELLY_E2E_PASSWORD`.

## Agent support

`init` installs two skills by default. Use `shelly-forge init my-home --no-skills` to skip them, or install them later:

```sh
npx shelly-forge skills install
npx shelly-forge skills list
```

- [shelly-forge](skills/shelly-forge/SKILL.md) covers the CLI workflow, tests, deployment, and debugging.
- [shelly-scripting](skills/shelly-scripting/SKILL.md) covers device language constraints, APIs, and automation patterns.

Installation writes `.agents/skills/<name>/` with a `.shelly-forge-version` marker and creates `.claude/skills/<name>` as a relative symlink. It copies the skill there if symlinks are unavailable. Existing unmarked skill directories are user-owned and remain untouched unless you pass `shelly-forge skills install --force`.

The project template also includes `AGENTS.md` and a `CLAUDE.md` that references it. See the [project design](docs/design.html) for the implementation structure.

## Upgrade from 0.3

- Use the new device and test TypeScript configurations. The device library now rejects unsupported APIs.
- Change script creation to `shelly-forge create <solution> <script>`. Pass the device through `--device`.
- Replace old external log/watch scripts with the CLI's `logs` and `dev` commands.
- Remove old MCP configuration and run `shelly-forge skills install` for agent support.
- Remove the unused `build-cache/` directory. Keep `.shelly-forge/` for deployment history and rollback.

See [migration details](CHANGELOG.md#migrating-from-03) before upgrading an existing project.

## Contribute and report issues

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests, and release instructions. Report bugs through [GitHub Issues](https://github.com/mslavov/shelly-forge/issues).

## License

[MIT](LICENSE).
