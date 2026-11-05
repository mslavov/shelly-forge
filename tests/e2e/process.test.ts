import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { spawnCli } from './process.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };

beforeEach(() => {
    child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
    });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
});

it('does not supply an empty emulator password when the environment omits it', () => {
    vi.stubEnv('SHELLY_EMULATOR_PASSWORD', undefined);
    spawnCli(['emulate'], '/tmp');
    expect(vi.mocked(spawn).mock.calls[0][2]?.env).not.toHaveProperty('SHELLY_EMULATOR_PASSWORD');
    spawnCli(['emulate'], '/tmp', { SHELLY_EMULATOR_PASSWORD: 'test-password' });
    expect(vi.mocked(spawn).mock.calls[1][2]?.env?.SHELLY_EMULATOR_PASSWORD).toBe('test-password');
});

it('collects JSON events split across stdout chunks', async () => {
    const cli = spawnCli([], '/tmp');
    child.stdout.write('{"type":"rea');
    child.stdout.write('dy"}\n{"ok":true}\n');
    await cli.waitFor(() => cli.events.length === 2, 'read events');
    expect(cli.events).toEqual([{ type: 'ready' }, { ok: true }]);
    child.emit('close', 0);
    expect(await cli.stop()).toBe(0);
    expect(child.kill).not.toHaveBeenCalled();
});

it('reports a non-JSON stdout line through the waiting assertion, not the data handler', async () => {
    const cli = spawnCli([], '/tmp');
    expect(() => child.stdout.write('unexpected diagnostic\n{"type":"ready"}\n')).not.toThrow();
    await expect(cli.waitFor(() => cli.events.length > 0, 'announce readiness'))
        .rejects.toThrow('CLI emitted non-JSON stdout: unexpected diagnostic');
    child.emit('close', 0);
    await cli.stop();
});

it('kills a process that ignores SIGINT after the cleanup deadline', async () => {
    vi.useFakeTimers();
    const cli = spawnCli([], '/tmp');
    child.kill.mockImplementation((signal: string) => {
        if (signal === 'SIGKILL') child.emit('close', null);
        return true;
    });
    const stopped = cli.stop();
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGINT');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await stopped).toBeNull();
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
});

it('cancels the forced kill after a graceful shutdown', async () => {
    vi.useFakeTimers();
    const cli = spawnCli([], '/tmp');
    const stopped = cli.stop();
    child.emit('close', 0);
    expect(await stopped).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGINT');
});
