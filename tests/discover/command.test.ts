import { Command } from 'commander';
import { afterEach, expect, it, vi } from 'vitest';
import { discover, register } from '../../src/commands/discover.js';
import { createContext } from '../../src/core/command.js';
import * as discovery from '../../src/device/discovery.js';
import { createTempProject, runCli } from '../helpers/project.js';

afterEach(() => vi.restoreAllMocks());

async function context() {
    const { dir } = await createTempProject();
    return createContext({}, { projectDir: dir, env: {} });
}

it('defaults to five seconds without arguments or a project configuration', async () => {
    const ctx = await context();
    const find = vi.fn().mockResolvedValue([]);
    const result = await discover(ctx, {}, find);
    expect(find).toHaveBeenCalledWith({ durationMs: 5000, signal: ctx.signal });
    expect(result).toEqual({ summary: 'No Shelly devices found.', data: [] });
});

it('prints a table and returns all details as data', async () => {
    const ctx = await context();
    const devices: discovery.DiscoveredDevice[] = [
        { name: 'shelly-plus', host: '192.0.2.1', model: 'SNSW-001', gen: 2, ver: '1.6.2', authRequired: true, reachable: true },
        { name: 'shelly-mini', host: '192.0.2.2', fw_id: 'release', authRequired: false, reachable: true },
        { name: 'shelly-lost', host: '192.0.2.3', authRequired: false, reachable: false },
    ];
    const find = vi.fn().mockResolvedValue(devices);
    const result = await discover(ctx, { duration: 3 }, find);
    expect(result.data).toBe(devices);
    expect(result.summary).toMatch(/Name\s+Host\s+Model\s+Gen\s+Firmware\s+Auth/);
    expect(result.summary).toContain('required');
    expect(result.summary).toContain('release');
    expect(result.summary).toContain('unknown');
    expect(find).toHaveBeenCalledWith({ durationMs: 3000, signal: ctx.signal });
});

it.each([0, -1, 1.5, NaN, Infinity, 2147484])('rejects invalid CLI duration %s', async duration => {
    const ctx = await context();
    const find = vi.fn();
    await expect(discover(ctx, { duration }, find)).rejects.toMatchObject({ code: 'USAGE' });
    expect(find).not.toHaveBeenCalled();
});

it('runs the registered command with no arguments and emits a JSON array in data', async () => {
    const { dir } = await createTempProject();
    const find = vi.spyOn(discovery, 'discoverDevices').mockResolvedValue([]);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const previousExitCode = process.exitCode;
    try {
        const program = new Command().option('--json').option('--cwd <dir>');
        register(program);
        await program.parseAsync(['--json', '--cwd', dir, 'discover'], { from: 'user' });
        expect(find).toHaveBeenCalledWith({ durationMs: 5000, signal: expect.any(AbortSignal) });
        const line = output.mock.calls.map(call => String(call[0])).join('');
        expect(JSON.parse(line)).toEqual({ ok: true, exitCode: 0, command: 'discover', summary: 'No Shelly devices found.', data: [] });
    } finally {
        process.exitCode = previousExitCode;
    }
});

it('shows duration as an optional flag rather than a positional argument', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['discover', '--help'], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('discover [options]');
    expect(result.stdout).toContain('--duration <seconds>');
    expect(result.stdout).toContain('(default: 5)');
});

it('returns USAGE for an invalid duration through the built CLI without browsing', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['--json', 'discover', '--duration', '0'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'USAGE' } });
});
