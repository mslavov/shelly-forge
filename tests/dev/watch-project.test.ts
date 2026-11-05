import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { watchProject, type WatchFactory } from '../../src/dev/watch-project.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function watchers() {
    const calls: Array<{
        directory: string;
        recursive: boolean;
        change: Parameters<WatchFactory>[2];
        handle: EventEmitter & { close: ReturnType<typeof vi.fn> };
    }> = [];
    const create: WatchFactory = (directory, options, change) => {
        const handle = Object.assign(new EventEmitter(), { close: vi.fn() });
        calls.push({ directory, ...options, change, handle });
        return handle;
    };
    return { calls, create };
}

it('watches src recursively and filters project-root events', () => {
    const { create, calls } = watchers();
    const onChange = vi.fn();
    const watcher = watchProject('/project', { watch: create, onChange, onError: vi.fn() });
    expect(calls.map(({ directory, recursive }) => ({ directory, recursive }))).toEqual([
        { directory: '/project', recursive: false },
        { directory: path.join('/project', 'src'), recursive: true },
    ]);
    calls[0].change('change', 'dist');
    calls[0].change('change', 'README.md');
    expect(onChange).not.toHaveBeenCalled();
    for (const filename of ['solutions.config.json', 'tsconfig.json', '.env']) calls[0].change('rename', filename);
    calls[1].change('change', 'nested/script.ts');
    calls[1].change('rename', null);
    expect(onChange).toHaveBeenCalledTimes(5);
    watcher.close();
    for (const { handle } of calls) expect(handle.close).toHaveBeenCalledTimes(1);
});

it('reattaches src after replacement and handles unnamed root events', () => {
    const { create, calls } = watchers();
    const onChange = vi.fn();
    const watcher = watchProject('/project', { watch: create, onChange, onError: vi.fn() });
    calls[0].change('rename', 'src');
    expect(calls[1].handle.close).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(3);
    calls[0].change('change', null);
    expect(calls[2].handle.close).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(4);
    expect(onChange).toHaveBeenCalledTimes(2);
    watcher.close();
});

it('reports watcher errors and retries without stopping the other watcher', async () => {
    const { create, calls } = watchers();
    const onError = vi.fn();
    const onChange = vi.fn();
    const watcher = watchProject('/project', { watch: create, onChange, onError });
    const error = new Error('watch failed');
    calls[1].handle.emit('error', error);
    expect(onError).toHaveBeenCalledWith(error);
    calls[0].change('change', '.env');
    expect(onChange).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(3);
    expect(onChange).toHaveBeenCalledTimes(2);
    calls[2].change('change', 'script.ts');
    expect(onChange).toHaveBeenCalledTimes(3);
    watcher.close();
});

it.each([0, 1])('schedules a catch-up rebuild after watcher %s recovers without a new file event', async index => {
    const { create, calls } = watchers();
    const onChange = vi.fn();
    const watcher = watchProject('/project', { watch: create, onChange, onError: vi.fn() });
    calls[index].handle.emit('error', new Error('watch unavailable during edit'));
    await vi.advanceTimersByTimeAsync(999);
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onChange).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(3);
    watcher.close();
});

it('retries missing directories and cancels retries on close', async () => {
    const error = new Error('missing src');
    const onError = vi.fn();
    const { create, calls } = watchers();
    const watch: WatchFactory = (directory, options, change) => {
        if (options.recursive) throw error;
        return create(directory, options, change);
    };
    const watcher = watchProject('/project', { watch, onChange: vi.fn(), onError });
    expect(onError).toHaveBeenCalledWith(error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledTimes(2);
    watcher.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(calls[0].handle.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
});
