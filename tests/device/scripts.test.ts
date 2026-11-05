import { afterEach, describe, expect, it } from 'vitest';
import { RpcClient } from '../../src/device/rpc-client.js';
import { DeviceScripts, getDeviceInfo, setDebugWebsocket } from '../../src/device/scripts.js';
import { startFakeDevice, type FakeDevice, type FakeDeviceOptions } from '../helpers/fake-device.js';

const devices: FakeDevice[] = [];
async function setup(options?: FakeDeviceOptions) {
    const fake = await startFakeDevice(options);
    devices.push(fake);
    const rpc = new RpcClient({ host: fake.host, username: 'admin', password: options?.password });
    return { fake, rpc, scripts: new DeviceScripts(rpc) };
}
afterEach(async () => {
    await Promise.all(devices.splice(0).map(device => device.close()));
});

describe('DeviceScripts', () => {
    it('creates, finds, configures, starts, evaluates, and stops a script', async () => {
        const { fake, scripts } = await setup({ password: 'secret' });
        const id = await scripts.create('example');
        expect(await scripts.findByName('example')).toEqual({ id, name: 'example', enable: false, running: false });
        expect(await scripts.findByName('absent')).toBeUndefined();
        await scripts.setConfig(id, { name: 'renamed', enable: true });
        await scripts.putCode(id, 'let value = 2;');
        await scripts.start(id);
        expect(await scripts.eval(id, '1 + 2')).toEqual({ result: '3' });
        expect(await scripts.getStatus(id)).toMatchObject({ id, running: true, mem_used: 128 });
        await scripts.stop(id);
        await scripts.stop(id);
        expect(fake.scripts.get(id)).toMatchObject({ name: 'renamed', enable: true, running: false });
        expect(fake.requests.find(request => request.method === 'Script.SetConfig')?.params).toEqual({ id, config: { name: 'renamed', enable: true } });
    });

    it('does not hide other stop errors', async () => {
        const { scripts } = await setup();
        await expect(scripts.stop(99)).rejects.toMatchObject({ code: 'DEVICE_RPC', details: { code: 404 } });
    });

    it('uploads 1025 characters as replace then append and reports bytes', async () => {
        const { fake, scripts } = await setup({ scripts: [{ id: 1, name: 'example', code: 'old' }] });
        const progress: number[][] = [];
        await scripts.putCode(1, 'a'.repeat(1025), { onProgress: (sent, total) => progress.push([sent, total]) });
        expect(fake.requests.map(request => request.params)).toEqual([
            { id: 1, code: 'a'.repeat(1024), append: false },
            { id: 1, code: 'a', append: true },
        ]);
        expect(progress).toEqual([[1024, 1025], [1025, 1025]]);
        expect(fake.scripts.get(1)?.code).toBe('a'.repeat(1025));
    });

    it('preserves non-ASCII code and reports UTF-8 byte counts', async () => {
        const { fake, scripts } = await setup({ scripts: [{ id: 1, name: 'example' }] });
        const code = 'a'.repeat(1023) + '😀' + 'é';
        const progress: number[][] = [];
        await scripts.putCode(1, code, { onProgress: (sent, total) => progress.push([sent, total]) });
        expect(fake.scripts.get(1)?.code).toBe(code);
        expect(progress).toEqual([[1023, 1029], [1029, 1029]]);
    });

    it('supports custom chunk sizes without splitting a surrogate pair', async () => {
        const { fake, scripts } = await setup({ scripts: [{ id: 1, name: 'example' }] });
        await scripts.putCode(1, '😀a', { chunkSize: 1 });
        expect(fake.requests.filter(request => request.method === 'Script.PutCode').map(request => request.params.code)).toEqual(['😀', 'a']);
    });

    it.each(['é', '😀', '\uFFFD'])('checks the returned upload length for code starting with %s', async prefix => {
        const { fake, scripts } = await setup({ scripts: [{ id: 1, name: 'example' }] });
        const code = `${prefix}print("hello");`;
        await scripts.putCode(1, code);
        expect(fake.scripts.get(1)?.code).toBe(code);
        expect(fake.requests.map(request => request.method)).toEqual(['Script.PutCode']);
    });

    it('restarts the whole upload after an append is applied and its response is dropped', async () => {
        const { fake, scripts } = await setup({ scripts: [{ id: 1, name: 'example' }] });
        const progress: number[] = [];
        await scripts.putCode(1, 'a'.repeat(1025), { onProgress: sent => {
            progress.push(sent);
            if (progress.length === 1) fake.setFailure('Script.PutCode', { type: 'apply-then-drop' });
        } });
        expect(fake.requests.map(request => request.params)).toEqual([
            { id: 1, code: 'a'.repeat(1024), append: false },
            { id: 1, code: 'a', append: true },
            { id: 1, code: 'a'.repeat(1024), append: false },
            { id: 1, code: 'a', append: true },
        ]);
        expect(progress).toEqual([1024, 1024, 1025]);
        expect(fake.scripts.get(1)?.code).toBe('a'.repeat(1025));
    });

    it('fails after two upload retries', async () => {
        const { fake, scripts } = await setup({ scripts: [{ id: 1, name: 'example' }], failures: { 'Script.PutCode': { type: 'drop', times: 3 } } });
        await expect(scripts.putCode(1, 'code')).rejects.toMatchObject({ code: 'DEVICE_UNREACHABLE' });
        expect(fake.requests).toHaveLength(3);
        expect(fake.scripts.get(1)?.code).toBe('');
    });

    it('does not restart after an explicit RPC rejection', async () => {
        const { fake, scripts } = await setup({ scripts: [{ id: 1, name: 'example' }], failures: { 'Script.PutCode': { type: 'rpc', code: -104, message: 'Too large', times: Infinity } } });
        await expect(scripts.putCode(1, 'code')).rejects.toMatchObject({ code: 'DEVICE_RPC' });
        expect(fake.requests).toHaveLength(1);
    });

    it('restarts at most twice even when the RPC client enables network retries', async () => {
        const { fake } = await setup({ scripts: [{ id: 1, name: 'example' }], failures: { 'Script.PutCode': { type: 'apply-then-drop', times: Infinity } } });
        const scripts = new DeviceScripts(new RpcClient({ host: fake.host, username: 'admin' }, { retries: 4 }));
        await expect(scripts.putCode(1, 'code')).rejects.toMatchObject({ code: 'DEVICE_UNREACHABLE' });
        expect(fake.requests).toHaveLength(3);
        expect(fake.scripts.get(1)?.code).toBe('code');
    });

    it('reports a stored byte length mismatch after uploading', async () => {
        const methods: string[] = [];
        const rpc = new RpcClient({ host: 'localhost', username: 'admin' }, {
            fetch: async (_input, init) => {
                const frame = JSON.parse(String(init?.body));
                methods.push(frame.method);
                return new Response(JSON.stringify({ id: frame.id, result: { len: 7 } }));
            },
        });
        await expect(new DeviceScripts(rpc).putCode(1, 'é😀'))
            .rejects.toMatchObject({
                code: 'DEVICE_RPC', message: 'Uploaded script length mismatch: expected 6 bytes, device stored 7 bytes',
                details: { method: 'Script.PutCode', id: 1, expectedBytes: 6, storedBytes: 7 },
            });
        expect(methods).toEqual(['Script.PutCode']);
    });

    it.each([-1, 0.5, '4', null])('rejects a malformed upload length: %j', async len => {
        const rpc = new RpcClient({ host: 'localhost', username: 'admin' }, {
            fetch: async (_input, init) => {
                const frame = JSON.parse(String(init?.body));
                return new Response(JSON.stringify({ id: frame.id, result: { len } }));
            },
        });
        await expect(new DeviceScripts(rpc).putCode(1, 'code')).rejects.toMatchObject({
            code: 'DEVICE_RPC', message: 'Invalid result for Script.PutCode',
        });
    });

    it.each([
        { code: 'é😀', data: '\uFFFD', left: 5 },
        { code: 'é😀', data: 'é', left: 4 },
        { code: 'print()', data: 'p', left: 6 },
    ])('falls back to the stored byte count when upload length is absent: %j', async ({ code, data, left }) => {
        const methods: string[] = [];
        const rpc = new RpcClient({ host: 'localhost', username: 'admin' }, {
            fetch: async (_input, init) => {
                const frame = JSON.parse(String(init?.body));
                methods.push(frame.method);
                if (frame.method === 'Script.GetCode') expect(frame.params).toEqual({ id: 1, offset: 0, len: 1 });
                return new Response(JSON.stringify({ id: frame.id, result: frame.method === 'Script.PutCode' ? {} : { data, left } }));
            },
        });
        await expect(new DeviceScripts(rpc).putCode(1, code)).resolves.toBeUndefined();
        expect(methods).toEqual(['Script.PutCode', 'Script.GetCode']);
    });

    it('rejects an empty stored script when upload length is absent', async () => {
        const rpc = new RpcClient({ host: 'localhost', username: 'admin' }, {
            fetch: async (_input, init) => {
                const frame = JSON.parse(String(init?.body));
                return new Response(JSON.stringify({ id: frame.id, result: frame.method === 'Script.PutCode' ? {} : { data: '', left: 0 } }));
            },
        });
        await expect(new DeviceScripts(rpc).putCode(1, 'code')).rejects.toMatchObject({
            code: 'DEVICE_RPC', details: { method: 'Script.GetCode', expectedBytes: 4, storedBytes: 0 },
        });
    });

    it.each([{ data: 'a', left: -1 }, { data: 'a', left: 0.5 }, { data: null, left: 3 }, { data: 'a' }])('rejects a malformed length response: %j', async result => {
        const rpc = new RpcClient({ host: 'localhost', username: 'admin' }, {
            fetch: async (_input, init) => {
                const frame = JSON.parse(String(init?.body));
                return new Response(JSON.stringify({ id: frame.id, result: frame.method === 'Script.PutCode' ? {} : result }));
            },
        });
        await expect(new DeviceScripts(rpc).putCode(1, 'code')).rejects.toMatchObject({ code: 'DEVICE_RPC' });
    });

    it('rejects empty code and invalid chunk sizes before making requests', async () => {
        const { fake, scripts } = await setup();
        await expect(scripts.putCode(1, '')).rejects.toMatchObject({ code: 'USAGE' });
        for (const chunkSize of [0, -1, 0.5, Infinity]) {
            await expect(scripts.putCode(1, 'code', { chunkSize })).rejects.toMatchObject({ code: 'USAGE' });
        }
        expect(fake.requests).toHaveLength(0);
    });

    it('reassembles pages using byte offsets until left is zero', async () => {
        const code = 'é😀'.repeat(600);
        const { fake, scripts } = await setup({ scripts: [{ id: 1, name: 'example', code }] });
        expect(await scripts.getCode(1)).toBe(code);
        expect(fake.requests.map(request => request.params)).toEqual([
            { id: 1, offset: 0, len: 1024 }, { id: 1, offset: 1022, len: 1024 },
            { id: 1, offset: 2046, len: 1024 }, { id: 1, offset: 3068, len: 1024 },
        ]);
    });

    it('returns an empty stored script', async () => {
        const { scripts } = await setup({ scripts: [{ id: 1, name: 'example' }] });
        expect(await scripts.getCode(1)).toBe('');
    });

    it('preserves crash details in getStatus and consumes one-shot failures', async () => {
        const { scripts } = await setup({
            scripts: [{ id: 1, name: 'example' }],
            failures: { 'Script.Start': { type: 'crash', scriptId: 1, errors: ['exception'], error_msg: 'Undefined variable' } },
        });
        await scripts.start(1);
        expect(await scripts.getStatus(1)).toMatchObject({ id: 1, running: false, errors: ['exception'], error_msg: 'Undefined variable' });
        await scripts.start(1);
        expect(await scripts.getStatus(1)).toMatchObject({ id: 1, running: true });
        expect((await scripts.getStatus(1)).errors).toBeUndefined();
    });

    it('validates download pages rather than looping on a malformed response', async () => {
        const rpc = new RpcClient({ host: 'localhost', username: 'admin' }, {
            fetch: async () => new Response(JSON.stringify({ id: 1, result: { data: '', left: 1 } })),
        });
        await expect(new DeviceScripts(rpc).getCode(1)).rejects.toMatchObject({ code: 'DEVICE_RPC' });
    });
});

describe('device configuration', () => {
    it('does not change debug config when it already matches', async () => {
        const { fake, rpc } = await setup({ debugWebsocket: true });
        expect(await setDebugWebsocket(rpc, true)).toEqual({ changed: false, restartRequired: false });
        expect(fake.requests.map(request => request.method)).toEqual(['Sys.GetConfig']);
    });

    it('changes debug config in either direction and reports restart requirements', async () => {
        const { fake, rpc } = await setup({ restartRequired: true });
        expect(await setDebugWebsocket(rpc, true)).toEqual({ changed: true, restartRequired: true });
        expect(await setDebugWebsocket(rpc, false)).toEqual({ changed: true, restartRequired: true });
        expect(fake.requests.filter(request => request.method === 'Sys.SetConfig').map(request => request.params)).toEqual([
            { config: { debug: { websocket: { enable: true } } } },
            { config: { debug: { websocket: { enable: false } } } },
        ]);
    });

    it('reads device info', async () => {
        const { rpc } = await setup({ deviceInfo: { id: 'custom-device', gen: 3 } });
        expect(await getDeviceInfo(rpc)).toMatchObject({ id: 'custom-device', gen: 3, app: 'Plus1' });
    });
});
