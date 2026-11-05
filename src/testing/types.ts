import type { ShellyScriptError } from './errors.js';

export interface ShellyRuntimeOptions {
    now?: number;
    kvs?: Record<string, string>;
    components?: Record<string, { status?: Record<string, unknown>; config?: Record<string, unknown> }>;
    rpc?: Record<string, RpcHandler>;
    deviceInfo?: Record<string, unknown>;
    mqttConnected?: boolean;
    strictBuiltins?: boolean;
}

// RPC payloads are caller-defined JSON, including custom methods with no declared schema.
export type RpcHandler = (params: any, runtime: ShellyRuntime) => unknown;

export interface ShellyRuntime {
    load(code: string, options?: { filename?: string }): void;
    loadArtifact(path: string): Promise<void>;
    loadScript(srcPath: string, options?: { projectDir?: string; env?: NodeJS.ProcessEnv }): Promise<void>;
    now(): number;
    advance(ms: number): void;
    flush(): void;
    setStatus(component: string, delta: Record<string, unknown>): void;
    emitEvent(component: string, info: Record<string, unknown>): void;
    readonly crashed: ShellyScriptError | undefined;
    readonly calls: ReadonlyArray<{ method: string; params: unknown }>;
    readonly logs: ReadonlyArray<string>;
    kvs: { get(key: string): string | undefined; entries(): Record<string, string> };
    mqtt: {
        receive(topic: string, message: string): void;
        setConnected(connected: boolean): void;
        readonly published: ReadonlyArray<{ topic: string; message: string; qos: number; retain: boolean }>;
    };
    http: {
        request(endpoint: string, request?: { method?: string; query?: string; body?: string; headers?: [string, string][] }):
            { code: number; body: string; headers: [string, string][] };
    };
    ble: { advertise(result: Record<string, unknown>): void };
}

export type ScriptCallback = (...args: unknown[]) => unknown;

export interface ScriptHost {
    now(): number;
    invoke(callback: ScriptCallback, args: unknown[]): unknown;
    wrap(callback: ScriptCallback): ScriptCallback;
    toScript<T>(value: T): T;
    schedule(delay: number, callback: () => void): number;
    cancel(handle: number): boolean;
}
