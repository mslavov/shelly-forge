import { copyJson, RpcError } from './errors.js';
import { KvsStore } from './kvs.js';

export interface DeviceScheduler {
    now(): number;
    schedule(delayMs: number, callback: () => void): unknown;
    cancel(handle: unknown): void;
}

export interface DeviceStatusEvent {
    component: string;
    name: string;
    id: number;
    delta: Record<string, unknown>;
}

export interface DeviceEvent {
    component: string;
    name: string;
    id: number;
    info: Record<string, unknown>;
}

export interface DeviceStateOptions {
    components?: Record<string, { status?: Record<string, unknown>; config?: Record<string, unknown> }>;
    kvs?: Record<string, string>;
    deviceInfo?: Record<string, unknown>;
    scheduler: DeviceScheduler;
}

type Listener = { status?(event: DeviceStatusEvent): void; event?(event: DeviceEvent): void };

const DEVICE_METHODS = [
    'KVS.Set', 'KVS.Get', 'KVS.GetMany', 'KVS.List', 'KVS.Delete', 'Shelly.GetDeviceInfo', 'Sys.GetStatus',
    'Switch.GetStatus', 'Switch.Set', 'Switch.Toggle',
];
// Firmware matches RPC method names case-insensitively, and scripts in the field call e.g. "switch.set".
const CANONICAL_METHODS = new Map(DEVICE_METHODS.map(method => [method.toLowerCase(), method]));
const COMPONENT_METHOD = /^([a-z][a-z0-9]*)\.(getstatus|getconfig)$/i;

function componentIdentity(component: string): { component: string; name: string; id: number } {
    const colon = component.indexOf(':');
    return { component, name: colon < 0 ? component : component.slice(0, colon), id: colon < 0 ? 0 : Number(component.slice(colon + 1)) };
}

export class DeviceState {
    readonly deviceInfo: Record<string, unknown>;
    private readonly components: Map<string, { status?: Record<string, unknown>; config?: Record<string, unknown> }>;
    private readonly kvs: KvsStore;
    private readonly scheduler: DeviceScheduler;
    private readonly started: number;
    private readonly switchTimers = new Map<string, unknown>();
    private readonly listeners = new Set<Listener>();

    constructor(options: DeviceStateOptions) {
        this.scheduler = options.scheduler;
        this.started = this.scheduler.now();
        this.components = new Map(Object.entries(copyJson(options.components ?? {})));
        this.kvs = new KvsStore(options.kvs ?? {});
        this.deviceInfo = {
            id: 'shelly-simulator', mac: '000000000000', model: 'simulator', gen: 2,
            fw_id: 'simulator', ver: '0.0.0', app: 'simulator', auth_en: false, auth_domain: null,
            ...copyJson(options.deviceInfo ?? {}),
        };
    }

    getStatus(component: string): Record<string, unknown> | null {
        return component === 'sys' ? this.sysStatus() : copyJson(this.components.get(component)?.status ?? null);
    }

    getConfig(component: string): Record<string, unknown> | null {
        return copyJson(this.components.get(component)?.config ?? null);
    }

    componentKeys(): string[] { return Array.from(this.components.keys()); }

    /** Returns the canonical name of a method this device handles, matching case-insensitively. */
    canonical(method: string): string | undefined {
        const known = CANONICAL_METHODS.get(method.toLowerCase());
        if (known) return known;
        const match = COMPONENT_METHOD.exec(method);
        if (!match) return undefined;
        const type = match[1].toLowerCase();
        if (!this.componentKeys().some(key => key === type || key.startsWith(`${type}:`))) return undefined;
        return `${type[0].toUpperCase()}${type.slice(1)}.${match[2].toLowerCase() === 'getstatus' ? 'GetStatus' : 'GetConfig'}`;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    private notify(event: DeviceStatusEvent | DeviceEvent): void {
        let failed = false;
        let failure: unknown;
        for (const listener of Array.from(this.listeners)) {
            if (!this.listeners.has(listener)) continue;
            try {
                if ('delta' in event) listener.status?.(copyJson(event));
                else listener.event?.(copyJson(event));
            } catch (error) {
                if (!failed) { failed = true; failure = error; }
            }
        }
        if (failed) throw failure;
    }

    private sysStatus(): Record<string, unknown> {
        return {
            mac: this.deviceInfo.mac, restart_required: false, time: new Date(this.scheduler.now()).toISOString().slice(11, 16),
            unixtime: Math.floor(this.scheduler.now() / 1000), uptime: Math.floor((this.scheduler.now() - this.started) / 1000),
            ram_size: 0, ram_free: 0, fs_size: 0, fs_free: 0, cfg_rev: 0, kvs_rev: this.kvs.rev, available_updates: {},
            ...copyJson(this.components.get('sys')?.status),
        };
    }

    setStatus(component: string, delta: Record<string, unknown>): void {
        const existing = this.components.get(component) ?? {};
        const snapshot = copyJson(delta);
        this.components.set(component, { ...existing, status: { ...existing.status, ...snapshot } });
        this.notify({ ...componentIdentity(component), delta: snapshot });
    }

    emitEvent(component: string, info: Record<string, unknown>): void {
        const identity = componentIdentity(component);
        this.notify({ ...identity, info: { component, id: identity.id, ts: this.scheduler.now() / 1000, ...copyJson(info) } });
    }

    call(requested: string, params: Record<string, unknown>): unknown {
        const method = this.canonical(requested);
        if (method === undefined) throw new RpcError(-114, `method not simulated: ${requested}`);
        if (method.startsWith('KVS.')) return this.kvs.call(method, params);
        if (method === 'Shelly.GetDeviceInfo') return copyJson(this.deviceInfo);
        if (method === 'Sys.GetStatus') return this.sysStatus();
        if (method === 'Switch.GetStatus' || method === 'Switch.Set' || method === 'Switch.Toggle') {
            if (typeof params.id !== 'number' || !Number.isInteger(params.id) || params.id < 0) throw new RpcError(-103, 'id must be a non-negative integer');
            const component = `switch:${params.id}`;
            const state = this.components.get(component)?.status;
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
            const previousTimer = this.switchTimers.get(component);
            if (this.switchTimers.has(component)) this.scheduler.cancel(previousTimer);
            this.switchTimers.delete(component);
            if (typeof params.toggle_after === 'number' && params.toggle_after > 0) {
                this.switchTimers.set(component, this.scheduler.schedule(params.toggle_after * 1000, () => {
                    this.switchTimers.delete(component);
                    this.setStatus(component, { output: !output, source: 'timer' });
                }));
            }
            this.setStatus(component, { id: params.id, output, source: 'script', ...(params.tag !== undefined ? { tag: params.tag } : {}) });
            return { was_on };
        }
        return this.componentCall(method, params);
    }

    private componentCall(method: string, params: Record<string, unknown>): unknown {
        const [name, action] = method.split('.');
        const type = name.toLowerCase();
        if (params.id !== undefined && (typeof params.id !== 'number' || !Number.isInteger(params.id) || params.id < 0)) {
            throw new RpcError(-103, 'id must be a non-negative integer');
        }
        const entry = this.components.get(params.id === undefined ? type : `${type}:${params.id}`);
        if (!entry) throw new RpcError(-105, `Bad id=${params.id ?? 'none'}`);
        const value = action === 'GetStatus' ? entry.status : entry.config;
        return { ...(params.id === undefined ? {} : { id: params.id }), ...copyJson(value ?? {}) };
    }
}
