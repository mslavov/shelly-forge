import { expect, test, vi } from 'vitest';
import { createDigestAuth, parseDigestChallenge } from '../../src/device/digest-auth.js';
import { RpcClient } from '../../src/device/rpc-client.js';
import { setDebugWebsocket } from '../../src/device/scripts.js';
import { DigestVerifier } from '../../src/emulator/digest.js';
import { fixture, logs, upgradeStatus } from './helpers.js';

test('authenticates the existing RPC and websocket clients with the same device password', async () => {
    const { emulator, rpc, scripts, target } = await fixture({ password: 'test-password' });
    expect(await rpc.call('Shelly.GetDeviceInfo')).toMatchObject({ id: 'shelly-emulator', auth_en: true });
    expect(await fetch(`http://${emulator.host}/shelly`).then(r => r.json())).toMatchObject({ auth_en: true });
    await setDebugWebsocket(rpc, true);
    const stream = logs(target);
    await stream.connected;
    const id = await scripts.create('auth');
    await scripts.putCode(id, 'print("authenticated");');
    await scripts.start(id);
    await expect.poll(() => stream.lines.map(line => line.message)).toContain('authenticated');
    const wrong = new RpcClient({ ...target, password: 'wrong' });
    await expect(wrong.call('Script.List')).rejects.toMatchObject({ code: 'DEVICE_AUTH' });
    const wrongLogs = logs({ ...target, password: 'wrong' });
    await expect(wrongLogs.connected).rejects.toMatchObject({ code: 'DEVICE_AUTH' });
    await expect(wrongLogs.finished).rejects.toMatchObject({ code: 'DEVICE_AUTH' });
});

test('accepts HTTP and legacy frame digests but refuses nonce count replay', async () => {
    const { emulator, target } = await fixture({ password: 'test-password' });
    const url = `http://${emulator.host}/rpc`;
    const frame = { id: 9, src: 'test', method: 'Script.List', params: {} };
    const post = (auth?: unknown) => fetch(url, { method: 'POST', body: JSON.stringify({ ...frame, auth }) });
    const challengeResponse = await post();
    expect(challengeResponse.status).toBe(401);
    const challenge = parseDigestChallenge(challengeResponse.headers.get('www-authenticate'));
    const auth = createDigestAuth(target, challenge, 1, 123, { method: 'POST', uri: '/rpc' });
    const response = await post(auth);
    expect(await response.json()).toEqual({ id: 9, src: 'shelly-emulator', dst: 'test', result: { scripts: [] } });
    expect((await post(auth)).status).toBe(401);
    expect((await post(createDigestAuth(target, challenge, 2, 123))).status).toBe(200);
    const bad = createDigestAuth(target, challenge, 3, 123, { method: 'GET', uri: '/wrong' });
    expect((await post(bad)).status).toBe(401);
});

test('accepts digest Authorization for GET, POST and websocket upgrade and rejects wrong password with 401', async () => {
    const { emulator, target, rpc } = await fixture({ password: 'test-password' });
    await setDebugWebsocket(rpc, true);
    for (const [method, uri] of [['GET', '/rpc/Switch.GetStatus?id=0'], ['POST', '/rpc'], ['GET', '/debug/log']]) {
        const url = `http://${emulator.host}${uri}`;
        const request = method === 'POST' ? { method, body: JSON.stringify({ id: 1, method: 'Script.List' }) } : { method };
        const response = await fetch(url, request);
        expect(response.status).toBe(401);
        const challenge = parseDigestChallenge(response.headers.get('www-authenticate'));
        const header = (password: string, count: number) => {
            const auth = createDigestAuth({ ...target, password }, challenge, count, 55, { method, uri });
            return `Digest username="admin", realm="${auth.realm}", nonce="${auth.nonce}", uri="${uri}", algorithm=SHA-256, qop=auth, nc=${auth.nc}, cnonce="${auth.cnonce}", response="${auth.response}"`;
        };
        if (uri === '/debug/log') {
            expect(await upgradeStatus(emulator.host, header('wrong', 1))).toBe(401);
            expect(await upgradeStatus(emulator.host, header('test-password', 1))).toBe(101);
            expect(await upgradeStatus(emulator.host, header('test-password', 1))).toBe(401);
        } else {
            expect((await fetch(url, { ...request, headers: { Authorization: header('wrong', 1) } })).status).toBe(401);
            expect((await fetch(url, { ...request, headers: { Authorization: header('test-password', 1) } })).status).toBe(200);
            expect((await fetch(url, { ...request, headers: { Authorization: header('test-password', 1) } })).status).toBe(401);
        }
    }
});

test('an explicitly empty password leaves authentication disabled', async () => {
    const { emulator, rpc } = await fixture({ password: '' });
    expect((await fetch(`http://${emulator.host}/rpc/Script.List`)).status).toBe(200);
    expect(await fetch(`http://${emulator.host}/shelly`).then(response => response.json())).toMatchObject({ auth_en: false });
    expect(await rpc.call('Script.List')).toEqual({ scripts: [] });
});

test('unauthenticated challenge floods evict only unused nonces and preserve replay and expiry checks', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    try {
        const verifier = new DigestVerifier('test', 'password');
        const target = { username: 'admin', password: 'password', host: '127.0.0.1' };
        const active = parseDigestChallenge(verifier.challenge());
        const unused = parseDigestChallenge(verifier.challenge());
        const auth = (challenge: typeof active, count: number) => createDigestAuth(target, challenge, count, 123, { method: 'POST', uri: '/rpc' });
        expect(verifier.verify(auth(active, 1), 'POST', '/rpc')).toBe(true);
        for (let i = 0; i < 1100; i++) verifier.challenge();
        expect(verifier.verify(auth(unused, 1), 'POST', '/rpc')).toBe(false);
        expect(verifier.verify(auth(active, 2), 'POST', '/rpc')).toBe(true);
        expect(verifier.verify(auth(active, 2), 'POST', '/rpc')).toBe(false);
        now.mockReturnValue(301_000);
        expect(verifier.verify(auth(active, 3), 'POST', '/rpc')).toBe(false);
        verifier.challenge();
        expect(verifier.verify(auth(active, 3), 'POST', '/rpc')).toBe(false);
    } finally { now.mockRestore(); }
});
