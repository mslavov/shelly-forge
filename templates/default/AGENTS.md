# Shelly project guide

Use the `shelly-scripting` and `shelly-forge` skills in `.agents/skills`.
If those files are missing, run `npx shelly-forge skills install`.

## Project layout

Device scripts live in `src/<solution>/<script>.ts`. Their Node.js tests live beside
them as `<script>.test.ts`. `solutions.config.json` assigns each script to a device.
`dist/` contains generated JavaScript and `manifest.json`; do not edit those files.

## Commands

Run `npm install` and copy `.env.example` to `.env` before the first build.
Set `DEVICE_HOSTNAME` and keep `SHELLY_PUBLIC_GREETING` defined in `.env`.
Run `npm run typecheck`, `npm test`, and `npm run check` after changing a script.
Run `npm run build` to write artifacts.
Use `npx shelly-forge create <solution> <script>` to add a script and test.

Ask for the target device before deploying or changing its state.
`npm run deploy -- <solution>/<script>` builds and deploys one script.
`npm run dev -- <solution>/<script>` watches, deploys, and streams logs until Ctrl+C.
`npm run status -- <solution>/<script>` and `npm run logs -- <solution>/<script>`
inspect the running script.

## Script constraints

Use named callbacks and `Timer.set`, not async functions or Node.js timers.
The device type library rejects unsupported APIs. Keep Node.js imports in tests,
not in device scripts. Test automation with `createShellyRuntime` and `loadScript`
from `shelly-forge/testing` before using hardware.
Both TypeScript configurations use `moduleDetection: "force"`. Device scripts do
not need an empty export to keep their top-level names separate. Define named
callbacks before passing them to timers or RPC calls; the device does not hoist them.

Only `SHELLY_PUBLIC_*` values enter built JavaScript. Keep passwords in
`SHELLY_PASSWORD` or a non-public config reference. Never commit `.env`.
