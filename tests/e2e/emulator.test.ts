import { afterAll, beforeAll, expect } from 'vitest';
import { PACKAGE_ROOT } from '../../src/core/paths.js';
import { spawnCli, type CliProcess } from './process.js';
import { defineScenario } from './scenario.js';

const password = 'local-e2e-password';
let emulator: CliProcess;
let host: string;

beforeAll(async () => {
    emulator = spawnCli(['emulate', '--port', '0'], PACKAGE_ROOT, { SHELLY_EMULATOR_PASSWORD: password });
    await emulator.waitFor(() => emulator.events.some(event => event.type === 'ready'), 'announce emulator readiness', 10000);
    const ready = emulator.events.find(event => event.type === 'ready');
    expect(ready).toMatchObject({ auth: true, host: expect.stringMatching(/^127\.0\.0\.1:\d+$/) });
    host = String(ready?.host);
}, 15000);

afterAll(async () => {
    if (!emulator) return;
    expect(await emulator.stop()).toBe(0);
    expect(emulator.events.at(-1)).toMatchObject({ command: 'emulate', ok: true, exitCode: 0 });
    expect(emulator.output().stdout + emulator.output().stderr).not.toContain(password);
}, 10000);

defineScenario('built CLI against a password-protected emulator', () => ({ host, password, emulator: true }));
