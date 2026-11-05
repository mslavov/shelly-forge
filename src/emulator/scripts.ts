import { SCRIPT_MAX_BYTES } from '../core/runtime-profile.js';
import { isRecord } from '../core/validation.js';
import type { DeviceState } from '../testing/device-state.js';
import { createScriptEngine, type ScriptEngine } from '../testing/engine.js';
import { RpcError, ShellyScriptError } from '../testing/errors.js';
import type { RpcHandler } from '../testing/types.js';
import type { Emulator, EmulatorScript } from './index.js';

interface StoredScript extends EmulatorScript {
    code: string;
    engine?: ScriptEngine;
}

const MAX_CALLBACKS_PER_TIME = 1000;

function integer(value: unknown, name: string, fallback?: number): number {
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new RpcError(-103, `${name} must be a non-negative integer`);
    }
    return value;
}

export class ScriptManager {
    private readonly entries = new Map<number, StoredScript>();
    private readonly published: Array<Emulator['mqtt']['published'][number]> = [];
    private readonly publishedCounts = new WeakMap<ScriptEngine, number>();
    private readonly engineIds = new Map<ScriptEngine, number>();
    private readonly callbacks = new Map<number, { action: () => void; immediate: NodeJS.Immediate }>();
    private readonly workCounts = new WeakMap<ScriptEngine, { time: number; count: number }>();
    private nextCallbackId = 1;
    private unsubscribePublicationObserver?: () => void;
    private mqttConnected = true;

    constructor(
        private readonly device: DeviceState,
        private readonly log: (level: number, data: string) => void,
        private readonly callRpc: (method: string, params: Record<string, unknown>) => unknown,
        private readonly now: () => number,
        private readonly rpc?: Record<string, RpcHandler>,
    ) {}

    private schedule(script: StoredScript, engine: ScriptEngine, callback: () => void): void {
        const id = this.nextCallbackId++;
        const action = () => {
            if (script.engine !== engine || !script.running || !this.takeWork(script, engine)) return;
            this.run(script.id, engine, callback);
        };
        this.callbacks.set(id, { action, immediate: setImmediate(() => this.runCallback(id)) });
    }

    private runCallback(id: number): void {
        const callback = this.callbacks.get(id);
        this.callbacks.delete(id);
        if (callback) {
            clearImmediate(callback.immediate);
            callback.action();
        }
    }

    flushCallbacks(): void {
        while (this.callbacks.size) this.runCallback(this.callbacks.keys().next().value!);
    }

    private crash(script: StoredScript, error: unknown): void {
        if (!script.running) return;
        const failure = error instanceof ShellyScriptError ? error : new ShellyScriptError(error);
        script.running = false;
        script.errors = ['crashed'];
        script.error_msg = failure.message;
        script.engine?.dispose();
        this.log(0, `script:${script.id} crashed: ${failure.message}`);
    }

    private takeWork(script: StoredScript, engine: ScriptEngine): boolean {
        const time = this.now();
        const previous = this.workCounts.get(engine);
        const count = previous?.time === time ? previous.count + 1 : 1;
        this.workCounts.set(engine, { time, count });
        if (count <= MAX_CALLBACKS_PER_TIME) return true;
        this.crash(script, new Error(`Script exceeded ${MAX_CALLBACKS_PER_TIME} callbacks at one emulated time`));
        return false;
    }

    private collectEnginePublications(scriptId: number, engine: ScriptEngine): void {
        const messages = engine.runtime.mqtt.published;
        const previous = this.publishedCounts.get(engine) ?? 0;
        for (let index = Math.max(previous, messages.length - 1000); index < messages.length; index++) {
            this.published.push({ scriptId, ...messages[index] });
        }
        if (this.published.length > 1000) this.published.splice(0, this.published.length - 1000);
        this.publishedCounts.set(engine, messages.length);
    }

    private collectPublications(): void {
        for (const [engine, id] of this.engineIds) this.collectEnginePublications(id, engine);
    }

    private run<T>(scriptId: number, engine: ScriptEngine, action: () => T): T {
        try { return action(); }
        finally { this.collectEnginePublications(scriptId, engine); }
    }

    private deliver(action: (engine: ScriptEngine) => void): void {
        for (const script of this.entries.values()) {
            if (!script.running || !script.engine) continue;
            const engine = script.engine;
            try { this.run(script.id, engine, () => action(engine)); } catch {}
        }
    }

    advertise(result: Record<string, unknown>): void {
        this.deliver(engine => engine.runtime.ble.advertise(result));
    }

    receive(topic: string, message: string): void {
        this.deliver(engine => engine.runtime.mqtt.receive(topic, message));
    }

    setConnected(connected: boolean): void {
        this.mqttConnected = connected;
        this.deliver(engine => engine.runtime.mqtt.setConnected(connected));
    }

    mqttPublished(): Emulator['mqtt']['published'] {
        this.collectPublications();
        return this.published.map(message => ({ ...message }));
    }

    list(): EmulatorScript[] {
        return [...this.entries.values()].map(({ id, name, enable, running, errors, error_msg }) => ({
            id, name, enable, running, ...(errors ? { errors: [...errors], error_msg } : {}),
        }));
    }

    private get(params: Record<string, unknown>): StoredScript {
        const id = integer(params.id, 'id');
        const script = this.entries.get(id);
        if (!script) throw new RpcError(-105, `Script not found: ${id}`);
        return script;
    }

    private stop(script: StoredScript): void {
        if (script.engine) {
            this.collectEnginePublications(script.id, script.engine);
            this.engineIds.delete(script.engine);
        }
        script.engine?.dispose();
        script.engine = undefined;
        script.running = false;
    }

    private start(script: StoredScript): void {
        delete script.errors;
        delete script.error_msg;
        script.running = true;
        const engine = createScriptEngine({
            device: this.device, scriptId: script.id, now: this.now(),
            rpc: this.rpc, mqttConnected: this.mqttConnected,
            executionTimeoutMs: 1000, recordHistory: false,
            maxCallbacksPerAdvance: MAX_CALLBACKS_PER_TIME,
            scheduleRpc: callback => this.schedule(script, engine, callback),
            scheduleCallback: callback => this.schedule(script, engine, callback),
            callRpc: this.callRpc,
            getComponentStatus: component => {
                const match = /^script:(\d+)$/.exec(component);
                return match ? (this.entries.has(Number(match[1])) ? this.status(Number(match[1])) : null) : this.device.getStatus(component);
            },
            onPrint: line => this.log(2, line),
            onCrash: error => this.crash(script, error),
        });
        script.engine = engine;
        this.engineIds.set(engine, script.id);
        this.unsubscribePublicationObserver?.();
        this.unsubscribePublicationObserver = this.device.subscribe({
            status: () => this.collectPublications(),
            event: () => this.collectPublications(),
        });
        try {
            this.run(script.id, engine, () => {
                engine.runtime.load(script.code);
                engine.runtime.flush();
            });
        } catch {
            // The engine records load and queued-call failures through onCrash.
        }
    }

    nextScheduledTime(): number | undefined {
        let next: number | undefined;
        for (const script of this.entries.values()) {
            if (!script.running || !script.engine) continue;
            const at = script.engine.nextScheduledTime();
            if (at !== undefined && (next === undefined || at < next)) next = at;
        }
        return next;
    }

    advanceTo(time: number): void {
        for (const script of this.entries.values()) {
            if (!script.running || !script.engine) continue;
            const engine = script.engine;
            const elapsed = Math.max(0, time - engine.runtime.now());
            try {
                this.run(script.id, engine, () => {
                    if ((engine.nextScheduledTime() ?? Infinity) > time) engine.runtime.advance(elapsed);
                    else if (this.takeWork(script, engine)) engine.runtime.advance(elapsed);
                });
            } catch (error) { this.crash(script, error); }
        }
    }

    stopAll(): void {
        for (const script of this.entries.values()) this.stop(script);
        this.unsubscribePublicationObserver?.();
        this.unsubscribePublicationObserver = undefined;
        for (const callback of this.callbacks.values()) clearImmediate(callback.immediate);
        this.callbacks.clear();
    }

    restartEnabled(): void {
        this.stopAll();
        for (const script of this.entries.values()) if (script.enable) this.start(script);
    }

    status(id: number): Record<string, unknown> {
        const script = this.get({ id });
        return {
            id, running: script.running, mem_used: 0, mem_peak: 0, mem_free: 0, cpu: 0,
            ...(script.errors ? { errors: [...script.errors], error_msg: script.error_msg } : {}),
        };
    }

    call(method: string, params: Record<string, unknown>): unknown {
        if (method === 'Script.List') return { scripts: this.list() };
        if (method === 'Script.Create') {
            if (typeof params.name !== 'string' || !params.name.trim()) throw new RpcError(-103, 'Name is required');
            if (this.entries.size >= 10) throw new RpcError(-108, 'Script limit exceeded (10)');
            let id = 1;
            while (this.entries.has(id)) id++;
            this.entries.set(id, { id, name: params.name, enable: false, running: false, code: '' });
            return { id };
        }
        const script = this.get(params);
        switch (method) {
            case 'Script.Delete':
                this.stop(script);
                this.entries.delete(script.id);
                return {};
            case 'Script.GetConfig':
                return { id: script.id, name: script.name, enable: script.enable };
            case 'Script.SetConfig': {
                const config = params.config;
                if (!isRecord(config) || (config.name !== undefined && (typeof config.name !== 'string' || !config.name.trim()))
                    || (config.enable !== undefined && typeof config.enable !== 'boolean')) throw new RpcError(-103, 'Invalid script config');
                if (typeof config.name === 'string') script.name = config.name;
                if (typeof config.enable === 'boolean') script.enable = config.enable;
                return { restart_required: false };
            }
            case 'Script.PutCode': {
                if (typeof params.code !== 'string' || (params.append !== undefined && typeof params.append !== 'boolean')) {
                    throw new RpcError(-103, 'Invalid code or append flag');
                }
                if (script.running) throw new RpcError(-114, 'Script is running');
                const code = params.append === true ? script.code + params.code : params.code;
                const len = Buffer.byteLength(code);
                if (len > SCRIPT_MAX_BYTES) throw new RpcError(-103, `Script exceeds ${SCRIPT_MAX_BYTES} bytes`);
                script.code = code;
                return { len };
            }
            case 'Script.GetCode': {
                const offset = integer(params.offset, 'offset', 0);
                const len = integer(params.len, 'len', 1024);
                const bytes = Buffer.from(script.code);
                const end = Math.min(bytes.length, offset + len);
                return { data: bytes.subarray(offset, end).toString('utf8'), left: Math.max(0, bytes.length - end) };
            }
            case 'Script.Start': {
                const was_running = script.running;
                if (!was_running) {
                    this.stop(script);
                    this.start(script);
                }
                return { was_running };
            }
            case 'Script.Stop':
                if (!script.running) throw new RpcError(-114, 'Script is not running');
                this.stop(script);
                return { was_running: true };
            case 'Script.GetStatus':
                return this.status(script.id);
            case 'Script.Eval':
                if (!script.running || !script.engine) throw new RpcError(-114, 'Script is not running');
                if (typeof params.code !== 'string') throw new RpcError(-103, 'Code is required');
                try {
                    const engine = script.engine;
                    return this.run(script.id, engine, () => {
                        const result = engine.evaluate(params.code as string, { stringify: true });
                        try { engine.runtime.flush(); } catch {}
                        return { result };
                    });
                } catch (error) {
                    throw new RpcError(-103, error instanceof Error ? error.message : 'Evaluation failed');
                }
            default:
                throw new RpcError(404, `No handler for ${method}`);
        }
    }
}
