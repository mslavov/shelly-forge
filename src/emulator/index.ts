import type { Logger } from '../core/logger.js';
import type { RpcHandler } from '../testing/types.js';
import type { MdnsPublisher } from './mdns.js';

export interface EmulatorLogLine { ts: number; level: number; data: string }

export interface EmulatorOptions {
    port?: number;
    bind?: string;
    password?: string;
    deviceInfo?: { id?: string; mac?: string; model?: string; gen?: number; app?: string; ver?: string; fw_id?: string };
    switches?: number;
    components?: Record<string, { status?: Record<string, unknown>; config?: Record<string, unknown> }>;
    rpc?: Record<string, RpcHandler>;
    kvs?: Record<string, string>;
    mdns?: boolean;
    onLog?(line: EmulatorLogLine): void;
    onRpc?(method: string): void;
    logger?: Pick<Logger, 'warn'>;
    createPublisher?: (onError: (error: Error) => void) => MdnsPublisher;
}

export interface EmulatorScript {
    id: number;
    name: string;
    enable: boolean;
    running: boolean;
    errors?: string[];
    error_msg?: string;
}

export interface Emulator {
    readonly host: string;
    advance(ms: number): void;
    setStatus(component: string, delta: Record<string, unknown>): void;
    emitEvent(component: string, info: Record<string, unknown>): void;
    ble: { advertise(result: Record<string, unknown>): void };
    mqtt: {
        receive(topic: string, message: string): void;
        setConnected(connected: boolean): void;
        readonly published: ReadonlyArray<{ scriptId: number; topic: string; message: string; qos: number; retain: boolean }>;
    };
    scripts(): EmulatorScript[];
    reboot(): Promise<void>;
    close(): Promise<void>;
}

export { startEmulator } from './server.js';
export type { MdnsPublisher } from './mdns.js';
