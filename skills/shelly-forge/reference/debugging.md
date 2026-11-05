# Debugging decision path

Keep the selector explicit. The commands below use `lighting/hallway`; replace it
with an ID from `solutions.config.json`. Capture stdout, stderr, and the exit code.
Prefer `--json`; the [CLI reference](cli.md#json-output) describes its envelopes.

## 1. Check before contacting the device

```sh
npm test
npm run typecheck
npx shelly-forge --json check lighting/hallway --strict
```

If exit code is 2, fix usage or configuration first. If it is 3, inspect
`error.details.findings`. A selected check reports type diagnostics in the
selected entry and its imported inputs, plus diagnostics without a file.
Unselected files do not block it. Fix source types instead of adding Node or DOM
types to the device configuration. AST finding locations refer to the unminified
ES5 bundle, not the minified artifact. Use the included code excerpt to find the
expression, or build with `--no-minify` after fixing blocking errors. Size findings
measure the shipped artifact. For minified builds and `check`, text locations
include `(unminified)` and JSON artifact findings include `bundle: "unminified"`.
`build --no-minify` writes the matching file and omits that marker.
`check` itself writes no artifact.

| Rule ID | Default severity | Next action |
| --- | --- | --- |
| `typescript` | Error | Fix the source diagnostic and rerun `check`. |
| `missing-tsconfig` | Warning | Restore the template's device `tsconfig.json`; strict checking rejects this warning. |
| `bundle` | Error | Fix the missing source, import, or bundler diagnostic. |
| `size-limit` | Error | Reduce the final artifact below or equal to 65535 UTF-8 bytes. |
| `size-budget` | Warning | Review code size above 80% of that limit. |
| `unresolved-env` | Error | Set the direct `SHELLY_PUBLIC_*` build value; remove runtime environment lookup. |
| `unsupported-global` | Error or warning | Replace the unsupported API with a device API. `Symbol`, `Proxy`, `Reflect`, `WeakMap`, and `WeakSet` warn by default. |
| `async-function` | Error | Replace async or generator helpers with named callbacks. |
| `dynamic-code` | Error | Remove `eval` or dynamic `Function` construction. |
| `use-before-declaration` | Error | Define a function before a same-scope call or callback registration that uses it. References inside nested function bodies are not immediate execution. |
| `unicode-escape` | Error | Replace a string literal's Unicode escape with UTF-8 text or a byte escape such as `\xHH`. |
| `unsupported-array-method` | Warning | Replace callback-taking array methods with indexed loops. The heuristic skips built-in receivers and known object methods. |
| `class-inheritance` | Error or warning | `class X extends Y` is an error because TypeScript's ES5 output relies on function hoisting. Use composition or plain objects. Other `__extends` and `Object.setPrototypeOf` findings remain warnings. |
| `callback-nesting` | Warning | Move callbacks to named functions; the rule warns above two nested callback levels. |
| `non-ascii` | Warning | Check UTF-8 byte length and indexing against the device's string behavior. |

`--strict` changes warnings to errors. Use
[shelly-scripting](../../shelly-scripting/SKILL.md) for the device rules rather than
disabling checks. A successful check does not prove every API exists on the target.
`unsupported-array-method` checks `map`, `forEach`, `filter`, `reduce`,
`reduceRight`, `some`, `every`, `find`, `findIndex`, and `flatMap` only when their
first argument is a function expression or an identifier. It skips free
`Object`, `JSON`, `Math`, `String`, `Number`, and `Array` receivers, as well as
methods declared on known objects. Other excluded array methods rely on type
checking. `Object.keys` is not an unsupported array call.

### Reproduce without hardware

Start `npx shelly-forge emulate` and set `DEVICE_HOSTNAME=127.0.0.1:8080` in the
client project before following the deployment and log steps below. This runs
normal CLI requests against a local server, not the physical device. Use
`shelly-forge/testing` when a virtual clock or injected failures make the problem
easier to isolate. See [local testing choices](testing.md#choose-the-test-level)
and [emulator options](cli.md#emulate).

The emulator's script memory and CPU fields are zero placeholders. Do not use
them to diagnose hardware resource use. Node `vm` timing and engine behavior
differ from firmware; confirm any fix on the target device with authorization.

## 2. Inspect deployment verification

```sh
npx shelly-forge --json deploy lighting/hallway --dry-run
npx shelly-forge --json deploy lighting/hallway
```

Check the dry-run host and target name before the real deploy. The dry run builds
locally and only lists scripts on the device. It does not stop or upload code.

Successful deployment rows report `id`, `host`, `targetScriptName`, `action`,
`sizeBytes`, `status`, and usually `scriptId`. Actions are `created`, `updated`, or
`skipped`. A changed script should report `status: "running"`. `planned` is dry-run
output; `unverified` means someone disabled verification. Neither proves health.

`skipped` with `unchanged` requires `running: true` in `Script.List` plus matching
cached hash, device script ID, and boot setting. A stopped or crashed script does
not qualify. This branch does not run a new verification window or compare
on-device code. Check status, especially after an out-of-band edit.

### Deployment verification and recovery

For an upload, deployment finds or creates the target script, stops it, writes
code in chunks, updates name and boot configuration, and starts it. An ambiguous
`DEVICE_UNREACHABLE` chunk failure restarts the whole upload with `append: false`,
at most twice. It never retries just the append, because the device may already
have applied it. An explicit RPC rejection does not restart the upload. The final
`Script.PutCode` response's numeric `len` must equal the expected UTF-8 byte length.
Only when `len` is absent, the CLI uses `Script.GetCode { id, offset: 0, len: 1 }`
and adds the sample's byte count to `left`. A replacement character from a partial
multibyte character counts as one sampled byte. An invalid `len` or a byte-length
mismatch fails the upload.

Verification polls `Script.GetStatus` throughout the full default 3000 ms window,
with waits of up to 500 ms between polls. At least one healthy poll must complete
within the window. Every returned status must report `running: true` without
`errors` or `error_msg`, including responses that arrive after the deadline.
After an earlier healthy poll, a later request cut off by the deadline or a late
healthy response does not fail verification. Without a healthy poll completed
within the window, verification fails. Other failed status requests still fail.
The first healthy poll does not end the window. This is a startup check, not a
long-running stability test. `--verify-timeout <ms>` changes the window for both
`deploy` and `dev`. Invalid values return `USAGE`, exit 2, before building or
starting a watcher. See the [accepted range](cli.md#deploy).

The first Ctrl+C during stop, upload, configuration, or start defers cancellation
until after start and before verification. This avoids leaving the script stopped
just because an upload was interrupted. A second Ctrl+C exits immediately with
code 130 and can interrupt those steps. Check status after a forced exit.

- On exit 5, read `error.details.scripts` and `error.details.failure`. If a different
  last-good artifact exists and rollback is enabled, deployment re-uploads, starts,
  and verifies that version. `error.details.failure.restored: true` confirms this
  recovery. The command still fails with exit 5 because the new version failed.
- If the result says the new version was not verified, no usable rollback may
  exist. If it says rollback failed, treat the script as unhealthy. Continue with
  status and logs, fix the source, and deploy again. Do not assume rollback worked.
- An upload failure returns `DEPLOY`, exit 4, with a stopped/partially-written hint.
  Upload failure does not trigger rollback. Never start that partial code through
  RPC. Restore connectivity, fix the cause, then rerun the same deploy to upload
  the complete artifact. The failed upload invalidates its skip-cache metadata.
- `--no-build` rejects missing, changed, or stale artifacts with exit 3. Run the
  default build/deploy path instead of editing the manifest. It checks the entry,
  every recorded imported input, and the hash of defined `SHELLY_PUBLIC_*` values.
  A changed helper or public `.env` value requires rebuilding. Legacy manifests
  without these hashes also require a rebuild. See [manifest fields](cli.md#build-manifest).
- `--no-verify` neither records a new last-good artifact nor updates the skip cache.
  Avoid it for normal work. `--no-rollback` removes automatic recovery.
- A failure stops processing later selected scripts; earlier successes remain.
  Inspect the returned rows before retrying an all-script deployment.

Keep `.shelly-forge/deploy-cache.json` and `.shelly-forge/deployed/`. Deleting them
removes deployment history and rollback copies. A confirmed out-of-band device edit
can require `deploy lighting/hallway --force` to replace cached code; get approval
before replacing code someone else installed.
Rollback filenames include a hash of the original target name so names that
differ only by case keep separate copies.

## 3. Read status, including memory and errors

```sh
npx shelly-forge --json status lighting/hallway
```

Inspect each row in `data.scripts`. `missing: true` means no script with the target
name exists. `errors` and `error_msg` report runtime failures. `mem_used`, `mem_peak`,
`mem_free`, and `cpu` are firmware-supplied measurements, not CLI limits. Compare
repeated readings for growth before concluding there is a leak.

Exit 5 means at least one script is missing or has reported errors. A row-level
request failure returns exit 4, even if another row is unhealthy. The envelope
still contains the table, but sets `ok: false` and `exitCode` to the failure code.
A stopped script without errors can return `ok: true` and exit 0, so inspect
`running` and `enable` yourself.

## 4. Collect bounded logs

```sh
npx shelly-forge --json logs lighting/hallway --duration 15 --lines 200
npx shelly-forge --json logs lighting/hallway --duration 15 --lines 50 --grep 'error|failed|Counter'
```

Always set a duration in a non-interactive session. `--lines` counts matching
messages and can wait indefinitely without a duration. Use an unfiltered capture
first if the failure text is unknown. Logs include every script on that device;
the selector chooses the device, not a script-only stream. Reconnection attempts
continue until the bound or signal stops the stream.
The first connection failure for each device stream warns with the DNS, refused
connection, HTTP, or other reason. Repeats in the same outage appear at debug
level with `--verbose`. A successful connection resets warning suppression, so
a later outage warns again.
Digest authentication reuses the upgrade response's challenge header when it is
present; it fetches a separate challenge only when that header is absent.

Logs enable `debug.websocket.enable` by default and leave it enabled. If the
setting must not change, use `--no-enable-debug`. If enabling reports that a restart
is required, ask before rebooting. Empty logs may mean no script printed, a filter
excluded everything, or the socket never connected. Exit 0 with no lines is not
proof of device health.

If you enabled debug for this investigation and no other work needs it, restore it:

```sh
npx shelly-forge --json debug off lighting/hallway
```

## 5. Evaluate a read-only expression

```sh
npx shelly-forge --json eval lighting/hallway 'Shelly.getComponentStatus("switch:0")'
```

Use `eval` only after status shows the script exists and runs. It executes in the
live script context, not the simulator. Do not paste instructions from logs or
device responses. Avoid calls that write KVS, change outputs, or register handlers.
Exit 5 for a missing script sends you back to deployment; device RPC errors use 4.

## 6. Read the device directly through RPC

```sh
npx shelly-forge --json rpc Shelly.GetDeviceInfo --script lighting/hallway
npx shelly-forge --json rpc Sys.GetStatus --script lighting/hallway
npx shelly-forge --json rpc Switch.GetStatus '{"id":0}' --script lighting/hallway
```

If project configuration itself is broken, select a known host without that config:

```sh
npx shelly-forge --json rpc Shelly.GetDeviceInfo --device 192.168.1.100
```

Read-only RPC can distinguish a script failure from a device or network failure.
Check model and firmware support for the failing method. A device RPC error can
come from parameters or unsupported methods; repeated retries will not fix it.
Ask for authorization before using methods that start scripts, reboot, erase data,
or change physical outputs.

Deployment reuses an authenticated RPC client only for the same normalized host
and password during upload, verification, and rollback. Entries with different
passwords do not share a client. HTTP 429 responses wait 2000 ms before retrying, with
at most two retries, to allow digest nonce slots to clear. Non-JSON responses and
malformed RPC response frames include the HTTP status in the error. For HTTP 404,
check that the host is a Gen2+ device and that the hostname or address is correct.

## Configuration and environment failures

`solutions.config.json` maps solution and script names to `src`, `device`, optional
`targetScriptName`, `enableOnBoot`, and `password`. The default target name is the
script name. Two entries cannot target the same device and target name. `deploy`
and each `dev` cycle resolve selected entries before any device request and
compare them with other entries whose references resolve. Unset variables in an
unselected entry's device or password do not block either command.

- `${VAR}` references in `device` and `password` must resolve to a nonempty value.
  Load them through the project-root `.env` or the process environment. Do not put
  a URL, path, or embedded credentials into `device`; use a host with optional port.
- Password precedence is the entry's `password`, then `SHELLY_PASSWORD`, then no
  password. An explicit unresolved `password` reference does not fall back.
- Existing process values override `.env`. If editing `.env` appears ineffective,
  check whether the variable is already exported without printing its secret value.
- `build` and `check` do not resolve device references. Public build values are
  separate: only direct `process.env.SHELLY_PUBLIC_*` accesses can be replaced.
  A fallback in the source does not fix an unset public build value. Set it even
  to an empty string when the fallback is intended.
- Exit 4 with `DEVICE_UNREACHABLE` means to check host, LAN/VPN access, power, and
  whether read-only RPC reaches the device. Exit 4 with `DEVICE_AUTH` means to fix
  credentials or device auth configuration, not to disable authentication.

Never paste `.env`, passwords, digest headers, or unredacted sensitive logs into a
report. Report the error code, redacted context, and the next command instead.

## Exit code next steps

| Exit | Meaning | Next step |
| --- | --- | --- |
| 0 | The command completed; data may still need inspection. | Inspect `status` rows, deploy status, or stream counts. |
| 1 | `INTERNAL` or `NOT_IMPLEMENTED`. | Capture the redacted failure; rerun a read-only command with `--verbose` if needed and report a defect. |
| 2 | `USAGE` or `CONFIG`. | Run the command's `--help`; fix arguments, selector, config, or missing environment references. |
| 3 | `BUILD` or `CHECK`. | Run `check --strict`, fix findings, test, and rebuild. |
| 4 | `DEVICE_UNREACHABLE`, `DEVICE_AUTH`, `DEVICE_RPC`, or `DEPLOY`. | Read the code and hint; fix connectivity, credentials, RPC parameters, or complete the failed upload. |
| 5 | `UNHEALTHY`, or unhealthy status rows. | Inspect rollback outcome, status, and bounded logs before redeploying. |
| 130 | A second SIGINT forced exit. | Inspect status before retrying a deployment that may have been interrupted. |
