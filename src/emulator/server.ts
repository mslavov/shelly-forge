import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP, type Socket } from 'node:net';
import { ForgeError } from '../core/errors.js';
import { parseDeviceUrl } from '../core/hosts.js';
import { createLogger } from '../core/logger.js';
import { DEBUG_LOG_PATH } from '../core/runtime-profile.js';
import { isRecord } from '../core/validation.js';
import { DeviceState } from '../testing/device-state.js';
import { copyJson, RpcError } from '../testing/errors.js';
import { EmulatorClock } from './clock.js';
import { DigestVerifier } from './digest.js';
import type { Emulator, EmulatorOptions } from './index.js';
import { LogBroadcaster } from './logs.js';
import { publishMdns } from './mdns.js';
import { RpcRouter } from './rpc.js';
import { ScriptManager } from './scripts.js';

const MAX_BODY_BYTES = 64 * 1024 + 4096;

function isLoopback(bind: string): boolean {
    return bind.toLowerCase() === 'localhost' || (isIP(bind) === 4 && bind.startsWith('127.'))
        || (isIP(bind) === 6 && new URL(`http://[${bind}]`).hostname === '[::1]');
}

function validateOptions(options: EmulatorOptions): void {
    if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) {
        throw new ForgeError('USAGE', '--port must be an integer between 0 and 65535');
    }
    if (options.switches !== undefined && (!Number.isInteger(options.switches) || options.switches < 0 || options.switches > 4)) {
        throw new ForgeError('USAGE', '--switches must be an integer between 0 and 4');
    }
    const bind = options.bind ?? '127.0.0.1';
    try {
        const url = parseDeviceUrl(isIP(bind) === 6 ? `[${bind}]` : bind);
        if (typeof bind !== 'string' || !bind || url.port || url.pathname !== '/') throw new Error('Invalid address');
    } catch { throw new ForgeError('USAGE', '--bind must be a hostname or IP address without a port'); }
    if (options.password !== undefined && typeof options.password !== 'string') throw new ForgeError('USAGE', 'Password must be a string');
    if (options.mdns !== undefined && typeof options.mdns !== 'boolean') throw new ForgeError('USAGE', 'mdns must be a boolean');
    if (!isLoopback(bind) && !options.password) {
        throw new ForgeError('USAGE', 'A password is required for a non-loopback emulator bind', {
            hint: 'Set SHELLY_EMULATOR_PASSWORD before using --bind with a non-loopback address.',
        });
    }
    if (options.mdns && isLoopback(bind)) {
        throw new ForgeError('USAGE', 'Multicast DNS requires a non-loopback emulator bind', {
            hint: 'Use --bind 0.0.0.0 and set SHELLY_EMULATOR_PASSWORD to enable --mdns.',
        });
    }
    if (options.kvs !== undefined && (!isRecord(options.kvs) || Object.values(options.kvs).some(value => typeof value !== 'string'))) {
        throw new ForgeError('USAGE', 'KVS must be a JSON object of string values');
    }
    if (options.components !== undefined && (!isRecord(options.components) || Object.entries(options.components).some(([key, value]) =>
        !/^[a-z][a-z0-9]*(?::(?:0|[1-9]\d*))?$/.test(key) || !isRecord(value)
        || Object.entries(value).some(([field, data]) => !['status', 'config'].includes(field) || !isRecord(data))))) {
        throw new ForgeError('USAGE', 'Components must map component keys to objects with optional status and config objects');
    }
    if (options.rpc !== undefined && (!isRecord(options.rpc) || Object.values(options.rpc).some(handler => typeof handler !== 'function'))) {
        throw new ForgeError('USAGE', 'RPC overrides must map method names to functions');
    }
    if (options.deviceInfo !== undefined) {
        if (!isRecord(options.deviceInfo)) throw new ForgeError('USAGE', 'Device info must be an object');
        for (const key of ['id', 'mac', 'model', 'app', 'ver', 'fw_id'] as const) {
            const value = options.deviceInfo[key];
            if (value !== undefined && (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value))) {
                throw new ForgeError('USAGE', `Device ${key} must be a non-empty string without control characters`);
            }
        }
        if (options.deviceInfo.gen !== undefined && (!Number.isInteger(options.deviceInfo.gen) || options.deviceInfo.gen < 2)) {
            throw new ForgeError('USAGE', 'Device gen must be an integer of at least 2');
        }
    }
}

export async function startEmulator(options: EmulatorOptions = {}): Promise<Emulator> {
    validateOptions(options);
    const bind = options.bind ?? '127.0.0.1';
    const clock = new EmulatorClock();
    const connections = new Set<Socket>();
    const responses = new Set<ServerResponse>();
    const components = Object.fromEntries(Array.from({ length: options.switches ?? 1 }, (_, id) => [`switch:${id}`, {
        status: { id, output: false, source: 'init' }, config: { id, name: null, initial_state: 'off' },
    }]));
    let device: DeviceState;
    try {
        device = new DeviceState({
            components: { ...components, ...options.components }, kvs: options.kvs,
            deviceInfo: { id: 'shelly-emulator', model: 'SNSW-001X16EU', app: 'Plus1', ...options.deviceInfo, auth_en: Boolean(options.password) },
            scheduler: {
                now: () => clock.now(),
                schedule: (delay, callback) => clock.schedule(delay, callback),
                cancel: handle => clock.cancel(handle as number),
            },
        });
    } catch (cause) { throw new ForgeError('USAGE', 'Invalid initial emulator state', { cause }); }
    const logger = options.logger ?? createLogger({ level: 'info', logFile: null });
    const logs = new LogBroadcaster(options.onLog, () => clock.now());
    const scripts = new ScriptManager(device, (level, data) => logs.send(level, data), (method, params): unknown => router.call(method, params), () => clock.now(), options.rpc);
    const auth = new DigestVerifier(String(device.deviceInfo.id), options.password);
    let closed = false;
    let closing: Promise<void> | undefined;
    let rebooting: Promise<void> | undefined;
    let rebootTimer: number | undefined;
    let finishReboot: (() => void) | undefined;
    const reboot = (): Promise<void> => {
        if (closed) return Promise.resolve();
        if (rebooting) return rebooting;
        rebooting = new Promise<void>(resolve => {
            finishReboot = resolve;
            rebootTimer = clock.schedule(500, () => {
                rebootTimer = undefined;
                logs.disconnect();
                scripts.restartEnabled();
                rebooting = undefined;
                finishReboot = undefined;
                resolve();
            });
        });
        return rebooting;
    };
    const router = new RpcRouter(device, scripts, () => { void reboot(); });

    function advanceTime(ms: number): void {
        const end = clock.now() + ms;
        scripts.flushCallbacks();
        while (!closed) {
            const next = Math.min(end, clock.nextScheduledTime() ?? end, scripts.nextScheduledTime() ?? end);
            clock.setTime(Math.max(clock.now(), next));
            scripts.advanceTo(clock.now());
            clock.runDue();
            scripts.flushCallbacks();
            if (clock.now() >= end && (clock.nextScheduledTime() ?? Infinity) > end
                && (scripts.nextScheduledTime() ?? Infinity) > end) return;
        }
    }

    function json(response: ServerResponse, status: number, value: unknown): void {
        if (response.writableEnded) return;
        response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    }

    function authorized(request: IncomingMessage, response: ServerResponse, frame?: Record<string, unknown>): boolean {
        const header = request.headers.authorization;
        if (auth.verify(header ?? frame?.auth, request.method ?? 'GET', request.url ?? '/', header !== undefined)) return true;
        response.writeHead(401, { 'WWW-Authenticate': auth.challenge() }).end();
        return false;
    }

    function dispatch(method: string, params: Record<string, unknown>): { result: unknown } | { error: { code: number; message: string } } {
        try {
            options.onRpc?.(method);
            if (closed) throw new RpcError(503, 'Emulator is closed');
            return { result: router.call(method, params) };
        } catch (error) {
            return { error: { code: error instanceof RpcError ? error.code : -32603,
                message: error instanceof RpcError ? error.message : 'Internal emulator error' } };
        }
    }

    function forbidden(request: IncomingMessage): boolean {
        return request.headers.origin !== undefined || (isLoopback(bind)
            && !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(request.headers.host ?? ''));
    }

    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        if (closed) { response.writeHead(503, { Connection: 'close' }).end(); return; }
        if (forbidden(request)) { response.writeHead(403, { Connection: 'close' }).end(); return; }
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (request.method === 'GET' && url.pathname === '/shelly') {
            json(response, 200, device.deviceInfo);
        } else if (request.method === 'GET' && url.pathname === DEBUG_LOG_PATH) {
            if (!router.debugEnabled) { response.writeHead(403).end(); return; }
            if (authorized(request, response)) response.writeHead(426).end();
        } else if (request.method === 'GET' && url.pathname.startsWith('/rpc/')) {
            if (!authorized(request, response)) return;
            const params: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
            for (const [key, value] of url.searchParams) {
                try { params[key] = JSON.parse(value); } catch { params[key] = value; }
            }
            const result = dispatch(decodeURIComponent(url.pathname.slice(5)), params);
            if ('error' in result) json(response, result.error.code === 404 ? 404 : 500, result.error);
            else json(response, 200, result.result);
        } else if (request.method === 'POST' && url.pathname === '/rpc') {
            const parts: Buffer[] = [];
            let length = 0;
            for await (const part of request) {
                if (closed) { if (!response.writableEnded) response.writeHead(503, { Connection: 'close' }).end(); return; }
                const bytes = Buffer.from(part);
                length += bytes.length;
                if (length > MAX_BODY_BYTES) { response.writeHead(413, { Connection: 'close' }).end(); return; }
                parts.push(bytes);
            }
            if (closed) { if (!response.writableEnded) response.writeHead(503, { Connection: 'close' }).end(); return; }
            let frame: unknown;
            try { frame = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { response.writeHead(400).end(); return; }
            if (!isRecord(frame) || typeof frame.method !== 'string'
                || (frame.params !== undefined && !isRecord(frame.params))
                || (frame.src !== undefined && typeof frame.src !== 'string')
                || (frame.id !== undefined && typeof frame.id !== 'number' && typeof frame.id !== 'string')) {
                response.writeHead(400).end();
                return;
            }
            if (!authorized(request, response, frame)) return;
            json(response, 200, { id: frame.id ?? null, src: device.deviceInfo.id, dst: frame.src ?? '',
                ...dispatch(frame.method, frame.params ?? {}) });
        } else {
            response.writeHead(404).end();
        }
    }

    const server = createServer((request, response) => {
        responses.add(response);
        response.once('close', () => responses.delete(response));
        void handle(request, response).catch(() => {
            if (!response.headersSent && !response.destroyed) response.writeHead(closed ? 503 : 400).end();
        });
    });
    server.on('connection', socket => {
        connections.add(socket);
        socket.once('close', () => connections.delete(socket));
    });
    server.on('upgrade', (request, socket, head) => {
        const refuse = (status: string, challenge?: string) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n${challenge ? `WWW-Authenticate: ${challenge}\r\n` : ''}\r\n`);
        socket.on('error', () => {});
        if (closed) { refuse('503 Service Unavailable'); return; }
        if (forbidden(request)) { refuse('403 Forbidden'); return; }
        if (request.url !== DEBUG_LOG_PATH) { refuse('404 Not Found'); return; }
        if (!router.debugEnabled) { refuse('403 Forbidden'); return; }
        if (!auth.verify(request.headers.authorization, 'GET', DEBUG_LOG_PATH, true)) { refuse('401 Unauthorized', auth.challenge()); return; }
        logs.sockets.handleUpgrade(request, socket, head, ws => logs.sockets.emit('connection', ws));
    });

    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(options.port ?? 0, bind, () => { server.off('error', reject); resolve(); });
        });
    } catch (cause) {
        await logs.close();
        throw new ForgeError('USAGE', `Could not listen for emulator connections on ${bind}`, {
            hint: 'Use --port <n> to choose another port, or --port 0 for a free port.', cause,
        });
    }
    const address = server.address();
    if (!address || typeof address === 'string') throw new ForgeError('INTERNAL', 'Emulator did not bind a TCP port');
    const host = `${isIP(bind) === 6 ? `[${bind}]` : bind}:${address.port}`;
    let realtimeAt = performance.now();
    const ticker = setInterval(() => {
        const now = performance.now();
        const elapsed = Math.max(0, Math.floor(now - realtimeAt));
        realtimeAt += elapsed;
        advanceTime(elapsed);
    }, 20);
    ticker.unref();
    const unpublish = options.mdns ? publishMdns(address.port, device.deviceInfo, logger, options.createPublisher) : async () => {};

    return {
        host,
        advance(ms) {
            if (!Number.isFinite(ms) || !Number.isInteger(ms) || ms < 0 || !Number.isFinite(clock.now() + ms)) {
                throw new TypeError('advance requires a finite non-negative integer of milliseconds');
            }
            if (closed) return;
            advanceTime(ms);
            realtimeAt = performance.now();
        },
        setStatus(component, delta) {
            if (closed) return;
            if (typeof component !== 'string' || !isRecord(delta)) throw new ForgeError('USAGE', 'Status requires a component and an object');
            device.setStatus(component, delta);
        },
        emitEvent(component, info) {
            if (closed) return;
            if (typeof component !== 'string' || !isRecord(info)) throw new ForgeError('USAGE', 'Event requires a component and an object');
            device.emitEvent(component, info);
        },
        ble: {
            advertise(result) {
                if (closed) return;
                if (!isRecord(result)) throw new ForgeError('USAGE', 'BLE advertisement must be an object');
                scripts.advertise(copyJson(result));
            },
        },
        mqtt: {
            receive(topic, message) {
                if (closed) return;
                if (typeof topic !== 'string' || !topic || /[\0+#]/.test(topic) || typeof message !== 'string') {
                    throw new ForgeError('USAGE', 'MQTT receive requires a non-empty topic without NUL or wildcards and a string message');
                }
                scripts.receive(topic, message);
            },
            setConnected(connected) {
                if (closed) return;
                if (typeof connected !== 'boolean') throw new ForgeError('USAGE', 'MQTT connection state must be a boolean');
                scripts.setConnected(connected);
            },
            get published() { return scripts.mqttPublished(); },
        },
        scripts: () => scripts.list(),
        reboot,
        close() {
            if (closing) return closing;
            closed = true;
            clearInterval(ticker);
            if (rebootTimer !== undefined) clock.cancel(rebootTimer);
            finishReboot?.();
            scripts.stopAll();
            clock.clear();
            closing = (async () => {
                const stopped = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
                for (const response of responses) {
                    if (!response.headersSent && !response.destroyed) response.writeHead(503, { Connection: 'close' }).end();
                }
                for (const socket of connections) socket.destroySoon();
                await Promise.all([stopped, logs.close(), unpublish()]);
            })();
            return closing;
        },
    };
}
