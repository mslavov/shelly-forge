# Shelly script project

This project builds TypeScript scripts for Shelly devices with scripting support.
Use Node.js 22.12 or newer.

## Set up

```sh
npm install
cp .env.example .env
```

Set `DEVICE_HOSTNAME` in `.env` to your device's hostname or IP address.
Uncomment `SHELLY_PASSWORD` if the device requires authentication.
Only `SHELLY_PUBLIC_*` values enter the built script. Never use that prefix for secrets.
Keep `SHELLY_PUBLIC_GREETING` set before building. An empty value uses the script's
`Hello` fallback; an unset value fails the build checks.

## Test and build

```sh
npm run typecheck
npm test
npm run check
npm run build
```

`src/example/hello.ts` increments the device's `example.hello.count` KVS value once
per minute and prints the greeting and count. Its test loads the bundled script
with `shelly-forge/testing`, advances a virtual clock, and checks KVS and logs.
The test does not contact a device. Edit the script and test together, then run
the commands above before deploying.

`tsconfig.json` checks device code against Shelly's supported APIs.
`tsconfig.test.json` checks tests against Node.js APIs.
Both use `moduleDetection: "force"`, so scripts can reuse top-level names without
adding `export {}`. Declare project-wide type extensions inside `declare global`.
Build output goes to `dist/`, with hashes and checks in `dist/manifest.json`.

## Run on a device

```sh
npm run deploy -- example/hello
npm run status -- example/hello
npm run logs -- example/hello
npm run dev -- example/hello
```

`dev` watches the selected script, rebuilds and deploys changes, and streams logs.
Use `--verify-timeout <ms>` with `deploy` or `dev` to change the default 3000 ms
health window. Every status poll in that window must report running without errors.
Press Ctrl+C to stop. If an upload is in progress, the first interrupt waits for
upload, configuration, and start to finish before stopping the command. A second
Ctrl+C forces exit and can leave the device partly updated.
Deployment starts the script and enables it on boot by default.
The greeting counter writes to KVS once per minute while the script runs.

## Add a script

```sh
npx shelly-forge create lighting hall
npm test
npm run dev -- lighting/hall
```

Pass the solution and script names as separate arguments. `create` adds
`src/lighting/hall.ts`, its test, and an entry in
`solutions.config.json`. Names accept letters, digits, underscores, and hyphens.
Use `--device <host>` to override `${DEVICE_HOSTNAME}` or `--no-boot` to disable
startup on boot. The generated script uses the same minute counter as the example;
replace it with your automation.
