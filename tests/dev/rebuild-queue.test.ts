import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRebuildQueue } from '../../src/dev/rebuild-queue.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

it('debounces a burst for 300 ms after the last change', async () => {
    const run = vi.fn(async () => {});
    const queue = createRebuildQueue(run, { onError: vi.fn() });
    queue.schedule();
    await vi.advanceTimersByTimeAsync(200);
    queue.schedule();
    await vi.advanceTimersByTimeAsync(299);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await queue.close();
});

it('starts immediately and coalesces changes during a run into one later run', async () => {
    const first = deferred();
    const run = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const queue = createRebuildQueue(run, { debounceMs: 10, onError: vi.fn() });
    queue.runNow();
    await vi.advanceTimersByTimeAsync(0);
    queue.schedule();
    queue.schedule();
    await vi.advanceTimersByTimeAsync(10);
    queue.schedule();
    await vi.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledTimes(1);
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    await queue.close();
});

it('waits for the debounce when a run finishes before the last change settles', async () => {
    const first = deferred();
    const run = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const queue = createRebuildQueue(run, { debounceMs: 10, onError: vi.fn() });
    queue.runNow();
    await vi.advanceTimersByTimeAsync(0);
    queue.schedule();
    first.resolve();
    await vi.advanceTimersByTimeAsync(9);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await queue.close();
});

it('reports rejected runs and accepts another change', async () => {
    const error = new Error('build failed');
    const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn();
    const queue = createRebuildQueue(run, { debounceMs: 1, onError });
    queue.runNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(error);
    queue.schedule();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await queue.close();
});

it('cancels pending changes and waits for the active run during close', async () => {
    const first = deferred();
    const run = vi.fn(() => first.promise);
    const queue = createRebuildQueue(run, { debounceMs: 1, onError: vi.fn() });
    queue.runNow();
    await vi.advanceTimersByTimeAsync(0);
    queue.schedule();
    const closed = vi.fn();
    const closing = queue.close().then(closed);
    await vi.advanceTimersByTimeAsync(100);
    expect(closed).not.toHaveBeenCalled();
    first.resolve();
    await closing;
    queue.schedule();
    queue.runNow();
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
});

it('closes a queue before its first debounce fires', async () => {
    const run = vi.fn(async () => {});
    const queue = createRebuildQueue(run, { onError: vi.fn() });
    queue.schedule();
    await queue.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();
});
