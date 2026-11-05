import { RESOURCE_LIMITS } from '../core/runtime-profile.js';
import type { ScriptCallback, ScriptHost } from './types.js';

export function createTimers(host: ScriptHost) {
    let nextId = 1;
    const started = host.now();
    const timers = new Map<number, { scheduled: number; period: number; next: number }>();
    const api = {
        set(period: number, repeat: boolean, callback: ScriptCallback, userdata?: unknown): number {
            if (!Number.isFinite(period) || period < 0) throw new Error('Timer period must be a finite non-negative number');
            if (typeof repeat !== 'boolean') throw new Error('Timer repeat must be a boolean');
            if (typeof callback !== 'function') throw new Error('Timer callback must be a function');
            if (timers.size >= RESOURCE_LIMITS.timers) throw new Error(`timers limit exceeded (${RESOURCE_LIMITS.timers})`);
            const id = nextId++;
            const interval = repeat ? Math.max(1, period) : period;
            const tick = () => {
                if (repeat) {
                    timers.set(id, { scheduled: host.schedule(interval, tick), period: interval, next: host.now() + interval - started });
                } else {
                    timers.delete(id);
                }
                host.invoke(callback, [userdata]);
            };
            timers.set(id, { scheduled: host.schedule(interval, tick), period: repeat ? interval : 0, next: host.now() + interval - started });
            return id;
        },
        clear(id: number): boolean | undefined {
            if (!Number.isInteger(id)) return undefined;
            const timer = timers.get(id);
            if (!timer) return false;
            host.cancel(timer.scheduled);
            return timers.delete(id);
        },
        getInfo(id: number): { interval: number; next: number } | undefined {
            const timer = timers.get(id);
            return timer && host.toScript({ interval: timer.period, next: timer.next });
        },
    };
    return {
        api,
        clear(): void {
            for (const timer of timers.values()) host.cancel(timer.scheduled);
            timers.clear();
        },
    };
}
