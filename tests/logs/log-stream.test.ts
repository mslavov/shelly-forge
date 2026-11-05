import { expect, it, onTestFinished, vi } from 'vitest';
import { createLogger, type Logger } from '../../src/core/logger.js';
import {
    deviceLogEvent, formatDeviceLogLine, normalizeDeviceLog, streamDeviceLogs,
    type DeviceLogLine, type DeviceLogState,
} from '../../src/device/log-stream.js';
import { startFakeLogServer, type FakeLogServerOptions } from '../helpers/fake-log-server.js';

async function server(options: FakeLogServerOptions = {}) {
    const result = await startFakeLogServer(options);
    onTestFinished(() => result.close());
    return result;
}

it.each([
    ['plain text', { message: 'plain text' }],
    ['{broken json', { message: '{broken json' }],
    ['"quoted"', { message: 'quoted' }],
    ['{"ts":12,"level":2,"data":"running"}', { ts: 12, level: 2, message: 'running' }],
    ['{"ts":"now","level":"info","message":"ready"}', { ts: 'now', level: 'info', message: 'ready' }],
    ['{"data":{"value":true}}', { message: '{"value":true}' }],
    ['{"ts":{},"level":[]}', { message: '{"ts":{},"level":[]}' }],
    ['null', { message: 'null' }],
])('normalizes %s without losing the raw payload', (raw, expected) => {
    expect(normalizeDeviceLog('device', raw)).toEqual({ device: 'device', raw, ...expected });
});

it('exports text and NDJSON formatters without the raw payload in the event', () => {
    const line = normalizeDeviceLog('device', '{"ts":1,"data":"hello"}');
    expect(formatDeviceLogLine(line)).toBe('[device] hello');
    expect(formatDeviceLogLine(line, 'lights/room')).toBe('[lights/room] hello');
    expect(JSON.parse(JSON.stringify(deviceLogEvent(line)))).toEqual({ type: 'log', device: 'device', ts: 1, message: 'hello' });
});

it('streams JSON and plain text and closes on abort', async () => {
    const fake = await server({ messages: [{ ts: 5, level: 'info', data: 'one' }, 'two'] });
    const controller = new AbortController();
    const lines: DeviceLogLine[] = [];
    const states: DeviceLogState[] = [];
    await streamDeviceLogs({ host: fake.host, username: 'admin' }, {
        signal: controller.signal,
        onState: state => states.push(state),
        onLine(line) {
            lines.push(line);
            if (lines.length === 2) controller.abort();
        },
    });
    expect(lines.map(line => line.message)).toEqual(['one', 'two']);
    expect(lines[0]).toMatchObject({ device: fake.host, ts: 5, level: 'info' });
    expect(states).toEqual(['connecting', 'connected', 'disconnected']);
});

it.each([false, true])('authenticates without logging secrets, with a missing upgrade challenge: %s', async omitUpgradeChallenge => {
    const fake = await server({ password: 'log-secret', messages: ['secured'], omitUpgradeChallenge });
    const output: string[] = [];
    const logger = createLogger({ level: 'verbose', stream: { write: (text: string) => output.push(text) } as unknown as NodeJS.WritableStream });
    const controller = new AbortController();
    const onLine = vi.fn(() => controller.abort());
    await streamDeviceLogs({ host: fake.host, username: 'admin', password: 'log-secret' }, {
        signal: controller.signal, onLine, logger,
    });
    expect(fake.challengeRequests).toBe(omitUpgradeChallenge ? 1 : 0);
    expect(onLine).toHaveBeenCalledWith(expect.objectContaining({ message: 'secured' }));
    expect(output.join('')).not.toMatch(/log-secret|cnonce|response=|Authorization|Digest/);
});

it.each([undefined, 'wrong-password'])('fails with DEVICE_AUTH for password %s', async password => {
    const fake = await server({ password: 'correct-password' });
    const logger: Logger = { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await expect(streamDeviceLogs({ host: fake.host, username: 'admin', password }, {
        signal: new AbortController().signal, onLine() {}, logger,
    })).rejects.toMatchObject({ code: 'DEVICE_AUTH', hint: expect.stringContaining('SHELLY_PASSWORD') });
    expect(fake.connectionCount).toBe(0);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(`Could not stream logs from ${fake.host}: HTTP 401`);
});

it('reports unsupported challenges as DEVICE_AUTH', async () => {
    const fake = await server({ password: 'secret', challengeHeader: 'Basic realm="test"' });
    await expect(streamDeviceLogs({ host: fake.host, username: 'admin', password: 'secret' }, {
        signal: new AbortController().signal, onLine() {},
    })).rejects.toMatchObject({ code: 'DEVICE_AUTH' });
});

it('reconnects after a dropped connection', async () => {
    const fake = await server({ onConnection(socket, count) { socket.send(`connection ${count}`); } });
    const controller = new AbortController();
    const lines: string[] = [];
    const states: DeviceLogState[] = [];
    await streamDeviceLogs({ host: fake.host, username: 'admin' }, {
        signal: controller.signal,
        onState: state => states.push(state),
        onLine(line) {
            lines.push(line.message);
            if (lines.length === 1) fake.dropConnections();
            else controller.abort();
        },
    });
    expect(lines).toEqual(['connection 1', 'connection 2']);
    expect(states).toEqual(['connecting', 'connected', 'disconnected', 'connecting', 'connected', 'disconnected']);
});

it('does not reconnect when disabled', async () => {
    const fake = await server({ messages: ['one'] });
    await streamDeviceLogs({ host: fake.host, username: 'admin' }, {
        signal: new AbortController().signal, reconnect: false,
        onLine() { fake.dropConnections(); },
    });
    expect(fake.connectionCount).toBe(1);
});

it('aborts during reconnect backoff without waiting for the timer', async () => {
    const fake = await server();
    const controller = new AbortController();
    const stream = streamDeviceLogs({ host: fake.host, username: 'admin' }, {
        signal: controller.signal, onLine() {},
        onState(state) { if (state === 'disconnected') controller.abort(); },
    });
    await fake.waitForConnections(1);
    fake.dropConnections();
    await stream;
    expect(fake.connectionCount).toBe(1);
});

it('returns immediately for an already aborted signal', async () => {
    const fake = await server();
    const controller = new AbortController();
    controller.abort();
    await streamDeviceLogs({ host: fake.host, username: 'admin' }, { signal: controller.signal, onLine() {} });
    expect(fake.connectionCount).toBe(0);
});

it('propagates callback errors and releases the connection', async () => {
    const fake = await server({ messages: ['one'] });
    await expect(streamDeviceLogs({ host: fake.host, username: 'admin' }, {
        signal: new AbortController().signal, onLine() { throw new Error('consumer failed'); },
    })).rejects.toThrow('consumer failed');
});

it('fails an unreachable connection when reconnect is disabled', async () => {
    const fake = await server();
    await fake.close();
    await expect(streamDeviceLogs({ host: fake.host, username: 'admin' }, {
        signal: new AbortController().signal, reconnect: false, onLine() {},
    })).rejects.toMatchObject({ code: 'DEVICE_UNREACHABLE' });
});

it('warns with the refused connection reason before failing without reconnect', async () => {
    const fake = await server();
    await fake.close();
    const logger: Logger = { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await expect(streamDeviceLogs({ host: fake.host, username: 'admin' }, {
        signal: new AbortController().signal, reconnect: false, onLine() {}, logger,
    })).rejects.toMatchObject({ code: 'DEVICE_UNREACHABLE' });
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('ECONNREFUSED'));
});

it('warns once with an HTTP status, then logs repeated failures at debug level', async () => {
    const fake = await server({ upgradeStatus: 503 });
    const controller = new AbortController();
    const logger: Logger = {
        info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(),
        debug: vi.fn((message: string) => {
            if (message.includes('Could not stream logs')) controller.abort();
        }),
    };
    await streamDeviceLogs({ host: fake.host, username: 'admin' }, {
        signal: controller.signal, onLine() {}, logger,
    });
    const message = `Could not stream logs from ${fake.host}: HTTP 503`;
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(message);
    expect(logger.debug).toHaveBeenCalledWith(message);
    expect(fake.connectionCount).toBe(0);
});

it('warns again after a successful reconnection and a later outage', async () => {
    const options: FakeLogServerOptions = { upgradeStatus: 503 };
    const fake = await server(options);
    const controller = new AbortController();
    let warnings = 0;
    const logger: Logger = {
        info: vi.fn(), success: vi.fn(), error: vi.fn(),
        warn: vi.fn(() => {
            if (++warnings === 1) delete options.upgradeStatus;
            else controller.abort();
        }),
        debug: vi.fn((message: string) => {
            if (message.includes('Could not stream logs')) controller.abort();
        }),
    };
    await streamDeviceLogs({ host: fake.host, username: 'admin' }, {
        signal: controller.signal, onLine() {}, logger,
        onState(state) {
            if (state === 'connected') fake.dropConnections();
        },
    });
    expect(fake.connectionCount).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenNthCalledWith(1, `Could not stream logs from ${fake.host}: HTTP 503`);
    expect(logger.warn).toHaveBeenNthCalledWith(2, expect.stringContaining('WebSocket closed'));
});

it.each(['http://device', 'user:secret@device', 'device/other', 'device?key=secret'])('rejects invalid host %s', async host => {
    await expect(streamDeviceLogs({ host, username: 'admin' }, {
        signal: new AbortController().signal, onLine() {},
    })).rejects.toMatchObject({ code: 'CONFIG' });
});
