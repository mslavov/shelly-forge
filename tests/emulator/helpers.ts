import { once } from 'node:events';
import { onTestFinished } from 'vitest';
import WebSocket from 'ws';
import { startEmulator, type EmulatorOptions } from '../../src/emulator/index.js';
import { RpcClient } from '../../src/device/rpc-client.js';
import { DeviceScripts } from '../../src/device/scripts.js';
import { streamDeviceLogs, type DeviceLogLine } from '../../src/device/log-stream.js';

export async function fixture(options: EmulatorOptions = {}) {
    const emulator = await startEmulator({ ...options, bind: '127.0.0.1', port: 0 });
    onTestFinished(() => emulator.close());
    const target = { host: emulator.host, username: 'admin', password: options.password };
    const rpc = new RpcClient(target);
    return { emulator, target, rpc, scripts: new DeviceScripts(rpc) };
}

export function logs(target: { host: string; username: string; password?: string }) {
    const controller = new AbortController();
    let resolveConnected: () => void;
    let rejectConnected: (error: unknown) => void;
    const connected = new Promise<void>((resolve, reject) => { resolveConnected = resolve; rejectConnected = reject; });
    const lines: DeviceLogLine[] = [];
    const states: string[] = [];
    const finished = streamDeviceLogs(target, {
        signal: controller.signal, reconnect: false,
        onState(state) {
            states.push(state);
            if (state === 'connected') resolveConnected();
        },
        onLine(line) { lines.push(line); },
    });
    void finished.catch(error => rejectConnected(error));
    onTestFinished(async () => { controller.abort(); await finished.catch(() => {}); });
    return { connected, finished, controller, lines, states };
}

export async function websocket(host: string): Promise<WebSocket> {
    const socket = new WebSocket(`ws://${host}/debug/log`);
    socket.on('error', () => {});
    onTestFinished(() => socket.terminate());
    await once(socket, 'open');
    return socket;
}

export function upgradeStatus(host: string, authorization?: string): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://${host}/debug/log`, { headers: authorization ? { authorization } : undefined });
        socket.on('error', reject);
        socket.on('unexpected-response', (_req, res) => { res.resume(); socket.terminate(); resolve(res.statusCode); });
        socket.on('open', () => { socket.terminate(); resolve(101); });
        onTestFinished(() => socket.terminate());
    });
}
