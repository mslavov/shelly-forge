import { expect, it, onTestFinished, vi } from 'vitest';
import {
    discoverDevices, type DiscoveryBrowser, type DiscoveryService,
} from '../../src/device/discovery.js';
import { startFakeDevice, type FakeDeviceOptions } from '../helpers/fake-device.js';

function browser(services: Array<{ type: 'shelly' | 'http'; service: DiscoveryService }> = []) {
    const searches: Array<{ type: 'shelly' | 'http'; protocol: 'tcp' }> = [];
    const stops: ReturnType<typeof vi.fn>[] = [];
    const listeners: Array<(service: DiscoveryService) => void> = [];
    const fake: DiscoveryBrowser = {
        find(options, onUp) {
            searches.push(options);
            listeners.push(onUp);
            queueMicrotask(() => {
                for (const entry of services) if (entry.type === options.type) onUp(entry.service);
            });
            const stop = vi.fn();
            stops.push(stop);
            return { stop };
        },
        destroy: vi.fn(),
    };
    return { fake, searches, stops, listeners, factory: () => fake };
}

async function device(options: FakeDeviceOptions = {}) {
    const fake = await startFakeDevice(options);
    onTestFinished(() => fake.close());
    const address = new URL(`http://${fake.host}`);
    const service: DiscoveryService = {
        name: 'shelly-plus1', addresses: ['::1', address.hostname], host: 'shelly-plus1.local.', port: Number(address.port),
    };
    return { ...fake, service };
}

it('browses both types, deduplicates the host, and enriches the device', async () => {
    const fake = await device({ deviceInfo: { gen: 3, model: 'S3SW-001', app: 'Plus1', ver: '1.7.0', fw_id: 'release-1', mac: 'ABCDEF123456', auth_en: false } });
    const mdns = browser([
        { type: 'shelly', service: fake.service },
        { type: 'http', service: { ...fake.service, name: 'Another Shelly name' } },
        { type: 'http', service: { name: 'printer', addresses: ['127.0.0.1'], port: 9 } },
    ]);
    expect(await discoverDevices({ durationMs: 10, createBrowser: mdns.factory })).toEqual([{
        name: 'shelly-plus1', host: fake.host, gen: 3, model: 'S3SW-001', app: 'Plus1', ver: '1.7.0', fw_id: 'release-1',
        mac: 'ABCDEF123456', auth_en: false, authRequired: false, reachable: true,
    }]);
    expect(fake.requests.map(request => request.method)).toEqual(['Shelly.GetDeviceInfo']);
    expect(mdns.searches).toEqual([{ type: 'shelly', protocol: 'tcp' }, { type: 'http', protocol: 'tcp' }]);
    expect(mdns.stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
    expect(mdns.fake.destroy).toHaveBeenCalledOnce();
});

it('retains a device that requires authentication', async () => {
    const fake = await device({ password: 'secret' });
    const mdns = browser([{ type: 'shelly', service: fake.service }]);
    const result = await discoverDevices({ durationMs: 10, createBrowser: mdns.factory });
    expect(result).toEqual([{ name: fake.service.name, host: fake.host, authRequired: true, reachable: true }]);
    expect(JSON.stringify(result)).not.toContain('secret');
});

it('honors auth_en returned by devices with public device information', async () => {
    const fake = await device({ deviceInfo: { auth_en: true } });
    const mdns = browser([{ type: 'shelly', service: fake.service }]);
    const result = await discoverDevices({ durationMs: 10, createBrowser: mdns.factory });
    expect(result[0]).toMatchObject({ auth_en: true, authRequired: true, reachable: true });
});

it('retains unreachable devices', async () => {
    const fake = await device();
    await fake.close();
    const mdns = browser([{ type: 'http', service: fake.service }]);
    expect(await discoverDevices({ durationMs: 10, createBrowser: mdns.factory })).toEqual([
        { name: fake.service.name, host: fake.host, reachable: false, authRequired: false },
    ]);
});

it('limits device information calls to two seconds', async () => {
    const fake = await device({ failures: { 'Shelly.GetDeviceInfo': { type: 'delay', ms: 10000 } } });
    const mdns = browser([{ type: 'shelly', service: fake.service }]);
    const start = performance.now();
    const result = await discoverDevices({ durationMs: 10, createBrowser: mdns.factory });
    expect(performance.now() - start).toBeLessThan(6000);
    expect(result[0]).toMatchObject({ host: fake.host, reachable: false });
});

it('cancels pending probes and closes browsers when aborted', async () => {
    const fake = await device({ failures: { 'Shelly.GetDeviceInfo': { type: 'delay', ms: 10000 } } });
    const mdns = browser([{ type: 'shelly', service: fake.service }]);
    const controller = new AbortController();
    const pending = discoverDevices({ durationMs: 10000, signal: controller.signal, createBrowser: mdns.factory });
    await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
    controller.abort();
    expect((await pending)[0]).toMatchObject({ host: fake.host, reachable: false });
    expect(mdns.stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
    expect(mdns.fake.destroy).toHaveBeenCalledOnce();
});

it('does not start a browser for an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const factory = vi.fn();
    expect(await discoverDevices({ durationMs: 100, signal: controller.signal, createBrowser: factory })).toEqual([]);
    expect(factory).not.toHaveBeenCalled();
});

it('ignores malformed service addresses without starting HTTP requests', async () => {
    const mdns = browser([
        { type: 'shelly', service: { name: 'missing host' } },
        { type: 'shelly', service: { name: 'bad port', host: 'localhost', port: -1 } },
        { type: 'shelly', service: { name: 'bad host', host: 'user:secret@host' } },
        { type: 'shelly', service: { name: 'bad path', host: 'localhost/rpc' } },
    ]);
    expect(await discoverDevices({ durationMs: 10, createBrowser: mdns.factory })).toEqual([]);
});

it('ignores late service announcements after the scan closes', async () => {
    const mdns = browser();
    const result = await discoverDevices({ durationMs: 10, createBrowser: mdns.factory });
    mdns.listeners[0]({ name: 'late', host: 'localhost', port: 9 });
    expect(result).toEqual([]);
});

it('surfaces mDNS errors and closes both searches', async () => {
    const mdns = browser();
    const pending = discoverDevices({ durationMs: 10000, createBrowser(onError) {
        queueMicrotask(() => onError(new Error('mDNS unavailable')));
        return mdns.fake;
    } });
    await expect(pending).rejects.toMatchObject({ code: 'DEVICE_UNREACHABLE', hint: expect.stringContaining('multicast DNS') });
    expect(mdns.stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
    expect(mdns.fake.destroy).toHaveBeenCalledOnce();
});

it('closes the first browser if starting the second browser throws', async () => {
    const mdns = browser();
    const find = mdns.fake.find.bind(mdns.fake);
    mdns.fake.find = (options, onUp) => {
        if (options.type === 'http') throw new Error('Cannot create browser');
        return find(options, onUp);
    };
    await expect(discoverDevices({ durationMs: 10000, createBrowser: mdns.factory })).rejects.toMatchObject({ code: 'DEVICE_UNREACHABLE' });
    expect(mdns.stops[0]).toHaveBeenCalledOnce();
    expect(mdns.fake.destroy).toHaveBeenCalledOnce();
});

it.each([0, -1, 1.5, NaN, Infinity, 2147483648])('rejects invalid duration %s', async durationMs => {
    const factory = vi.fn();
    await expect(discoverDevices({ durationMs, createBrowser: factory })).rejects.toMatchObject({ code: 'USAGE' });
    expect(factory).not.toHaveBeenCalled();
});
