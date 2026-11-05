import WebSocket, { type RawData } from 'ws';
import type { DeviceTarget } from '../core/config.js';
import { ForgeError } from '../core/errors.js';
import { parseDeviceUrl } from '../core/hosts.js';
import type { Logger } from '../core/logger.js';
import { DEBUG_LOG_PATH } from '../core/runtime-profile.js';
import { isRecord } from '../core/validation.js';
import { AUTH_HINT, createDigestAuth, parseDigestChallenge } from './digest-auth.js';

export interface DeviceLogLine {
    device: string;
    ts?: string | number;
    level?: string | number;
    message: string;
    raw: string;
}

export type DeviceLogState = 'connecting' | 'connected' | 'disconnected';

export interface DeviceLogEvent {
    type: 'log';
    device: string;
    ts?: string | number;
    level?: string | number;
    message: string;
}

export interface StreamDeviceLogsOptions {
    signal: AbortSignal;
    onLine(line: DeviceLogLine): void;
    onState?(state: DeviceLogState): void;
    reconnect?: boolean;
    logger?: Logger;
}

export function normalizeDeviceLog(device: string, raw: string): DeviceLogLine {
    const line: DeviceLogLine = { device, message: raw, raw };
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return line;
    }
    if (typeof value === 'string') line.message = value;
    if (!isRecord(value)) return line;
    const message = value.data ?? value.message;
    if (message !== undefined) line.message = typeof message === 'string' ? message : JSON.stringify(message);
    if (typeof value.ts === 'number' || typeof value.ts === 'string') line.ts = value.ts;
    if (typeof value.level === 'number' || typeof value.level === 'string') line.level = value.level;
    return line;
}

export function formatDeviceLogLine(line: DeviceLogLine, label: string = line.device): string {
    return `[${label}] ${line.message}`;
}

export function deviceLogEvent(line: DeviceLogLine): DeviceLogEvent {
    const { device, ts, level, message } = line;
    return { type: 'log', device, ts, level, message };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted) return resolve();
        const done = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        signal.addEventListener('abort', done, { once: true });
    });
}

function authError(host: string): ForgeError {
    return new ForgeError('DEVICE_AUTH', `Log authentication failed for ${host}`, { hint: AUTH_HINT });
}

async function authorization(target: DeviceTarget, url: URL, signal: AbortSignal, challenge?: string): Promise<string | undefined> {
    if (target.password === undefined) throw authError(target.host);
    if (challenge === undefined) {
        let response: Response;
        try {
            response = await fetch(url, {
                signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
                redirect: 'error',
            });
        } catch {
            if (signal.aborted) return undefined;
            throw authError(target.host);
        }
        await response.body?.cancel();
        if (signal.aborted) return undefined;
        if (response.status !== 401) throw authError(target.host);
        challenge = response.headers.get('www-authenticate') ?? undefined;
    }
    if (signal.aborted) return undefined;
    const auth = createDigestAuth(target, parseDigestChallenge(challenge ?? null), 1, undefined, {
        method: 'GET', uri: DEBUG_LOG_PATH,
    });
    const quoted = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    return `Digest username=${quoted(auth.username)}, realm=${quoted(auth.realm)}, nonce=${quoted(auth.nonce)}, `
        + `uri=${quoted(DEBUG_LOG_PATH)}, algorithm=SHA-256, qop=auth, nc=${auth.nc}, `
        + `cnonce=${quoted(String(auth.cnonce))}, response=${quoted(auth.response)}`;
}

interface ConnectionResult {
    kind: 'disconnected' | 'unauthorized' | 'aborted';
    opened: boolean;
    reason?: string;
    challenge?: string;
}

function connect(
    url: URL, target: DeviceTarget, options: StreamDeviceLogsOptions, header?: string,
): Promise<ConnectionResult> {
    return new Promise((resolve, reject) => {
        if (options.signal.aborted) return resolve({ kind: 'aborted', opened: false });
        let opened = false;
        let settled = false;
        const socket = new WebSocket(url, {
            headers: header ? { Authorization: header } : undefined,
            followRedirects: false,
            handshakeTimeout: 5000,
            maxPayload: 1024 * 1024,
        });
        const finish = (kind: ConnectionResult['kind'], error?: unknown, reason?: string, challenge?: string) => {
            if (settled) return;
            settled = true;
            options.signal.removeEventListener('abort', abort);
            socket.removeAllListeners('message');
            socket.removeAllListeners('open');
            socket.terminate();
            try {
                options.onState?.('disconnected');
            } catch (stateError) {
                reject(stateError);
                return;
            }
            if (error !== undefined) reject(error);
            else resolve({ kind, opened, reason, challenge });
        };
        const abort = () => finish('aborted');
        socket.on('open', () => {
            opened = true;
            try {
                options.onState?.('connected');
            } catch (error) {
                finish('disconnected', error);
            }
        });
        socket.on('message', (data: RawData) => {
            const raw = Array.isArray(data) ? Buffer.concat(data).toString() : Buffer.from(data as ArrayBuffer).toString();
            try {
                options.onLine(normalizeDeviceLog(target.host, raw));
            } catch (error) {
                finish('disconnected', error);
            }
        });
        socket.on('unexpected-response', (_request, response) => {
            response.resume();
            const challenge = response.headers['www-authenticate'];
            finish(response.statusCode === 401 ? 'unauthorized' : 'disconnected', undefined,
                `HTTP ${response.statusCode}`, Array.isArray(challenge) ? challenge[0] : challenge);
        });
        socket.on('error', error => finish('disconnected', undefined, error.message));
        socket.on('close', code => finish('disconnected', undefined, `WebSocket closed with code ${code}`));
        options.signal.addEventListener('abort', abort, { once: true });
    });
}

export async function streamDeviceLogs(target: DeviceTarget, options: StreamDeviceLogsOptions): Promise<void> {
    let url: URL;
    try {
        url = parseDeviceUrl(target.host, DEBUG_LOG_PATH);
    } catch {
        throw new ForgeError('CONFIG', 'Invalid device host. Use a hostname or IP address with an optional port.');
    }
    const websocketUrl = new URL(url);
    websocketUrl.protocol = 'ws:';
    const delays = [1000, 2000, 5000, 10000];
    let failures = 0;
    let warned = false;
    const connectionOptions: StreamDeviceLogsOptions = {
        ...options,
        onState(state) {
            if (state === 'connected') warned = false;
            options.onState?.(state);
        },
    };
    const reportFailure = (reason: string) => {
        const message = `Could not stream logs from ${target.host}: ${reason}`;
        if (warned) options.logger?.debug(message);
        else options.logger?.warn(message);
        warned = true;
    };
    while (!options.signal.aborted) {
        options.onState?.('connecting');
        options.logger?.debug(`Connecting to device logs at ${target.host}`);
        let result = await connect(websocketUrl, target, connectionOptions);
        if (result.kind === 'unauthorized' && !options.signal.aborted) {
            let header: string | undefined;
            try {
                header = await authorization(target, url, options.signal, result.challenge);
            } catch (error) {
                if (!options.signal.aborted) reportFailure(result.reason ?? 'HTTP 401');
                throw error;
            }
            if (options.signal.aborted) return;
            options.onState?.('connecting');
            result = await connect(websocketUrl, target, connectionOptions, header);
            if (result.kind === 'unauthorized') {
                reportFailure(result.reason ?? 'HTTP 401');
                throw authError(target.host);
            }
        }
        if (options.signal.aborted || result.kind === 'aborted') return;
        reportFailure(result.reason ?? 'Connection closed');
        if (options.reconnect === false) {
            if (result.opened) return;
            throw new ForgeError('DEVICE_UNREACHABLE', `Could not stream logs from ${target.host}`, {
                hint: `Check that ${target.host} is online and debug websocket logging is enabled.`,
            });
        }
        if (result.opened) failures = 0;
        const delay = delays[Math.min(failures++, delays.length - 1)];
        options.logger?.debug(`Device logs disconnected from ${target.host}; retrying in ${delay} ms`);
        await wait(delay, options.signal);
    }
}
