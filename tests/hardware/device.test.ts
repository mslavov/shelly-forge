import { defineScenario } from '../e2e/scenario.js';

const host = process.env.SHELLY_E2E_HOST?.trim();
if (!host) throw new Error('SHELLY_E2E_HOST is required for test:device. This opt-in suite changes only the dedicated shelly-forge-e2e script and restores debug logging.');

defineScenario('built CLI against an explicitly selected device', () => ({
    host, password: process.env.SHELLY_E2E_PASSWORD, emulator: false,
}), 120000);
