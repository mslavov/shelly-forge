import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { ForgeError } from '../core/errors.js';
import { parseDeviceUrl } from '../core/hosts.js';
import { RpcClient } from './rpc-client.js';
import { getDeviceInfo } from './scripts.js';

export interface DiscoveryService {
    name: string;
    host?: string;
    port?: number;
    addresses?: string[];
}

export interface DiscoveryBrowser {
    find(options: { type: 'shelly' | 'http'; protocol: 'tcp' }, onUp: (service: DiscoveryService) => void): { stop(): void };
    destroy(): void;
}

export interface DiscoverDevicesOptions {
    durationMs: number;
    signal?: AbortSignal;
    createBrowser?: (onError: (error: Error) => void) => DiscoveryBrowser;
}

export interface DiscoveredDevice {
    name: string;
    host: string;
    model?: string;
    gen?: number;
    app?: string;
    ver?: string;
    fw_id?: string;
    mac?: string;
    auth_en?: boolean;
    authRequired: boolean;
    reachable: boolean;
}

function createBrowser(onError: (error: Error) => void): DiscoveryBrowser {
    // CommonJS named exports from bonjour-service are not available through Node's ESM loader.
    const require = createRequire(import.meta.url);
    const { Bonjour } = require('bonjour-service') as typeof import('bonjour-service');
    return new Bonjour(undefined, onError);
}

function serviceHost(service: DiscoveryService): string | undefined {
    const addresses = Array.isArray(service.addresses) ? service.addresses.filter(address => typeof address === 'string') : [];
    const address = addresses.find(address => isIP(address) === 4)
        ?? addresses.find(address => isIP(address) === 6)
        ?? (typeof service.host === 'string' ? service.host.replace(/\.$/, '') : undefined);
    const port = service.port ?? 80;
    if (!address || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
    try {
        const hostname = isIP(address) === 6 ? `[${address}]` : address;
        const url = parseDeviceUrl(`${hostname}:${port}`);
        if (url.pathname !== '/' || !url.hostname || url.username || url.password) return undefined;
        return url.host;
    } catch {
        return undefined;
    }
}

export async function discoverDevices(options: DiscoverDevicesOptions): Promise<DiscoveredDevice[]> {
    if (!Number.isInteger(options.durationMs) || options.durationMs < 1 || options.durationMs > 2147483647) {
        throw new ForgeError('USAGE', 'Discovery duration must be a positive integer of at most 2147483647 milliseconds');
    }
    if (options.signal?.aborted) return [];
    const failed = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, failed.signal]) : failed.signal;
    const devices = new Map<string, DiscoveredDevice>();
    const pending: Promise<void>[] = [];
    let scanError: ForgeError | undefined;
    const browser = (options.createBrowser ?? createBrowser)(error => {
        scanError = new ForgeError('DEVICE_UNREACHABLE', 'Could not browse for Shelly devices', {
            hint: 'Check that multicast DNS is available on the local network.', cause: error,
        });
        failed.abort();
    });
    const searches: Array<{ stop(): void }> = [];
    let scanning = true;
    let timer: NodeJS.Timeout | undefined;
    let finish: (() => void) | undefined;

    async function enrich(device: DiscoveredDevice): Promise<void> {
        try {
            const rpc = new RpcClient({ host: device.host, username: 'admin' }, {
                timeoutMs: 2000,
                fetch: (input, init) => fetch(input, {
                    ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
                }),
            });
            const info = await getDeviceInfo(rpc);
            device.reachable = true;
            for (const key of ['model', 'app', 'ver', 'fw_id', 'mac'] as const) {
                if (typeof info[key] === 'string') device[key] = info[key];
            }
            if (typeof info.gen === 'number') device.gen = info.gen;
            if (typeof info.auth_en === 'boolean') {
                device.auth_en = info.auth_en;
                device.authRequired = info.auth_en;
            }
        } catch (error) {
            if (error instanceof ForgeError && error.code === 'DEVICE_AUTH') {
                device.authRequired = true;
                device.reachable = true;
            }
        }
    }

    function add(service: DiscoveryService, type: 'shelly' | 'http'): void {
        if (!scanning || signal.aborted || typeof service.name !== 'string' || (type === 'http' && !/shelly/i.test(service.name))) return;
        const host = serviceHost(service);
        if (!host || devices.has(host)) return;
        const device: DiscoveredDevice = { name: service.name, host, authRequired: false, reachable: false };
        devices.set(host, device);
        pending.push(enrich(device));
    }

    try {
        await new Promise<void>(resolve => {
            finish = resolve;
            if (signal.aborted) return resolve();
            signal.addEventListener('abort', finish, { once: true });
            timer = setTimeout(finish, options.durationMs);
            searches.push(browser.find({ type: 'shelly', protocol: 'tcp' }, service => add(service, 'shelly')));
            searches.push(browser.find({ type: 'http', protocol: 'tcp' }, service => add(service, 'http')));
        });
    } catch (error) {
        failed.abort();
        throw new ForgeError('DEVICE_UNREACHABLE', 'Could not browse for Shelly devices', {
            hint: 'Check that multicast DNS is available on the local network.', cause: error,
        });
    } finally {
        scanning = false;
        if (timer) clearTimeout(timer);
        if (finish) signal.removeEventListener('abort', finish);
        for (const search of searches) search.stop();
        browser.destroy();
        await Promise.all(pending);
    }
    if (scanError) throw scanError;
    return [...devices.values()].sort((a, b) => a.host.localeCompare(b.host));
}
