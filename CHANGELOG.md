# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-11-03

### Added

- Add `check`, `status`, `rpc`, `eval`, `dev`, and `skills` commands.
- Add global `--cwd`, `--json`, `--verbose`, and `--quiet` options, structured errors, and consistent exit codes.
- Type-check projects before bundling and check final artifacts for unsupported APIs, unresolved environment access, callback nesting, and size limits. Add `build --no-typecheck`, `--no-minify`, `--no-check`, and `--strict`; `check` supports `--no-typecheck` and `--strict`.
- Add a device-specific TypeScript library and updated Shelly API declarations. Keep Node-side test types separate from device types.
- Export `shelly-forge/testing` with a virtual clock, timers, deferred RPC callbacks, KVS, MQTT, HTTP endpoints, events, BLE inputs, and resource-limit checks.
- Poll status throughout the startup window, 3000 ms by default, and require at least one healthy poll to complete within it. Every returned status must be healthy. A later deadline-aborted request or late healthy response does not fail verification after an earlier healthy poll. Attempt rollback to a different last-good artifact after a failed health check. Add `deploy --no-build`, `--dry-run`, `--no-verify`, `--no-rollback`, and `--verify-timeout`. Add `dev --verify-timeout` with the same default. Reject invalid timeouts with `USAGE`, exit 2, before building or watching.
- Support SHA-256 digest authentication for device RPC and WebSocket logs through `SHELLY_PASSWORD` or each script's `password` field.
- Stream device logs directly without an external client. Add `logs --duration`, `--lines`, `--grep`, and `--no-enable-debug`.
- Bundle the `shelly-forge` and `shelly-scripting` agent skills. Install them during project creation unless `init --no-skills` is set.
- Add a packed-package smoke test to CI. It initializes a project, checks scripts and types, and runs the template tests.

### Changed

- Require Node.js 22.12 or newer.
- Change creation syntax to `shelly-forge create <solution> <script>`. Use `--device` for the target and `--no-boot` to disable startup on boot.
- Move deployment cache data to `.shelly-forge/deploy-cache.json`, keep last-good artifacts under `.shelly-forge/deployed/`, and write diagnostic logs under `.shelly-forge/logs/`.
- Rewrite the project template with a timer-driven KVS example, simulator tests, separate device and test TypeScript configurations, and agent instructions. Both configurations force module detection, so device scripts can reuse top-level names without empty exports. Generated code uses single quotes and plain object keys.
- Keep build and check independent of device environment variables. Device references resolve only for device commands.
- Replace duplicated manuals and generic agent-role files with the README, contributor guide, bundled skills, and [design document](docs/design.html).
- Keep syntax at esbuild target `esnext` until TypeScript lowers it to ES5 with feature-detecting helpers. Normalize UTF-8 output even with `--no-minify`. Manifest `runtime.bundleTarget` is now `esnext`; readers still accept `es2015`.
- Report artifact-rule locations against the unminified ES5 bundle with code excerpts. For minified builds and `check`, label text locations with `(unminified)` and JSON findings with `bundle: "unminified"`; `build --no-minify` writes the matching file. Measure size against the shipped artifact. Add `use-before-declaration` and `unicode-escape` errors. Report `class X extends Y` as a `class-inheritance` error because TypeScript's ES5 output relies on function hoisting; other inheritance findings remain warnings. Limit unsupported-array-method warnings to callback-taking calls without a known built-in receiver or declared object method.
- Return `exitCode` in every JSON result envelope and set `ok` only for exit 0. Print help to stderr with exit 1 when no arguments are supplied; explicit help still uses stdout and exit 0.
- Stop the simulator after the first uncaught script error and expose it as `runtime.crashed`. Clear scheduled work and registrations, preserve recorded state, and make later `advance` and `flush` calls no-ops. Reject invalid host `setStatus` and `emitEvent` inputs such as circular references and `BigInt` with `TypeError` without crashing the runtime or changing its state or queued work. Strict built-ins now match undeclared modern String, Object, Array, Number, Math, and global APIs. `String.prototype.at` returns a numeric character code or `undefined` outside the string.
- Test on Node.js 22.12 and 24 in Ubuntu CI. Run npm's JavaScript CLI through Node without a shell in the smoke script, avoiding Windows batch-file spawning and preserving paths with spaces. No Windows CI runner is added.

### Removed

- Remove the MCP server and the `mcp` command. Agent support now uses bundled skills.
- Remove the runtime dependencies `@modelcontextprotocol/sdk`, `axios`, `chalk`, `dotenv`, `fs-extra`, and `inquirer` in favor of Node built-ins and the new device client.
- Remove the legacy `ShellyAPI.d.ts`, `other.d.ts`, and `TemperatureStatus.d.ts` declarations.

### Fixed

- Make discovery work without positional arguments, browse Shelly and matching HTTP mDNS services, and report unreachable or authentication-required devices.
- Make deployment fail instead of exiting successfully when required artifacts are missing. With `--no-build`, reject changed artifacts, entry sources, imported inputs, and public environment values. Manifest schema 1 adds input paths with SHA-256 hashes and `publicEnvSha256`; rebuild older manifests that lack these fields.
- Merge selected build manifest entries by `deployId`, preserve other configured scripts, and drop removed entries. Limit selected build type diagnostics to its inputs and global/configuration errors. Accept imports outside the project directory and record their relative paths, including `../`, in manifest inputs. Keep entry source and artifact paths inside the project. Validate the merged manifest before writing any artifacts.
- Defer the first Ctrl+C until stop, upload, configuration, and start finish. Honour cancellation before verification; a second Ctrl+C still forces exit 130. A genuine upload failure can still leave a stopped script with partial code.
- Require a running device script for cache skips. Use hashed last-good filenames to distinguish target names that differ only in case.
- Restart whole uploads at most twice after ambiguous `DEVICE_UNREACHABLE` chunk failures, never after an explicit RPC rejection. Check stored UTF-8 byte length using the final `Script.PutCode` response's `len`. Fall back to `Script.GetCode` only when `len` is absent, with correct byte counting for a partial multibyte character.
- Reuse an RPC client only for the same normalized host and password during deployment and rollback. Retry HTTP 429 after 2000 ms at most twice. Include HTTP status in malformed-response errors and a Gen2+ host hint for 404 responses.
- Warn on the first log failure per device outage, then debug-log repeats. Reset warning suppression after a successful connection so a later outage warns again. Reuse the WebSocket upgrade's digest challenge instead of making a separate request when that header is present.
- Reject unresolved `SHELLY_PUBLIC_*` accesses in default artifact checks instead of silently replacing missing values with empty strings.
- Invalidate deployment skip metadata before uploads so a failed or partial upload cannot be treated as unchanged on retry.
- Reject ambiguous selectors, duplicate artifact filenames, unsafe source paths, and duplicate on-device targets.
- Resolve selected `deploy` and `dev` targets strictly without failing on unset references in unrelated entries; include other resolvable targets in duplicate checks.

### Security

- Upgrade to Zod 4 and remove vulnerable dependency chains from the old RPC client and prompt packages.
- Keep credentials out of public build values, diagnostic logs, and JSON results. Preserve unmarked user-owned skill directories unless replacement is explicit.

### Migrating from 0.3

1. Upgrade Node.js to at least 22.12 and update the project's `shelly-forge` dependency to `^0.4.0`.
2. Use the [device tsconfig](templates/default/tsconfig.json) as the reference. Set `target: "es5"`, `moduleDetection: "force"`, `noLib: true`, `strict: true`, `noEmit: true`, and `types: []`. Include `src/**/*.ts`, `node_modules/shelly-forge/types/lib.shelly.d.ts`, and `node_modules/shelly-forge/types/shelly.d.ts`. Exclude `src/**/*.test.ts` and remove references to the legacy declarations.
3. Use a separate [test tsconfig](templates/default/tsconfig.test.json) with `moduleDetection: "force"`, `lib: ["es2022"]`, `types: ["node"]`, and the device API declarations in `shelly.d.ts`. Do not include `lib.shelly.d.ts` or `types/index.d.ts` in Node-side tests. Put project-wide type extensions inside `declare global`. Follow the [template package scripts](templates/default/package.json) for checking both configurations and running Vitest.
4. Update creation calls to `shelly-forge create lighting hallway --device '${DEVICE_HOSTNAME}'`. The solution comes first, the script second, and the device is an option rather than a positional argument.
5. Delete `build-cache/` if present and ignore `.shelly-forge/` in version control. Do not delete the new directory during routine troubleshooting; it contains rollback artifacts.
6. Remove old Shelly Forge MCP entries from editor configuration. Run `shelly-forge skills install` and use the [CLI skill](skills/shelly-forge/SKILL.md) and [scripting skill](skills/shelly-scripting/SKILL.md).
7. Set every referenced `SHELLY_PUBLIC_*` build value, even to an empty string when a source fallback is intended. Run tests and `shelly-forge check --strict`, fix the findings, then deploy to a confirmed target.

## [0.3.0] - 2026-11-03

### Added

- Build manifests with source and artifact sizes, SHA-256 hashes, and runtime settings.
- Script selectors for builds and deployments, including `solution/script` and `solution-script`.
- Configurable on-device names through `targetScriptName` and duplicate device-target validation.
- GitHub Actions publishing for new stable versions on `main`, using npm trusted publishing.

### Fixed

- Compile bundled scripts to ES5 before minification.
- Deploy only the selected script instead of ignoring the selector.
- Redeploy unchanged code when its target device or on-device name changes.
- Load `bonjour-service` through its CommonJS exports under Node ESM.
- Report configured solution names in build summaries.

### Security

- Update Axios, esbuild, and Inquirer; remove the unused nodemon dependency.
- Override the vulnerable transitive `follow-redirects` dependency.

## [0.2.1] - 2026-09-09

### Added

- Add CLI, device API, data structure, and schema references.
- Add getting started, troubleshooting, contributor, and system overview guides.
- Add documentation examples and development practices.

### Changed

- Reorganize documentation and add a navigation index.
- Expand the getting started guide with AI-assisted workflow examples.

### Fixed

- Preserve non-ASCII characters as UTF-8 in built Shelly scripts.
- Align CLI, MCP, and generated-project dependency versions with the package release.
