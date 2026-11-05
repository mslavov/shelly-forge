import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createContext, runInContext, Script } from 'node:vm';
import { bundleScript } from '../build/bundler.js';
import { RESOURCE_LIMITS } from '../core/runtime-profile.js';
import { createBle } from './ble.js';
import { installBuiltins } from './builtins.js';
import { installDate, VirtualClock } from './clock.js';
import { copyJson, scriptBoundary, type ShellyScriptError } from './errors.js';
import { DeviceState } from './device-state.js';
import { createHttp } from './http.js';
import { createMqtt } from './mqtt.js';
import { createScriptRealm } from './realm.js';
import { createRpc, rpcParams } from './rpc.js';
import { createTimers } from './timers.js';
import type { ScriptCallback, ScriptHost, ShellyRuntime, ShellyRuntimeOptions } from './types.js';

function createHandlers(host: ScriptHost, kind: 'eventHandlers' | 'statusHandlers') {
    const handlers = new Map<number, { callback: ScriptCallback; userdata: unknown }>();
    let nextId = 1;
    return {
        clear(): void { handlers.clear(); },
        add(callback: ScriptCallback, userdata?: unknown): number {
            if (typeof callback !== 'function') throw new Error('handler must be a function');
            if (handlers.size >= RESOURCE_LIMITS[kind]) throw new Error(`${kind} limit exceeded (${RESOURCE_LIMITS[kind]})`);
            const id = nextId++;
            handlers.set(id, { callback, userdata });
            return id;
        },
        remove(id: number): boolean | undefined { return Number.isInteger(id) ? handlers.delete(id) : undefined; },
        emit(event: unknown): void {
            for (const [id, handler] of Array.from(handlers)) {
                if (handlers.has(id)) host.invoke(handler.callback, [host.toScript(event), handler.userdata]);
            }
        },
    };
}

export interface ScriptEngineOptions extends ShellyRuntimeOptions {
    device?: DeviceState;
    scriptId?: number;
    executionTimeoutMs?: number;
    maxCallbacksPerAdvance?: number;
    recordHistory?: boolean;
    scheduleRpc?(callback: () => void): void;
    scheduleCallback?(callback: () => void): void;
    callRpc?(method: string, params: Record<string, unknown>): unknown;
    getComponentStatus?(component: string): Record<string, unknown> | null;
    onPrint?(line: string): void;
    onCrash?(error: ShellyScriptError): void;
}

export interface ScriptEngine {
    readonly runtime: ShellyRuntime;
    nextScheduledTime(): number | undefined;
    evaluate(code: string, options?: { stringify?: boolean }): unknown;
    dispose(): void;
}

// Nested device events must distinguish the calling script from other active script frames.
let activeEngine: object | undefined;

export function createScriptEngine(options: ScriptEngineOptions = {}): ScriptEngine {
    if (options.executionTimeoutMs !== undefined
        && (!Number.isInteger(options.executionTimeoutMs) || options.executionTimeoutMs < 1 || options.executionTimeoutMs > 0xffffffff)) {
        throw new Error('executionTimeoutMs must be a positive integer of at most 4294967295 milliseconds');
    }
    if (options.maxCallbacksPerAdvance !== undefined
        && (!Number.isSafeInteger(options.maxCallbacksPerAdvance) || options.maxCallbacksPerAdvance < 1)) {
        throw new Error('maxCallbacksPerAdvance must be a positive safe integer');
    }
    let callbacksInAdvance = 0;
    const identity = {};
    const scriptId = options.scriptId ?? 1;
    const clock = new VirtualClock(options.now ?? Date.UTC(2026, 0, 1));
    const started = clock.now();
    const context = createContext(Object.create(null) as Record<string, unknown>, { name: 'shelly-script' });
    const realm = createScriptRealm(context);
    const invocations: Array<() => unknown> = [];
    const invokeScript = new Script('__forgeInvoke()', { filename: 'shelly-callback.js' });
    if (options.executionTimeoutMs !== undefined) {
        Object.defineProperty(context, '__forgeInvoke', {
            value: realm.wrap(() => invocations[invocations.length - 1]?.()),
        });
    }
    function timed<T>(action: () => T): T {
        if (options.executionTimeoutMs === undefined) return action();
        invocations.push(action);
        try { return invokeScript.runInContext(context, { timeout: options.executionTimeoutMs }) as T; }
        finally { invocations.pop(); }
    }
    const host: ScriptHost = {
        now: () => clock.now(),
        invoke: (callback, args) => !crashed && !disposed ? timed(() => Reflect.apply(callback, undefined, args)) : undefined,
        wrap: realm.wrap,
        toScript: realm.toScript,
        schedule: (delay, callback) => clock.schedule(delay, () => runScript(() => {
            if (options.maxCallbacksPerAdvance !== undefined && ++callbacksInAdvance > options.maxCallbacksPerAdvance) {
                throw new Error(`Script exceeded ${options.maxCallbacksPerAdvance} timer callbacks in one advance`);
            }
            callback();
        })),
        cancel: handle => clock.cancel(handle),
    };
    const device = options.device ?? new DeviceState({
        components: options.components,
        kvs: options.kvs,
        deviceInfo: options.deviceInfo,
        scheduler: {
            now: host.now,
            schedule: host.schedule,
            cancel: handle => clock.cancel(handle as number),
        },
    });
    const eventHandlers = createHandlers(host, 'eventHandlers');
    const statusHandlers = createHandlers(host, 'statusHandlers');
    const mqtt = createMqtt(host, options.mqttConnected ?? true);
    const http = createHttp(host);
    const ble = createBle(host);
    const timers = createTimers(host);
    const logs: string[] = [];
    const storage = new Map<string, string>();
    let crashed: ShellyScriptError | undefined;
    let disposed = false;
    const unsubscribe = device.subscribe({
        status: event => deliver(() => statusHandlers.emit(event)),
        event: event => deliver(() => eventHandlers.emit(event)),
    });

    function enter<T>(action: () => T): T {
        const previous = activeEngine;
        activeEngine = identity;
        try { return action(); } finally { activeEngine = previous; }
    }

    function clear(): void {
        timers.clear();
        clock.clear();
        eventHandlers.clear();
        statusHandlers.clear();
        rpc.clear();
        mqtt.clear();
        http.clear();
        ble.clear();
        unsubscribe();
    }

    function runScript<T>(action: () => T): T {
        const wasCrashed = crashed;
        return scriptBoundary(() => {
            try {
                const result = enter(action);
                if (!wasCrashed && crashed) throw crashed;
                return result;
            } catch (error) {
                throw crashed ?? error;
            }
        }, error => {
            if (crashed || disposed) return;
            crashed = error;
            clear();
            options.onCrash?.(error);
        });
    }

    function deliver(action: () => void): void {
        if (crashed || disposed) return;
        if (activeEngine === identity) {
            action();
        } else if (activeEngine !== undefined && options.scheduleCallback) {
            options.scheduleCallback(() => deliver(action));
        } else {
            // A subscriber's failure must not escape into the script that changed the device.
            try { runScript(action); } catch {}
        }
    }

    function assertRunning(): void {
        if (crashed) throw crashed;
        if (disposed) throw new Error('Script engine is disposed');
    }

    function kvsEntries(): Record<string, string> {
        const result = device.call('KVS.GetMany', {}) as { items: Record<string, { value: unknown }> };
        return Object.fromEntries(Object.entries(result.items).map(([key, item]) =>
            [key, typeof item.value === 'string' ? item.value : JSON.stringify(item.value)]));
    }

    function execute(method: string, value: unknown): unknown {
        const overrideKey = options.rpc && Object.keys(options.rpc).find(key => key.toLowerCase() === method.toLowerCase());
        const override = overrideKey === undefined ? undefined : options.rpc![overrideKey];
        if (override) return override(value, runtime);
        if (options.callRpc) return options.callRpc(method, rpcParams(value));
        return device.call(method, rpcParams(value));
    }

    const rpcHost = options.scheduleRpc ? { ...host, invoke: (callback: ScriptCallback, args: unknown[]) =>
        runScript(() => host.invoke(callback, args)) } : host;
    const rpc = createRpc(rpcHost, execute, {
        recordHistory: options.recordHistory,
        schedule: options.scheduleRpc ? callback => options.scheduleRpc!(() => {
            if (!crashed && !disposed) {
                try { callback(); } catch (error) {
                    try { runScript(() => { throw error; }); } catch {}
                }
            }
        }) : undefined,
    });
    const runtime: ShellyRuntime = {
        load(code, loadOptions) {
            assertRunning();
            runScript(() => timed(() => runInContext(code, context, { filename: loadOptions?.filename ?? 'shelly-script.js' })));
        },
        async loadArtifact(artifactPath) { runtime.load(await readFile(artifactPath, 'utf8'), { filename: artifactPath }); },
        async loadScript(srcPath, loadOptions) {
            const projectDir = path.resolve(loadOptions?.projectDir ?? process.cwd());
            const result = await bundleScript({ projectDir, entry: srcPath, minify: false, env: loadOptions?.env });
            runtime.load(result.code, { filename: path.resolve(projectDir, srcPath) });
        },
        now: () => clock.now(),
        advance(ms) {
            if (crashed || disposed) return;
            callbacksInAdvance = 0;
            clock.advance(ms, () => runScript(rpc.flush));
        },
        flush() { if (!crashed && !disposed) runScript(rpc.flush); },
        setStatus(component, delta) {
            const snapshot = copyJson(delta);
            runScript(() => device.setStatus(component, snapshot));
        },
        emitEvent(component, info) {
            const snapshot = copyJson(info);
            runScript(() => device.emitEvent(component, snapshot));
        },
        get crashed() { return crashed; },
        calls: rpc.calls,
        logs,
        kvs: {
            get: key => { const entries = kvsEntries(); return Object.hasOwn(entries, key) ? entries[key] : undefined; },
            entries: kvsEntries,
        },
        mqtt: {
            ...mqtt.control,
            receive: (topic, message) => runScript(() => mqtt.control.receive(topic, message)),
            setConnected: connected => runScript(() => mqtt.control.setConnected(connected)),
        },
        http: { request: (endpoint, request) => runScript(() => http.control.request(endpoint, request)) },
        ble: { advertise: result => runScript(() => ble.control.advertise(result)) },
    };

    const componentKey = (typeOrKey: string, id?: number) => id === undefined ? typeOrKey : `${typeOrKey}:${id}`;
    const print = (...values: unknown[]) => {
        assertRunning();
        const parts: string[] = [];
        for (const value of values) parts.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value));
        const line = parts.join(' ');
        if (options.recordHistory !== false) logs.push(line);
        options.onPrint?.(line);
    };
    realm.expose({
        Shelly: {
            call: rpc.call,
            addEventHandler: eventHandlers.add, removeEventHandler: eventHandlers.remove,
            addStatusHandler: statusHandlers.add, removeStatusHandler: statusHandlers.remove,
            emitEvent: (name: string, data: unknown) => {
                assertRunning();
                device.emitEvent(`script:${scriptId}`, { event: name, data });
                assertRunning();
            },
            getComponentStatus: (typeOrKey: string, id?: number) => host.toScript(options.getComponentStatus
                ? options.getComponentStatus(componentKey(typeOrKey, id)) : device.getStatus(componentKey(typeOrKey, id))),
            getComponentConfig: (typeOrKey: string, id?: number) => host.toScript(device.getConfig(componentKey(typeOrKey, id))),
            getDeviceInfo: () => host.toScript(device.deviceInfo), getCurrentScriptId: () => scriptId,
            getUptimeMs: () => clock.now() - started,
        },
        Script: {
            id: scriptId,
            getVcHandle: () => null,
            storage: {
                get length() { return storage.size; },
                getItem: (key: string) => storage.get(String(key)) ?? null,
                setItem: (key: string, value: string) => { storage.set(String(key), String(value)); },
                removeItem: (key: string) => { storage.delete(String(key)); },
                clear: () => storage.clear(),
                key: (index: number) => Array.from(storage.keys())[index] ?? null,
            },
        },
        Virtual: { getHandle: () => null },
        Timer: timers.api, MQTT: mqtt.api, HTTPServer: http.api, BLE: ble.api,
        print, console: { log: print }, btoa, atob,
        btoh: (value: string) => Buffer.from(value, 'latin1').toString('hex'),
    });
    installDate(context, host.now);
    installBuiltins(context, options.strictBuiltins !== false);
    return {
        runtime,
        nextScheduledTime: () => clock.nextScheduledTime(),
        evaluate(code, evaluateOptions) {
            assertRunning();
            return scriptBoundary(() => enter(() => timed(() => {
                const result = runInContext(code, context, { filename: 'shelly-eval.js' });
                return evaluateOptions?.stringify ? String(result) : result;
            })), () => {});
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            clear();
        },
    };
}
