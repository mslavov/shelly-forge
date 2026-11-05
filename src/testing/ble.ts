import { copyJson } from './errors.js';
import type { ScriptCallback, ScriptHost, ShellyRuntime } from './types.js';

interface ScanOptions {
    duration_ms?: number;
    active?: boolean;
    interval_ms?: number;
    window_ms?: number;
    rssi_thr?: number;
    filters?: unknown[];
}

export function createBle(host: ScriptHost) {
    let options: ScanOptions | null = null;
    let timer: number | undefined;
    let subscriber: { callback: ScriptCallback; userdata: unknown } | undefined;
    let scanCallback: { callback: ScriptCallback; userdata: unknown } | undefined;
    const notify = (event: number, result: unknown) => {
        const listeners = [subscriber, scanCallback];
        for (const entry of listeners) if (entry) host.invoke(entry.callback, [event, host.toScript(result), entry.userdata]);
    };
    const stop = (): boolean => {
        if (!options) return false;
        if (timer !== undefined) host.cancel(timer);
        timer = undefined;
        options = null;
        const finishedCallback = scanCallback;
        scanCallback = undefined;
        if (subscriber) host.invoke(subscriber.callback, [1, null, subscriber.userdata]);
        if (finishedCallback) host.invoke(finishedCallback.callback, [1, null, finishedCallback.userdata]);
        return true;
    };
    const notSimulated = (): never => { throw new Error('BLE.GAP not simulated'); };
    const isRunning = (): boolean => options !== null;
    const getScanOptions = (): ScanOptions | null => host.toScript(options);
    const subscribe = (callback: ScriptCallback | null, userdata?: unknown): void => {
        if (callback !== null && typeof callback !== 'function') throw new Error('BLE scan callback must be a function or null');
        subscriber = callback === null ? undefined : { callback, userdata };
    };
    const start = (value: ScanOptions, callback?: ScriptCallback, userdata?: unknown): ScanOptions | null => {
        if (options) return null;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('BLE scan options must be an object');
        if (callback !== undefined && typeof callback !== 'function') throw new Error('BLE scan callback must be a function');
        const duration = value.duration_ms ?? -1;
        if (!Number.isFinite(duration) || (duration < 0 && duration !== -1)) throw new Error('Invalid BLE scan duration_ms');
        options = copyJson(value);
        scanCallback = callback ? { callback, userdata } : undefined;
        if (duration >= 0) timer = host.schedule(duration, stop);
        const startedOptions = copyJson(options);
        notify(0, null);
        return host.toScript(startedOptions);
    };
    return {
        clear(): void {
            if (timer !== undefined) host.cancel(timer);
            timer = undefined;
            options = null;
            subscriber = undefined;
            scanCallback = undefined;
        },
        api: {
            Scanner: {
                SCAN_START: 0, SCAN_STOP: 1, SCAN_RESULT: 2, INFINITE_SCAN: -1,
                isRunning, getScanOptions, subscribe, start, stop,
                // Earlier firmware and Shelly's published examples use capitalized names.
                GetScanOptions: getScanOptions, Subscribe: subscribe, Start: start, Stop: stop,
            },
            GAP: {
                ADDRESS_TYPE_PUBLIC: 1, ADDRESS_TYPE_RANDOM_STATIC: 2,
                ADDRESS_TYPE_RANDOM_NON_RESOLVABLE: 3, ADDRESS_TYPE_RANDOM_RESOLVABLE: 4,
                EIR_FLAGS: 0x01, EIR_SERVICE_16: 0x03, EIR_SERVICE_128: 0x07, EIR_SHORT_NAME: 0x08,
                EIR_FULL_NAME: 0x09, EIR_TX_POWER_LEVEL: 0x0a, EIR_SERVICE_DATA_16: 0x16, EIR_MANUFACTURER_SPECIFIC_DATA: 0xff,
                hasService: notSimulated, parseServiceData: notSimulated, parseName: notSimulated, parseManufacturerData: notSimulated,
                HasService: notSimulated, ParseServiceData: notSimulated, ParseName: notSimulated, ParseManufacturerData: notSimulated,
            },
        },
        control: {
            advertise(result: Record<string, unknown>): void { if (options) notify(2, result); },
        } satisfies ShellyRuntime['ble'],
    };
}
