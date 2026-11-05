import { expect, test } from 'vitest';
import { EmulatorClock } from '../../src/emulator/clock.js';

test('orders device deadlines by time and preserves registration order for ties', () => {
    const clock = new EmulatorClock();
    const start = clock.now();
    const calls: string[] = [];
    clock.schedule(1000, () => calls.push('last'));
    clock.schedule(0.5, () => calls.push('first'));
    clock.schedule(0.5, () => calls.push('second'));
    expect(clock.nextScheduledTime()).toBe(start + 0.5);
    clock.setTime(start + 0.5);
    clock.runDue();
    expect(calls).toEqual(['first', 'second']);
    expect(clock.nextScheduledTime()).toBe(start + 1000);
    clock.setTime(start + 1000);
    clock.runDue();
    expect(calls).toEqual(['first', 'second', 'last']);
    expect(clock.nextScheduledTime()).toBeUndefined();
});

test('allows device callbacks to cancel and schedule work at the current time', () => {
    const clock = new EmulatorClock();
    const calls: string[] = [];
    let cancelled = 0;
    clock.schedule(0, () => {
        calls.push('first');
        clock.cancel(cancelled);
        clock.schedule(0, () => calls.push('next'));
    });
    cancelled = clock.schedule(0, () => calls.push('cancelled'));
    clock.runDue();
    expect(calls).toEqual(['first', 'next']);
    expect(clock.nextScheduledTime()).toBeUndefined();
});

test('clears pending device timers without changing the device time', () => {
    const clock = new EmulatorClock();
    const start = clock.now();
    let called = false;
    clock.schedule(1, () => { called = true; });
    clock.clear();
    clock.setTime(start + 1);
    clock.runDue();
    expect(called).toBe(false);
    expect(clock.now()).toBe(start + 1);
    expect(clock.nextScheduledTime()).toBeUndefined();
});
