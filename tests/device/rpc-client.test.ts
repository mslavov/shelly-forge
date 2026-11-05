import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/core/logger.js';
import { RpcClient } from '../../src/device/rpc-client.js';
import { startFakeDevice, type FakeDevice, type FakeDeviceOptions } from '../helpers/fake-device.js';

const devices: FakeDevice[] = [];
async function device(options?: FakeDeviceOptions): Promise<FakeDevice> {
    const result = await startFakeDevice(options);
    devices.push(result);
    return result;
}
afterEach(async () => {
    await Promise.all(devices.splice(0).map(item => item.close()));
});

describe('RpcClient', () => {
    it('posts RPC frames with distinct IDs and returns the result', async () => {
        const fake = await device();
        const rpc = new RpcClient({ host: fake.host, username: 'admin' });
        expect(await rpc.call('Script.Create', { name: 'example' })).toEqual({ id: 1 });
        expect(await rpc.call('Script.List')).toEqual({ scripts: [{ id: 1, name: 'example', running: false, enable: false }] });
        expect(fake.requests).toEqual([
            { id: 1, src: 'shelly-forge', method: 'Script.Create', params: { name: 'example' } },
            { id: 2, src: 'shelly-forge', method: 'Script.List', params: {} },
        ]);
    });

    it('maps RPC errors without retrying them', async () => {
        const fake = await device({ failures: { 'Script.List': { type: 'rpc', code: -104, message: 'Out of memory', times: Infinity } } });
        const rpc = new RpcClient({ host: fake.host, username: 'admin' }, { retries: 2 });
        await expect(rpc.call('Script.List')).rejects.toMatchObject({
            code: 'DEVICE_RPC', details: { method: 'Script.List', code: -104, message: 'Out of memory' },
        });
        expect(fake.requests).toHaveLength(1);
    });

    it('maps a dropped connection and names the host in the hint', async () => {
        const fake = await device({ failures: { 'Script.List': { type: 'drop' } } });
        const rpc = new RpcClient({ host: fake.host, username: 'admin' });
        await expect(rpc.call('Script.List')).rejects.toMatchObject({ code: 'DEVICE_UNREACHABLE', hint: expect.stringContaining(fake.host) });
        expect(fake.requests).toHaveLength(1);
    });

    it('retries only unreachable requests and honors call overrides', async () => {
        const fake = await device({ failures: { 'Script.List': { type: 'drop', times: 2 } } });
        const rpc = new RpcClient({ host: fake.host, username: 'admin' });
        await expect(rpc.call('Script.List', {}, { retries: 2 })).resolves.toEqual({ scripts: [] });
        expect(fake.requests).toHaveLength(3);
        expect(new Set(fake.requests.map(request => request.id)).size).toBe(1);
    });

    it('honors constructor retries and can disable them per call', async () => {
        const fake = await device({ failures: { 'Script.List': { type: 'drop', times: 2 } } });
        const rpc = new RpcClient({ host: fake.host, username: 'admin' }, { retries: 2 });
        await expect(rpc.call('Script.List', {}, { retries: 0 })).rejects.toMatchObject({ code: 'DEVICE_UNREACHABLE' });
        await expect(rpc.call('Script.List')).resolves.toEqual({ scripts: [] });
        expect(fake.requests).toHaveLength(3);
    });

    it('maps timeouts to DEVICE_UNREACHABLE', async () => {
        const fake = await device({ failures: { 'Script.List': { type: 'delay', ms: 500 } } });
        const rpc = new RpcClient({ host: fake.host, username: 'admin' }, { timeoutMs: 50 });
        await expect(rpc.call('Script.List')).rejects.toMatchObject({ code: 'DEVICE_UNREACHABLE' });
    });

    it('waits two seconds before retrying HTTP 429 without using the network retry budget', async () => {
        const sleep = vi.fn(async () => {});
        const fetcher = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response('Busy', { status: 429 }))
            .mockResolvedValueOnce(new Response('Busy', { status: 429 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1, result: { scripts: [] } })));
        const rpc = new RpcClient({ host: '127.0.0.1', username: 'admin' }, { fetch: fetcher, sleep, retries: 0 });
        await expect(rpc.call('Script.List')).resolves.toEqual({ scripts: [] });
        expect(sleep.mock.calls).toEqual([[2000], [2000]]);
        expect(fetcher).toHaveBeenCalledTimes(3);
        expect(new Set(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).id)).size).toBe(1);
    });

    it('stops after two HTTP 429 retries even when network retries remain', async () => {
        const sleep = vi.fn(async () => {});
        const fetcher = vi.fn<typeof fetch>(async () => new Response('Busy', { status: 429 }));
        const rpc = new RpcClient({ host: '127.0.0.1', username: 'admin' }, { fetch: fetcher, sleep, retries: 10 });
        await expect(rpc.call('Script.List')).rejects.toMatchObject({
            code: 'DEVICE_RPC', message: expect.stringContaining('HTTP 429'), details: { httpStatus: 429 },
        });
        expect(sleep).toHaveBeenCalledTimes(2);
        expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it('retries HTTP 429 during digest authentication', async () => {
        const sleep = vi.fn(async () => {});
        const fake = await device({ password: 'secret' });
        let throttled = false;
        const rpc = new RpcClient({ host: fake.host, username: 'admin', password: 'secret' }, {
            sleep,
            fetch: async (input, init) => {
                if (!throttled && JSON.parse(String(init?.body)).auth) {
                    throttled = true;
                    return new Response('Busy', { status: 429 });
                }
                return fetch(input, init);
            },
        });
        await expect(rpc.call('Script.List')).resolves.toEqual({ scripts: [] });
        expect(sleep).toHaveBeenCalledWith(2000);
        expect(fake.requests[1].auth?.nc).toBe('00000002');
    });

    it('uses a per-call timeout instead of the default', async () => {
        const fake = await device({ failures: { 'Script.List': { type: 'delay', ms: 500 } } });
        const rpc = new RpcClient({ host: fake.host, username: 'admin' }, { timeoutMs: 1000 });
        await expect(rpc.call('Script.List', {}, { timeoutMs: 50 })).rejects.toMatchObject({ code: 'DEVICE_UNREACHABLE' });
    });

    it('authenticates with a digest frame and reuses its nonce with an increasing count', async () => {
        const fake = await device({ password: 'secret' });
        const rpc = new RpcClient({ host: fake.host, username: 'admin', password: 'secret' });
        await rpc.call('Script.List');
        await rpc.call('Shelly.GetDeviceInfo');
        expect(fake.requests).toHaveLength(3);
        expect(fake.requests[0].auth).toBeUndefined();
        expect(fake.requests[1].auth).toMatchObject({ realm: 'shelly-fake-device', username: 'admin', nc: '00000001', algorithm: 'SHA-256' });
        expect(fake.requests[2].auth).toMatchObject({ nonce: fake.requests[1].auth!.nonce, nc: '00000002' });
    });

    it('refreshes a cached challenge after a later 401', async () => {
        const fake = await device({ password: 'secret' });
        const rpc = new RpcClient({ host: fake.host, username: 'admin', password: 'secret' });
        await rpc.call('Script.List');
        fake.setFailure('Script.List', { type: 'auth' });
        await expect(rpc.call('Script.List')).resolves.toEqual({ scripts: [] });
        expect(fake.requests).toHaveLength(4);
        expect(fake.requests[3].auth?.nonce).not.toBe(fake.requests[1].auth?.nonce);
        expect(fake.requests[3].auth?.nc).toBe('00000001');
    });

    it.each([undefined, 'wrong'])('reports a missing or wrong password without network retries: %s', async password => {
        const fake = await device({ password: 'secret' });
        const rpc = new RpcClient({ host: fake.host, username: 'admin', password }, { retries: 3 });
        await expect(rpc.call('Script.List')).rejects.toMatchObject({ code: 'DEVICE_AUTH', hint: expect.stringContaining('SHELLY_PASSWORD') });
        expect(fake.requests).toHaveLength(password === undefined ? 1 : 3);
    });

    it('falls back to the legacy digest form once and keeps using it', async () => {
        const fake = await device({ password: 'secret', authMode: 'legacy' });
        const rpc = new RpcClient({ host: fake.host, username: 'admin', password: 'secret' });
        await expect(rpc.call('Script.List')).resolves.toEqual({ scripts: [] });
        await expect(rpc.call('Shelly.GetDeviceInfo')).resolves.toBeDefined();
        expect(fake.requests).toHaveLength(4);
        expect(fake.requests[3].auth?.nonce).toBe(fake.requests[2].auth?.nonce);
    });

    it('supports an explicitly empty password', async () => {
        const fake = await device({ password: '' });
        const rpc = new RpcClient({ host: fake.host, username: 'admin', password: '' });
        await expect(rpc.call('Script.List')).resolves.toEqual({ scripts: [] });
    });

    it('writes only debug messages and never logs credentials, auth, or parameters', async () => {
        const logger: Logger = { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
        const fake = await device({ password: 'a-secret-password' });
        const rpc = new RpcClient({ host: fake.host, username: 'admin', password: 'a-secret-password' }, { logger });
        await rpc.call('Script.List', { password: 'a-parameter-secret' });
        const text = vi.mocked(logger.debug).mock.calls.flat().join('\n');
        expect(text).toContain('Script.List');
        for (const secret of ['a-secret-password', 'a-parameter-secret', 'shelly-fake-device', fake.requests[1].auth!.nonce, fake.requests[1].auth!.response, '"auth"']) {
            expect(text).not.toContain(secret);
        }
        for (const level of ['info', 'success', 'warn', 'error'] as const) expect(logger[level]).not.toHaveBeenCalled();
    });

    it.each([
        new Response('not json'),
        new Response(JSON.stringify({ id: 100, result: {} })),
        new Response(JSON.stringify({ id: 1 })),
        new Response(JSON.stringify({ id: 1, error: { code: 'bad', message: 'bad' } })),
        new Response(JSON.stringify({ id: 1, result: {} }), { status: 503 }),
    ])('rejects malformed or unsuccessful responses', async response => {
        const rpc = new RpcClient({ host: '127.0.0.1', username: 'admin' }, { fetch: async () => response });
        await expect(rpc.call('Script.List')).rejects.toMatchObject({
            code: 'DEVICE_RPC', message: expect.stringContaining(`HTTP ${response.status}`), details: { httpStatus: response.status },
        });
    });

    it.each(['not json', 'null', '{"id":1}', '{"id":99,"result":{}}'])('includes a Gen2+ hint for HTTP 404: %s', async body => {
        const rpc = new RpcClient({ host: '127.0.0.1', username: 'admin' }, {
            fetch: async () => new Response(body, { status: 404 }),
        });
        await expect(rpc.call('Script.List')).rejects.toMatchObject({
            code: 'DEVICE_RPC', message: expect.stringContaining('HTTP 404'),
            details: { method: 'Script.List', httpStatus: 404 }, hint: expect.stringContaining('Gen2+'),
        });
    });

    it('returns null RPC results and disables redirects', async () => {
        const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: 1, result: null })));
        const rpc = new RpcClient({ host: '127.0.0.1', username: 'admin' }, { fetch: fetcher });
        await expect(rpc.call('Script.List')).resolves.toBeNull();
        expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { 'Content-Type': 'application/json' }, signal: expect.any(AbortSignal) });
    });

    it('fails authentication when the HTTP challenge is absent or unsupported', async () => {
        const rpc = new RpcClient({ host: '127.0.0.1', username: 'admin', password: 'secret' }, {
            fetch: async () => new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="x"' } }),
        });
        await expect(rpc.call('Script.List')).rejects.toMatchObject({ code: 'DEVICE_AUTH' });
    });

    it.each(['user:secret@localhost', 'http://localhost', 'localhost/path', 'localhost?password=secret', ' localhost'])('rejects invalid hosts without exposing them: %s', host => {
        expect(() => new RpcClient({ host, username: 'admin' })).toThrow(expect.objectContaining({ code: 'CONFIG' }));
    });

    it.each([{ retries: -1 }, { retries: 0.5 }, { timeoutMs: 0 }, { timeoutMs: NaN }])('rejects invalid options: %j', options => {
        expect(() => new RpcClient({ host: 'localhost', username: 'admin' }, options)).toThrow(expect.objectContaining({ code: 'CONFIG' }));
    });
});
