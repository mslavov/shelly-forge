import { createRequire } from 'node:module';
import { parentPort } from 'node:worker_threads';
import { isRecord } from '../core/validation.js';

const port = parentPort;
if (!port) throw new Error('Multicast DNS publisher requires a worker thread');
const require = createRequire(import.meta.url);
const { Bonjour } = require('bonjour-service') as typeof import('bonjour-service');
const report = () => port.postMessage({ error: true });
const publisher = new Bonjour(undefined, report);

port.on('message', (message: unknown) => {
    if (!isRecord(message)) return;
    const done = () => port.postMessage({ id: message.id });
    try {
        if (message.type === 'publish') {
            publisher.publish(message.options as import('bonjour-service').ServiceConfig).on('error', report);
        } else if (message.type === 'unpublish') {
            publisher.unpublishAll(done);
        } else if (message.type === 'destroy') {
            publisher.destroy(done);
        }
    } catch {
        report();
        done();
    }
});
