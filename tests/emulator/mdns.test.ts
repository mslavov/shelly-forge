import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Worker } from 'node:worker_threads';
import { expect, test, vi } from 'vitest';
import type { MdnsPublisher } from '../../src/emulator/index.js';
import { createPublisher, publishMdns } from '../../src/emulator/mdns.js';
import { fixture } from './helpers.js';

test('publishes both service types and unpublishes and destroys once on close', async () => {
    const publish = vi.fn<MdnsPublisher['publish']>(() => ({ on: vi.fn() }));
    const unpublishAll = vi.fn<MdnsPublisher['unpublishAll']>(done => done());
    const destroy = vi.fn<MdnsPublisher['destroy']>(done => done());
    const unpublish = publishMdns(12345, { id: 'shelly-mdns', gen: 3, app: 'test-app', ver: '1.2.3' }, { warn: vi.fn() },
        () => ({ publish, unpublishAll, destroy }));
    expect(publish.mock.calls.map(call => call[0])).toEqual(['shelly', 'http'].map(type => ({
        name: 'shelly-mdns', type, protocol: 'tcp', port: 12345,
        txt: { id: 'shelly-mdns', gen: '3', app: 'test-app', ver: '1.2.3' },
    })));
    await unpublish();
    expect(unpublishAll).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
});

test('reports mDNS setup and asynchronous errors without stopping HTTP', async () => {
    const warn = vi.fn();
    const failed = await fixture();
    const failedUnpublish = publishMdns(12345, {}, { warn }, () => { throw new Error('network error'); });
    expect(await failed.rpc.call('Script.List')).toEqual({ scripts: [] });
    expect(warn).toHaveBeenCalledWith('Could not publish emulator multicast DNS advertisement');
    let report: ((error: Error) => void) | undefined;
    const publisher: MdnsPublisher = {
        publish: () => ({ on(_event, listener) { report = listener; } }),
        unpublishAll: done => done(), destroy: done => done(),
    };
    const unpublish = publishMdns(12345, {}, { warn }, () => publisher);
    report?.(new Error('asynchronous network error'));
    expect(await failed.rpc.call('Script.List')).toEqual({ scripts: [] });
    expect(warn).toHaveBeenCalledTimes(2);
    await Promise.all([failedUnpublish(), unpublish()]);
});

test('does not instantiate a publisher unless requested', async () => {
    const factory = vi.fn();
    await fixture({ createPublisher: factory });
    expect(factory).not.toHaveBeenCalled();
});

test('captures dependency conflict output without forwarding it to stdout', async () => {
    class FakeWorker extends EventEmitter {
        stdout = new PassThrough();
        stderr = new PassThrough();
        postMessage = vi.fn((message: { id?: number }) => {
            if (message.id !== undefined) queueMicrotask(() => this.emit('message', { id: message.id }));
        });
        terminate = vi.fn(async () => { this.emit('exit', 0); return 0; });
    }
    const worker = new FakeWorker();
    const onError = vi.fn();
    const stdout = vi.spyOn(process.stdout, 'write');
    try {
        const publisher = createPublisher(onError, worker as unknown as Worker);
        publisher.publish({ name: 'test', type: 'shelly', protocol: 'tcp', port: 12345, txt: {} });
        expect(worker.postMessage).toHaveBeenCalledWith({ type: 'publish', options: expect.objectContaining({ name: 'test' }) });
        worker.stdout.write('Error: Service name is already in use on the network\n');
        expect(onError).toHaveBeenCalledTimes(1);
        expect(stdout).not.toHaveBeenCalled();
        await new Promise<void>(done => publisher.unpublishAll(done));
        await new Promise<void>(done => publisher.destroy(done));
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally { stdout.mockRestore(); worker.stdout.destroy(); worker.stderr.destroy(); }
});

test('a publisher worker failure completes pending shutdown callbacks', async () => {
    const worker = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(),
        postMessage: vi.fn(), terminate: vi.fn(async () => 0),
    });
    const onError = vi.fn();
    const publisher = createPublisher(onError, worker as unknown as Worker);
    const unpublish = new Promise<void>(done => publisher.unpublishAll(done));
    worker.emit('error', new Error('worker failed'));
    await unpublish;
    await new Promise<void>(done => publisher.destroy(done));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    worker.stdout.destroy();
    worker.stderr.destroy();
});
