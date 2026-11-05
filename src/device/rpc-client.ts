import { setTimeout } from 'node:timers/promises';
import type { DeviceTarget } from '../core/config.js';
import { ForgeError } from '../core/errors.js';
import { parseDeviceUrl } from '../core/hosts.js';
import type { Logger } from '../core/logger.js';
import { isRecord } from '../core/validation.js';
import {
    AUTH_HINT, LEGACY_DIGEST_REQUEST, createDigestAuth, parseDigestChallenge, type DigestChallenge, type DigestRequest,
} from './digest-auth.js';

export interface RpcCallOptions {
    timeoutMs?: number;
    retries?: number;
}

export interface RpcClientOptions extends RpcCallOptions {
    logger?: Logger;
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
}

function validateOptions(timeoutMs: number, retries: number): void {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 0xffffffff) {
        throw new ForgeError('CONFIG', 'RPC timeout must be a positive integer of at most 4294967295 milliseconds');
    }
    if (!Number.isSafeInteger(retries) || retries < 0) {
        throw new ForgeError('CONFIG', 'RPC retries must be a non-negative integer');
    }
}

export class RpcClient {
    readonly target: DeviceTarget;
    private readonly endpoint: string;
    private readonly timeoutMs: number;
    private readonly retries: number;
    private readonly logger?: Logger;
    private readonly fetch: typeof fetch;
    private readonly sleep: (ms: number) => Promise<void>;
    private nextId = 1;
    private challenge?: DigestChallenge;
    private nonceCount = 0;
    private digestRequest: DigestRequest;

    constructor(target: DeviceTarget, options: RpcClientOptions = {}) {
        try {
            const endpoint = parseDeviceUrl(target.host, '/rpc');
            this.endpoint = endpoint.href;
            this.digestRequest = { method: 'POST', uri: endpoint.pathname };
        } catch {
            throw new ForgeError('CONFIG', 'Invalid device host. Use a hostname or IP address with an optional port.');
        }
        this.target = Object.freeze({ ...target });
        this.timeoutMs = options.timeoutMs ?? 5000;
        this.retries = options.retries ?? 0;
        validateOptions(this.timeoutMs, this.retries);
        this.logger = options.logger;
        this.fetch = options.fetch ?? globalThis.fetch;
        this.sleep = options.sleep ?? setTimeout;
    }

    async call<T = unknown>(method: string, params: Record<string, unknown> = {}, options: RpcCallOptions = {}): Promise<T> {
        const timeoutMs = options.timeoutMs ?? this.timeoutMs;
        const retries = options.retries ?? this.retries;
        validateOptions(timeoutMs, retries);
        const id = this.nextId++;
        let challenged = false;
        let triedLegacy = false;
        let failures = 0;
        let throttled = 0;
        for (;;) {
            const started = performance.now();
            try {
                const auth = this.challenge
                    ? createDigestAuth(this.target, this.challenge, ++this.nonceCount, undefined, this.digestRequest)
                    : undefined;
                const body = JSON.stringify({ id, src: 'shelly-forge', method, params, ...(auth ? { auth } : {}) });
                this.logger?.debug(`RPC ${method}: ${Buffer.byteLength(body)} request bytes`);
                const response = await this.request(body, timeoutMs);
                if (response.status === 429) {
                    await response.body?.cancel();
                    if (throttled++ >= 2) throw this.invalidResponse(method, response.status);
                    this.logger?.debug(`RPC ${method}: HTTP 429, retrying in 2000 ms`);
                    await this.sleep(2000);
                    continue;
                }
                if (response.status === 401) {
                    await response.body?.cancel();
                    this.challenge = undefined;
                    const canTryLegacy = !triedLegacy && this.digestRequest !== LEGACY_DIGEST_REQUEST;
                    if (this.target.password === undefined || (challenged && !canTryLegacy)) {
                        throw new ForgeError('DEVICE_AUTH', `Authentication failed for ${this.target.host}`, { hint: AUTH_HINT });
                    }
                    if (challenged) {
                        this.digestRequest = LEGACY_DIGEST_REQUEST;
                        triedLegacy = true;
                    }
                    this.challenge = parseDigestChallenge(response.headers.get('www-authenticate'));
                    this.nonceCount = 0;
                    challenged = true;
                    continue;
                }
                return await this.result<T>(response, method, id);
            } catch (error) {
                if (!(error instanceof ForgeError) || error.code !== 'DEVICE_UNREACHABLE' || failures++ >= retries) throw error;
                this.logger?.debug(`RPC ${method}: retry ${failures} of ${retries}`);
            } finally {
                this.logger?.debug(`RPC ${method}: ${Math.round(performance.now() - started)} ms`);
            }
        }
    }

    private unreachable(cause: unknown): ForgeError {
        return new ForgeError('DEVICE_UNREACHABLE', `Could not reach device at ${this.target.host}`, {
            hint: `Check that ${this.target.host} is online and reachable on the local network.`,
            cause,
        });
    }

    private async request(body: string, timeoutMs: number): Promise<Response> {
        try {
            return await this.fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: AbortSignal.timeout(timeoutMs),
                redirect: 'error',
            });
        } catch (error) {
            throw this.unreachable(error);
        }
    }

    private invalidResponse(method: string, status: number): ForgeError {
        return new ForgeError('DEVICE_RPC', `Invalid RPC response for ${method}, HTTP ${status}`, {
            hint: status === 404 ? 'Check the host. It may not be a Gen2+ Shelly device.' : undefined,
            details: { method, code: status, httpStatus: status },
        });
    }

    private async result<T>(response: Response, method: string, id: number): Promise<T> {
        let text: string;
        try {
            text = await response.text();
        } catch (error) {
            throw this.unreachable(error);
        }
        let frame: unknown;
        try {
            frame = JSON.parse(text);
        } catch {
            throw this.invalidResponse(method, response.status);
        }
        if (!isRecord(frame) || frame.id !== id) {
            throw this.invalidResponse(method, response.status);
        }
        if (isRecord(frame.error) && typeof frame.error.code === 'number' && typeof frame.error.message === 'string') {
            const { code, message } = frame.error;
            throw new ForgeError('DEVICE_RPC', `${method} failed: ${message}`, { details: { method, code, message } });
        }
        if (!response.ok || !Object.hasOwn(frame, 'result') || Object.hasOwn(frame, 'error')) {
            throw this.invalidResponse(method, response.status);
        }
        return frame.result as T;
    }
}
