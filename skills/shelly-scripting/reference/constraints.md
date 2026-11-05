# Runtime constraints

Use the [official language reference](https://shelly-api-docs.shelly.cloud/gen2/Scripts/LanguageReference/)
for runtime behavior. It lists hoisting, ES6 classes, Promises, and async functions
as unsupported. It refers to Espruino for method support, but Shelly does not expose
Espruino's hardware and system APIs. Do not assume an ES5 or Espruino method exists
just because TypeScript or a desktop JavaScript engine accepts it.

## Build and type checking

Forge bundles local modules as an IIFE with esbuild's `esnext` target, including
imports outside the project directory, then lowers the bundle to ES5 with
TypeScript. TypeScript's `__assign` and `__rest` helpers
feature-detect missing built-ins and use fallbacks. Esbuild then normalizes UTF-8
and optionally minifies. `--no-minify` still normalizes synthesized strings to
UTF-8 rather than leaving TypeScript's Unicode escapes.

With a selector, type checking reports errors in the selected entries and their
imported inputs, plus diagnostics without a file. A full build checks the whole
project. AST checks use the unminified ES5 bundle before artifacts are written;
size checks use the shipped code. Syntax conversion does not add runtime APIs.

Use the generated device `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es5",
    "moduleDetection": "force",
    "noLib": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": []
  },
  "include": [
    "src/**/*.ts",
    "node_modules/shelly-forge/types/lib.shelly.d.ts",
    "node_modules/shelly-forge/types/shelly.d.ts"
  ],
  "exclude": ["src/**/*.test.ts"]
}
```

The two declarations have different jobs. `lib.shelly.d.ts` replaces the default
JavaScript library. `shelly.d.ts` declares device APIs such as `Shelly`, `Timer`,
and `BLE`. Keep Node test types in a separate test tsconfig. Set
`moduleDetection: "force"` in both configurations so each source file has its own
module scope without an `export {}` marker. See the
[CLI skill](../../shelly-forge/SKILL.md) for test setup and
[manifest fields](../../shelly-forge/reference/cli.md#build-manifest) for input and
public-environment hashes used by `deploy --no-build`.

Arrow functions, `const`, `let`, template literals, and destructuring can be lowered
to ES5. Avoid classes, inheritance, and iterator-dependent syntax in device code.
Declare functions before the calls or registrations that use them. Moving syntax
through a compiler does not establish compatibility with every firmware version.

## Array methods and globals

Forge's conservative default excludes these array methods from the device library:

`map`, `forEach`, `filter`, `reduce`, `reduceRight`, `some`, `every`, `find`,
`findIndex`, `flat`, `flatMap`, `includes`, `fill`, `copyWithin`, `entries`, `keys`,
and `values`.

This is forge's portability rule, not a claim that the official language reference
lists every method as absent on all firmware. Use an indexed loop with operations
such as `push`, `pop`, `slice`, and `indexOf` instead. The artifact heuristic checks
only callback-taking `map`, `forEach`, `filter`, `reduce`, `reduceRight`, `some`,
`every`, `find`, `findIndex`, and `flatMap` calls whose first argument is a function
expression or identifier. It skips free `Object`, `JSON`, `Math`, `String`,
`Number`, and `Array` receivers, and methods declared on known objects.
`Object.keys` is valid. Other excluded array methods rely on type checking.

Promises, `async`/`await`, `fetch`, `XMLHttpRequest`, Node timers, `require`, and
Node or browser APIs do not belong in device scripts. `process` exists only as a
type for build-time public values. There is no on-device environment lookup.
Use `Shelly.call("HTTP.GET", ...)` or `HTTP.POST` for outgoing HTTP, and `Timer.set`
for scheduled work. Do not use `eval` or construct functions from strings.

The replacement library also omits modern built-ins such as
`String.prototype.startsWith`, `endsWith`, `includes`, and `padStart`;
`Object.assign`, `Object.entries`, and `Object.values`; `Array.from` and `Array.of`;
`Number.isInteger`, `Number.isNaN`, and `Number.isFinite`; and `Math.trunc`. Use
the declared operations, such as `indexOf`, indexed loops, global `isFinite`,
and `Math.floor`.
Feature detection inside TypeScript's generated helpers does not make direct
calls to those missing APIs safe. The simulator's default `strictBuiltins` mode
removes undeclared modern built-ins too. See the
[testing reference](../../shelly-forge/reference/testing.md).

## Artifact findings

`build` and `check` run these rules by default. `--strict` turns warnings into errors.
Do not suppress a rule by adding broader types or disabling checks.

| Rule | Default severity | Meaning |
| --- | --- | --- |
| `size-limit` | Error | Final UTF-8 artifact exceeds 65535 bytes. |
| `size-budget` | Warning | Final artifact exceeds 80% of 65535 bytes. |
| `unresolved-env` | Error | A `process.env` access remains after bundling. Only set `SHELLY_PUBLIC_*` values are inlined. |
| `unsupported-global` | Error or warning | Free reference to an excluded global. `Symbol`, `Proxy`, `Reflect`, `WeakMap`, and `WeakSet` warn; the other excluded globals fail. |
| `async-function` | Error | The artifact contains `__awaiter` or `__generator` helpers. |
| `dynamic-code` | Error | Free `eval` or dynamic `Function` use remains. |
| `use-before-declaration` | Error | A function reference executes in the same scope before its declaration. References inside nested function bodies are deferred and do not trigger this rule. |
| `unicode-escape` | Error | A string literal contains a Unicode escape rather than UTF-8 text or a byte escape. |
| `unsupported-array-method` | Warning | A callback-taking call matches the heuristic described above. |
| `class-inheritance` | Error or warning | `class X extends Y` fails because TypeScript's ES5 output relies on function hoisting. Use composition or plain objects. Other `__extends` and `Object.setPrototypeOf` findings remain warnings. |
| `callback-nesting` | Warning | A function passed as a callback is nested deeper than two callback levels, excluding the top-level IIFE. |
| `non-ascii` | Warning | A string literal contains non-ASCII text. Device string operations count UTF-8 bytes. |

Type diagnostics use `typescript`. A missing tsconfig produces `missing-tsconfig`;
do not ignore it. A bundling failure uses `bundle`. Each artifact finding includes
a short code excerpt. AST locations refer to the unminified ES5 bundle, which
matches `build --no-minify` output, not the TypeScript source or minified artifact.
For minified builds and `check`, text locations include `(unminified)` and JSON
artifact findings include `bundle: "unminified"`. `build --no-minify` writes the
matching file and omits that marker. Size rules measure the shipped artifact.

## CPU and resource limits

Scripts execute on the firmware's main task. A long loop delays other work and may
crash the device. The firmware disables a script on the next boot if it detects that
the script crashed the device. Break large jobs into bounded timer-driven steps.
Do not retry an error in a tight loop.

| Resource | Maximum per script |
| --- | --- |
| Active timers | 5 |
| Event handlers | 5 |
| Status handlers | 5 |
| In-flight `Shelly.call` requests | 5 |
| MQTT subscriptions | 10 |
| HTTP endpoints | 5 |

Register handlers and subscriptions once at startup. Reuse repeating timers and
clear handles that are no longer needed. One-shot timers can be created later,
but they still count while active. Chain dependent RPC requests through named
callbacks, and prevent a new periodic request while the previous one is pending.

## Persistent state

[KVS](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/KVS/) is a
device-wide persistent store. It accepts JSON values through `Shelly.call`.

| KVS limit | Maximum |
| --- | --- |
| Key length | 42 |
| Value length | 253 |
| Keys stored on the device | 50 |

Keep keys and serialized values short. Use ASCII keys, leave room below the value
limit, and avoid inferring that 253 arbitrary Unicode characters will fit.
Use the `etag` returned by `Get` for conditional `Set` or `Delete` when writers may
race. Namespace keys because other scripts and RPC clients share the same store.
Compact repeated booleans into a bitmask or split larger data across keys.

[`Script.storage`](https://shelly-api-docs.shelly.cloud/gen2/Scripts/APIs/Shelly/#scriptstorage)
is a separate persistent per-script store, available since firmware 1.5.0. It takes
strings only. The documented limits are 16-byte keys, 1024-byte values, and 12 items.
Deleting the script or factory-resetting the device clears it. Prefer KVS when other
scripts or RPC clients need to read the state. Module variables are not persistent.

## Byte strings and time

UTF-8 text works, but strings store bytes rather than UTF-16 code units. `.length`
counts bytes and `.at(index)` returns a byte as a number. Byte slicing can split a
multi-byte character. Use ASCII protocol tokens and `\xHH` escapes for binary data.
The device does not support Unicode escape sequences. `btoa` and `atob` convert
binary strings to and from base64; they do not add Unicode string semantics.

Use `Shelly.getUptimeMs()` for elapsed time when the target firmware supports it.
It measures device uptime. `Date.now()` follows wall-clock time and may change after
clock synchronization, so account for clock changes if it is your fallback.
