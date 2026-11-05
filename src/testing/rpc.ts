import { RESOURCE_LIMITS } from '../core/runtime-profile.js';
import { copyJson, RpcError } from './errors.js';
import type { ScriptCallback, ScriptHost, ShellyRuntime } from './types.js';

interface PendingCall { method: string; params: unknown; callback?: ScriptCallback; userdata?: unknown }

function isRpcError(value: unknown): value is RpcError {
    try { return value instanceof RpcError; } catch { return false; }
}

export function rpcParams(value: unknown): Record<string, unknown> {
    if (value === null || value === undefined) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw new RpcError(-103, 'params must be an object');
    return value as Record<string, unknown>;
}

export function createRpc(host: ScriptHost, execute: (method: string, params: unknown) => unknown) {
    const calls: Array<ShellyRuntime['calls'][number]> = [];
    const pending: PendingCall[] = [];
    let flushing = false;
    return {
        calls,
        clear(): void { pending.length = 0; },
        call(method: string, params?: unknown, callback?: ScriptCallback, userdata?: unknown): void {
            if (typeof method !== 'string') throw new Error('RPC method must be a string');
            if (callback !== undefined && typeof callback !== 'function') throw new Error('RPC callback must be a function');
            if (pending.length >= RESOURCE_LIMITS.inFlightCalls) {
                throw new Error(`inFlightCalls limit exceeded (${RESOURCE_LIMITS.inFlightCalls})`);
            }
            const snapshot = copyJson(params);
            calls.push({ method, params: copyJson(snapshot) });
            pending.push({ method, params: snapshot, callback, userdata });
        },
        flush(): void {
            if (flushing) return;
            flushing = true;
            try {
                for (;;) {
                    const call = pending.shift();
                    if (!call) break;
                    let result: unknown;
                    let errorCode = 0;
                    let errorMessage = '';
                    try {
                        result = execute(call.method, call.params);
                    } catch (error) {
                        if (!isRpcError(error)) throw error;
                        result = null;
                        errorCode = error.code;
                        errorMessage = error.message;
                    }
                    if (call.callback) host.invoke(call.callback, [host.toScript(result), errorCode, errorMessage, call.userdata]);
                }
            } finally {
                flushing = false;
            }
        },
    };
}
