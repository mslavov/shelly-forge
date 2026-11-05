import { watch, type WatchEventType } from 'node:fs';
import path from 'node:path';

export interface WatchHandle {
    on(event: 'error', listener: (error: Error) => void): unknown;
    close(): void;
}

export type WatchFactory = (
    directory: string,
    options: { recursive: boolean },
    listener: (event: WatchEventType, filename: string | null) => void,
) => WatchHandle;

export interface ProjectWatcher {
    close(): void;
}

export function watchProject(projectDir: string, options: {
    onChange(): void;
    onError(error: unknown): void;
    watch?: WatchFactory;
}): ProjectWatcher {
    const createWatcher: WatchFactory = options.watch ?? watch;
    const files = new Set(['solutions.config.json', 'tsconfig.json', '.env']);
    const handles: Partial<Record<'root' | 'src', WatchHandle>> = {};
    const retries: Partial<Record<'root' | 'src', ReturnType<typeof setTimeout>>> = {};
    let closed = false;

    function detach(kind: 'root' | 'src'): void {
        clearTimeout(retries[kind]);
        delete retries[kind];
        const handle = handles[kind];
        delete handles[kind];
        handle?.close();
    }

    function failed(kind: 'root' | 'src', error: unknown): void {
        detach(kind);
        if (closed) return;
        options.onError(error);
        retries[kind] = setTimeout(() => attach(kind, true), 1000);
    }

    function attach(kind: 'root' | 'src', catchUp = false): void {
        if (closed) return;
        detach(kind);
        try {
            const handle = createWatcher(kind === 'root' ? projectDir : path.join(projectDir, 'src'), { recursive: kind === 'src' }, (event, filename) => {
                if (closed) return;
                if (kind === 'src') {
                    options.onChange();
                } else if (filename === null || files.has(filename) || filename === 'src') {
                    if (filename === null || (filename === 'src' && event === 'rename')) attach('src');
                    options.onChange();
                }
            });
            handles[kind] = handle;
            handle.on('error', error => {
                if (handles[kind] === handle) failed(kind, error);
            });
            if (catchUp) options.onChange();
        } catch (error) {
            failed(kind, error);
        }
    }

    attach('root');
    attach('src');
    return {
        close() {
            closed = true;
            detach('root');
            detach('src');
        },
    };
}
