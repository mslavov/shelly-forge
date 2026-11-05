export interface RebuildQueue {
    runNow(): void;
    schedule(): void;
    close(): Promise<void>;
}

export function createRebuildQueue(
    run: () => Promise<void>,
    options: { debounceMs?: number; onError(error: unknown): void },
): RebuildQueue {
    const debounceMs = options.debounceMs ?? 300;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: Promise<void> | undefined;
    let pending = false;
    let closed = false;

    function drain(): void {
        if (closed || active || timer || !pending) return;
        pending = false;
        active = Promise.resolve().then(run).catch(options.onError).finally(() => {
            active = undefined;
            drain();
        });
    }

    return {
        runNow() {
            if (closed) return;
            clearTimeout(timer);
            timer = undefined;
            pending = true;
            drain();
        },
        schedule() {
            if (closed) return;
            pending = true;
            clearTimeout(timer);
            timer = setTimeout(() => {
                timer = undefined;
                drain();
            }, debounceMs);
        },
        async close() {
            closed = true;
            pending = false;
            clearTimeout(timer);
            timer = undefined;
            await active;
        },
    };
}
