import { Worker } from 'node:worker_threads';
import type { Logger } from '../core/logger.js';
import { isRecord } from '../core/validation.js';

export interface MdnsPublisher {
    publish(options: { name: string; type: 'shelly' | 'http'; protocol: 'tcp'; port: number; txt: Record<string, string> }): {
        on(event: 'error', listener: (error: Error) => void): unknown;
    };
    unpublishAll(callback: () => void): void;
    destroy(callback: () => void): void;
}

type PublisherWorker = Pick<Worker, 'on' | 'postMessage' | 'terminate' | 'stdout' | 'stderr'>;

export function createPublisher(
    onError: (error: Error) => void,
    worker: PublisherWorker = new Worker(new URL('./mdns-worker.js', import.meta.url), { stdout: true, stderr: true }),
): MdnsPublisher {
    let stopped = false;
    let stopping = false;
    let nextId = 1;
    const pending = new Map<number, () => void>();
    const report = () => onError(new Error('Multicast DNS publisher failed'));
    const drain = () => {
        stopped = true;
        for (const done of pending.values()) done();
    };
    // bonjour-service writes name conflicts to stdout instead of emitting an error.
    worker.stdout.on('data', report);
    worker.stderr.on('data', report);
    worker.on('error', () => { report(); drain(); });
    worker.on('exit', () => { if (!stopping && !stopped) report(); drain(); });
    worker.on('message', (message: unknown) => {
        if (!isRecord(message)) return;
        if (message.error) report();
        if (typeof message.id === 'number') pending.get(message.id)?.();
    });
    const request = (type: 'unpublish' | 'destroy', callback: () => void) => {
        if (stopped) { callback(); return; }
        const id = nextId++;
        const done = () => {
            if (!pending.delete(id)) return;
            clearTimeout(timer);
            callback();
        };
        const timer = setTimeout(() => { report(); done(); }, 2000);
        timer.unref();
        pending.set(id, done);
        try { worker.postMessage({ type, id }); } catch { report(); done(); }
    };
    return {
        publish(options) {
            if (!stopped) worker.postMessage({ type: 'publish', options });
            return { on() {} };
        },
        unpublishAll(callback) { request('unpublish', callback); },
        destroy(callback) {
            stopping = true;
            request('destroy', () => {
                void worker.terminate().then(() => callback(), () => { report(); callback(); });
            });
        },
    };
}

export function publishMdns(
    port: number, info: Record<string, unknown>, logger: Pick<Logger, 'warn'>,
    factory: (onError: (error: Error) => void) => MdnsPublisher = createPublisher,
): () => Promise<void> {
    let publisher: MdnsPublisher | undefined;
    const report = () => logger.warn('Could not publish emulator multicast DNS advertisement');
    try {
        publisher = factory(report);
        const txt = Object.fromEntries(['gen', 'app', 'ver', 'id'].map(key => [key, String(info[key])]));
        for (const type of ['shelly', 'http'] as const) {
            publisher.publish({ name: String(info.id), type, protocol: 'tcp', port, txt }).on('error', report);
        }
    } catch { report(); }
    return async () => {
        if (!publisher) return;
        try { await new Promise<void>(resolve => publisher!.unpublishAll(resolve)); } catch { report(); }
        try { await new Promise<void>(resolve => publisher!.destroy(resolve)); } catch { report(); }
    };
}
