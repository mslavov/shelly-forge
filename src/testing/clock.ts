import { runInContext, type Context } from 'node:vm';

interface Scheduled {
    at: number;
    callback: () => void;
}

export class VirtualClock {
    private time: number;
    private nextId = 1;
    private readonly scheduled = new Map<number, Scheduled>();

    constructor(now: number) {
        if (!Number.isFinite(now)) throw new Error('now must be a finite epoch in milliseconds');
        this.time = now;
    }

    now(): number { return this.time; }

    nextScheduledTime(): number | undefined {
        let next: number | undefined;
        for (const entry of this.scheduled.values()) {
            if (next === undefined || entry.at < next) next = entry.at;
        }
        return next;
    }

    schedule(delay: number, callback: () => void): number {
        if (!Number.isFinite(delay) || delay < 0) throw new Error('delay must be a finite non-negative number');
        const handle = this.nextId++;
        this.scheduled.set(handle, { at: this.time + delay, callback });
        return handle;
    }

    cancel(handle: number): boolean { return this.scheduled.delete(handle); }

    clear(): void { this.scheduled.clear(); }

    advance(ms: number, flush: () => void): void {
        if (!Number.isFinite(ms) || ms < 0 || !Number.isFinite(this.time + ms)) {
            throw new Error('advance must be a finite non-negative number of milliseconds');
        }
        const end = this.time + ms;
        flush();
        for (;;) {
            let next: Scheduled | undefined;
            let nextId = 0;
            for (const [id, entry] of this.scheduled) {
                if (entry.at <= end && (!next || entry.at < next.at)) {
                    next = entry;
                    nextId = id;
                }
            }
            if (!next) break;
            this.time = next.at;
            this.scheduled.delete(nextId);
            next.callback();
            flush();
        }
        this.time = end;
    }
}

export function installDate(context: Context, now: () => number): void {
    context.__shellyNow = now;
    runInContext(`(function (now) {
        var NativeDate = Date;
        var construct = Reflect.construct;
        function VirtualDate() {
            if (!(this instanceof VirtualDate)) return new NativeDate(now()).toString();
            return construct(NativeDate, arguments.length === 0 ? [now()] : arguments);
        }
        VirtualDate.prototype = NativeDate.prototype;
        VirtualDate.prototype.constructor = VirtualDate;
        VirtualDate.now = function () { return now(); };
        VirtualDate.parse = NativeDate.parse;
        VirtualDate.UTC = NativeDate.UTC;
        Date = VirtualDate;
    })(__shellyNow); delete globalThis.__shellyNow;`, context);
}
