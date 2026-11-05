export class EmulatorClock {
    private time = Date.now();
    private nextId = 1;
    private readonly timers = new Map<number, { at: number; callback: () => void }>();

    now(): number { return this.time; }

    setTime(time: number): void { this.time = time; }

    schedule(delay: number, callback: () => void): number {
        const id = this.nextId++;
        this.timers.set(id, { at: this.time + delay, callback });
        return id;
    }

    cancel(id: number): void { this.timers.delete(id); }

    clear(): void { this.timers.clear(); }

    nextScheduledTime(): number | undefined {
        let next: number | undefined;
        for (const timer of this.timers.values()) {
            if (next === undefined || timer.at < next) next = timer.at;
        }
        return next;
    }

    runDue(): void {
        for (;;) {
            let next: [number, { at: number; callback: () => void }] | undefined;
            for (const entry of this.timers) {
                if (entry[1].at <= this.time && (!next || entry[1].at < next[1].at)) next = entry;
            }
            if (!next) return;
            this.timers.delete(next[0]);
            next[1].callback();
        }
    }
}
