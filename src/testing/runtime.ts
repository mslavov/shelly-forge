import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { bundleScript } from '../build/bundler.js';
import { RESOURCE_LIMITS } from '../core/runtime-profile.js';
import { createBle } from './ble.js';
import { installBuiltins } from './builtins.js';
import { installDate, VirtualClock } from './clock.js';
import { copyJson, RpcError, scriptBoundary, type ShellyScriptError } from './errors.js';
import { createHttp } from './http.js';
import { KvsStore } from './kvs.js';
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
        emit(event: Record<string, unknown>): void {
            for (const [id, handler] of Array.from(handlers)) {
                if (handlers.has(id)) host.invoke(handler.callback, [host.toScript(event), handler.userdata]);
            }
        },
    };
}

function componentIdentity(component: string): { component: string; name: string; id: number } {
    const colon = component.indexOf(':');
    return { component, name: colon < 0 ? component : component.slice(0, colon), id: colon < 0 ? 0 : Number(component.slice(colon + 1)) };
}

export function createShellyRuntime(options: ShellyRuntimeOptions = {}): ShellyRuntime {
    const clock = new VirtualClock(options.now ?? Date.UTC(2026, 0, 1));
    const started = clock.now();
    const context = createContext(Object.create(null) as Record<string, unknown>, { name: 'shelly-script' });
    const realm = createScriptRealm(context);
    const host: ScriptHost = {
        now: () => clock.now(),
        invoke: (callback, args) => Reflect.apply(callback, undefined, args),
        wrap: realm.wrap,
        toScript: realm.toScript,
        schedule: (delay, callback) => clock.schedule(delay, () => runScript(callback)),
        cancel: handle => clock.cancel(handle),
    };
    const components = new Map(Object.entries(copyJson(options.components ?? {})));
    const deviceInfo = {
        id: 'shelly-simulator', mac: '000000000000', model: 'simulator', gen: 2,
        fw_id: 'simulator', ver: '0.0.0', app: 'simulator', auth_en: false, auth_domain: null,
        ...copyJson(options.deviceInfo ?? {}),
    };
    const kvs = new KvsStore(options.kvs ?? {});
    const eventHandlers = createHandlers(host, 'eventHandlers');
    const statusHandlers = createHandlers(host, 'statusHandlers');
    const mqtt = createMqtt(host, options.mqttConnected ?? true);
    const http = createHttp(host);
    const ble = createBle(host);
    const timers = createTimers(host);
    const logs: string[] = [];
    const switchTimers = new Map<string, number>();
    const storage = new Map<string, string>();
    let crashed: ShellyScriptError | undefined;

    function runScript<T>(action: () => T): T {
        return scriptBoundary(action, error => {
            if (crashed) return;
            crashed = error;
            timers.clear();
            clock.clear();
            switchTimers.clear();
            eventHandlers.clear();
            statusHandlers.clear();
            rpc.clear();
            mqtt.clear();
            http.clear();
            ble.clear();
        });
    }

    function sysStatus(): Record<string, unknown> {
        return {
            mac: deviceInfo.mac, restart_required: false, time: new Date(clock.now()).toISOString().slice(11, 16),
            unixtime: Math.floor(clock.now() / 1000), uptime: Math.floor((clock.now() - started) / 1000),
            ram_size: 0, ram_free: 0, fs_size: 0, fs_free: 0, cfg_rev: 0, kvs_rev: kvs.rev, available_updates: {},
            ...components.get('sys')?.status,
        };
    }

    function setStatus(component: string, delta: Record<string, unknown>): void {
        const existing = components.get(component) ?? {};
        const snapshot = copyJson(delta);
        components.set(component, { ...existing, status: { ...existing.status, ...snapshot } });
        statusHandlers.emit({ ...componentIdentity(component), delta: snapshot });
    }

    function emitEvent(component: string, info: Record<string, unknown>): void {
        const identity = componentIdentity(component);
        eventHandlers.emit({ ...identity, info: { component, id: identity.id, ts: clock.now() / 1000, ...copyJson(info) } });
    }

    function execute(method: string, value: unknown): unknown {
        const override = options.rpc && Object.hasOwn(options.rpc, method) ? options.rpc[method] : undefined;
        if (override) return override(value, runtime);
        const params = rpcParams(value);
        if (['KVS.Set', 'KVS.Get', 'KVS.GetMany', 'KVS.List', 'KVS.Delete'].includes(method)) return kvs.call(method, params);
        if (method === 'Shelly.GetDeviceInfo') return copyJson(deviceInfo);
        if (method === 'Sys.GetStatus') return sysStatus();
        if (method === 'Switch.GetStatus' || method === 'Switch.Set' || method === 'Switch.Toggle') {
            if (typeof params.id !== 'number' || !Number.isInteger(params.id) || params.id < 0) throw new RpcError(-103, 'id must be a non-negative integer');
            const component = `switch:${params.id}`;
            const state = components.get(component)?.status;
            if (!state) throw new RpcError(-105, `Bad id=${params.id}`);
            if (method === 'Switch.GetStatus') return { id: params.id, source: 'script', ...copyJson(state) };
            if (method === 'Switch.Set' && typeof params.on !== 'boolean') throw new RpcError(-103, 'on must be a boolean');
            if (params.toggle_after !== undefined && (typeof params.toggle_after !== 'number' || !Number.isFinite(params.toggle_after) || params.toggle_after < 0)) {
                throw new RpcError(-103, 'toggle_after must be a finite non-negative number');
            }
            if (params.tag !== undefined && params.tag !== null && (typeof params.tag !== 'string' || params.tag.length > 20)) {
                throw new RpcError(-103, 'tag must be null or a string of at most 20 characters');
            }
            const was_on = state.output === true;
            const output = method === 'Switch.Toggle' ? !was_on : params.on as boolean;
            const previousTimer = switchTimers.get(component);
            if (previousTimer !== undefined) clock.cancel(previousTimer);
            switchTimers.delete(component);
            if (typeof params.toggle_after === 'number' && params.toggle_after > 0) {
                switchTimers.set(component, host.schedule(params.toggle_after * 1000, () => {
                    switchTimers.delete(component);
                    setStatus(component, { output: !output, source: 'timer' });
                }));
            }
            setStatus(component, { id: params.id, output, source: 'script', ...(params.tag !== undefined ? { tag: params.tag } : {}) });
            return { was_on };
        }
        throw new RpcError(-114, `method not simulated: ${method}`);
    }

    const rpc = createRpc(host, execute);
    const runtime: ShellyRuntime = {
        load(code, loadOptions) {
            if (crashed) throw crashed;
            runScript(() => runInContext(code, context, { filename: loadOptions?.filename ?? 'shelly-script.js' }));
        },
        async loadArtifact(artifactPath) { runtime.load(await readFile(artifactPath, 'utf8'), { filename: artifactPath }); },
        async loadScript(srcPath, loadOptions) {
            const projectDir = path.resolve(loadOptions?.projectDir ?? process.cwd());
            const result = await bundleScript({ projectDir, entry: srcPath, minify: false, env: loadOptions?.env });
            runtime.load(result.code, { filename: path.resolve(projectDir, srcPath) });
        },
        now: () => clock.now(),
        advance(ms) { if (!crashed) clock.advance(ms, () => runScript(rpc.flush)); },
        flush() { if (!crashed) runScript(rpc.flush); },
        setStatus(component, delta) {
            const snapshot = copyJson(delta);
            runScript(() => setStatus(component, snapshot));
        },
        emitEvent(component, info) {
            const snapshot = copyJson(info);
            runScript(() => emitEvent(component, snapshot));
        },
        get crashed() { return crashed; },
        calls: rpc.calls,
        logs,
        kvs: { get: key => kvs.get(key), entries: () => kvs.entries() },
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
        const parts: string[] = [];
        for (const value of values) parts.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value));
        logs.push(parts.join(' '));
    };
    realm.expose({
        Shelly: {
            call: rpc.call,
            addEventHandler: eventHandlers.add, removeEventHandler: eventHandlers.remove,
            addStatusHandler: statusHandlers.add, removeStatusHandler: statusHandlers.remove,
            emitEvent: (name: string, data: unknown) => emitEvent('script:1', { event: name, data }),
            getComponentStatus: (typeOrKey: string, id?: number) => {
                const key = componentKey(typeOrKey, id);
                return host.toScript(key === 'sys' ? sysStatus() : components.get(key)?.status ?? null);
            },
            getComponentConfig: (typeOrKey: string, id?: number) => host.toScript(components.get(componentKey(typeOrKey, id))?.config ?? null),
            getDeviceInfo: () => host.toScript(deviceInfo), getCurrentScriptId: () => 1,
            getUptimeMs: () => clock.now() - started,
        },
        Script: {
            id: 1,
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
    return runtime;
}
