---
name: shelly-scripting
description: >
  Write and review TypeScript scripts that run on Shelly Gen2+ devices with scripting
  support. Use for Shelly.call, Timer, MQTT, KVS, BLE/BTHome, HTTPServer, device state,
  callback sequencing, runtime limits, or unsupported JavaScript in a shelly-forge
  project. Covers crash prevention, byte strings, persistent state, build-time
  SHELLY_PUBLIC_ values, and the device typings. Use the shelly-forge skill for CLI
  workflow, simulator tests, deployment, and debugging.
---

# Shelly device scripting

Write device code in TypeScript under `src/<solution>/`. Each configured entry becomes
one ES5 script on a device. The interpreter is not Node or a browser. Support varies
by model and firmware. Check that the target supports scripting and the APIs you use.

## Rules that prevent crashes

1. Keep callbacks shallow. The official language reference warns that more than two
   or three levels of nested anonymous functions can crash the device. Define named
   callbacks before use and register them at startup.
2. Never block. Scripts share the firmware's main task. Use `Timer.set` and callbacks
   instead of busy waits or long loops.
3. Track resource use. Each script has at most 5 timers, 5 event handlers, 5 status
   handlers, 5 in-flight RPC calls, 10 MQTT subscriptions, and 5 HTTP endpoints.
   Register once, release unused handles, and sequence RPC calls.
4. Keep durable state in KVS or `Script.storage`. Module variables reset when the
   script restarts. Validate stored values before using them.
5. Keep the final artifact at or below `SCRIPT_MAX_BYTES`, 65535 UTF-8 bytes.
   `Script.PutCode` rejects 65536 bytes or more. Forge reports `size-limit` above
   the limit and `size-budget` above 80% of it.

## Use the device types and checks

The generated device tsconfig loads `node_modules/shelly-forge/types/lib.shelly.d.ts`
and `node_modules/shelly-forge/types/shelly.d.ts` with `noLib: true` and `types: []`.
The replacement library rejects missing globals and unsupported array methods.
Keep `moduleDetection: "force"` in both device and test configurations so files
without imports or exports stay separate modules. Do not add Node or DOM types
to device code to silence errors.

Forge bundles with esbuild's `esnext` target and uses TypeScript for ES5 lowering.
Its `__assign` and `__rest` helpers feature-detect missing built-ins and use
fallbacks. The final pass normalizes UTF-8 even with `--no-minify`. AST checks use
the unminified ES5 bundle and include code excerpts; size checks use the shipped
artifact. For minified builds and `check`, text locations include `(unminified)`
and JSON findings include `bundle: "unminified"`. `build --no-minify` writes the
matching file. Fix errors and investigate warnings. `--strict` makes warnings fail
the check. Passing these checks does not prove device compatibility.

- Use indexed loops instead of `map`, `forEach`, `filter`, `reduce`, and the other
  array methods excluded by forge's conservative runtime profile.
- Do not use Promises, `async`/`await`, `fetch`, Node timers, dynamic code, or runtime
  imports. Use `Shelly.call` and `Timer` instead. Local TypeScript imports are bundled,
  including imports outside the project directory.
- Declare values and functions before executing code that uses them. The device
  does not support hoisting or ES6 classes. Prefer functions and plain objects over
  classes, even when TypeScript could lower the syntax. `use-before-declaration`
  rejects same-scope function references evaluated before their declaration.
  `class X extends Y` fails with a `class-inheritance` error because TypeScript's
  ES5 output relies on function hoisting. Use composition or plain objects instead.
  Other inheritance findings remain warnings.
- UTF-8 text is allowed. Strings are byte arrays on the device, so `.length` and
  `.at(i)` count and read bytes. Forge emits a `non-ascii` warning for non-ASCII
  literals. Use `\xHH` for binary data, not Unicode escapes. `unicode-escape`
  rejects Unicode escapes left in string literals.
- Only direct `process.env.SHELLY_PUBLIC_*` values set at build time are inlined.
  They are public in the artifact. Never use them for secrets.

See [constraints](reference/constraints.md) for the full rule list, limits, and
tsconfig. See [runtime APIs](reference/runtime-api.md) for typed callback examples.

## Reuse the device patterns

[Patterns](reference/patterns.md) covers sequential callbacks, a typed KVS store,
timer-driven state with stale-data handling, MQTT input validation, BLE/BTHome
packet de-duplication, remote HTTP RPC, compact state, and public build values.
Adapt the examples to the target firmware and define a safe response to missing
or stale data before controlling an output.

## Workflow

Use `shelly-forge create <solution> <script>` to add an entry. Implement it against
the device typings, run `shelly-forge check <selector>`, then build and deploy it.
`check` writes no artifacts. `build` writes `dist/<solution>-<script>.js` and a manifest.

Use the [shelly-forge skill](../shelly-forge/SKILL.md) for the full CLI workflow,
tests with `shelly-forge/testing`, deployment verification, and debugging. Do not
treat a simulator pass as a replacement for checking the target firmware.

## Sources

- [Official language reference](https://shelly-api-docs.shelly.cloud/gen2/Scripts/LanguageReference/)
- [Official script APIs](https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Shelly/)
- Installed `types/shelly.d.ts` for API names and signatures.
