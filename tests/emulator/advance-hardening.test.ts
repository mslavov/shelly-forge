import { expect, test, vi } from 'vitest';
import { fixture } from './helpers.js';

test.each([
    ['RPC callback', 'function loop() { Shelly.call("Custom.Tick", {}, loop); }'],
    ['zero-delay timer and RPC callback', 'function loop() { Timer.set(0, false, function () { Shelly.call("Custom.Tick", {}, loop); }); }'],
])('bounds a %s self-loop at one emulated time without stopping another script', async (_name, loop) => {
    const tick = vi.fn(() => ({}));
    const lines: string[] = [];
    const { emulator, scripts } = await fixture({ rpc: { 'Custom.Tick': tick }, onLog: line => lines.push(line.data) });
    const broken = await scripts.create('self-loop');
    const healthy = await scripts.create('healthy');
    await scripts.putCode(broken, `${loop} Shelly.addEventHandler(function () { loop(); });`);
    await scripts.putCode(healthy, 'Timer.set(60000, true, function () { print("healthy"); });');
    await scripts.start(broken);
    await scripts.start(healthy);

    emulator.emitEvent('input:0', { event: 'single_push' });
    const started = performance.now();
    expect(() => emulator.advance(60000)).not.toThrow();
    expect(performance.now() - started).toBeLessThan(2500);

    expect(await scripts.getStatus(broken)).toMatchObject({
        running: false, errors: ['crashed'],
        error_msg: 'Shelly script error: Script exceeded 1000 callbacks at one emulated time',
    });
    expect(tick.mock.calls.length).toBeGreaterThan(0);
    expect(tick.mock.calls.length).toBeLessThanOrEqual(1000);
    expect(lines.filter(line => line === 'healthy')).toHaveLength(1);
    expect(await scripts.getStatus(healthy)).toMatchObject({ running: true });
    const callsAfterCrash = tick.mock.calls.length;

    emulator.advance(60000);

    expect(tick).toHaveBeenCalledTimes(callsAfterCrash);
    expect(lines.filter(line => line === 'healthy')).toHaveLength(2);
    expect(lines.filter(line => line.includes(`script:${broken} crashed:`))).toHaveLength(1);
});

test('bounds recursive zero-delay timers inside the engine crash boundary', async () => {
    const lines: string[] = [];
    const { emulator, scripts } = await fixture({ onLog: line => lines.push(line.data) });
    const broken = await scripts.create('zero-delay-timers');
    const healthy = await scripts.create('healthy');
    await scripts.putCode(broken, `
        function loop() { Timer.set(0, false, loop); }
        Shelly.addEventHandler(function () { loop(); });
    `);
    await scripts.putCode(healthy, 'Timer.set(60000, true, function () { print("healthy"); });');
    await scripts.start(broken);
    await scripts.start(healthy);

    emulator.emitEvent('input:0', { event: 'single_push' });
    const started = performance.now();
    expect(() => emulator.advance(60000)).not.toThrow();
    expect(performance.now() - started).toBeLessThan(2500);

    expect(await scripts.getStatus(broken)).toMatchObject({
        running: false, errors: ['crashed'],
        error_msg: 'Shelly script error: Script exceeded 1000 timer callbacks in one advance',
    });
    expect(await scripts.getStatus(healthy)).toMatchObject({ running: true });
    expect(lines.filter(line => line === 'healthy')).toHaveLength(1);
    emulator.advance(60000);
    expect(lines.filter(line => line === 'healthy')).toHaveLength(2);
    expect(lines.filter(line => line.includes(`script:${broken} crashed:`))).toHaveLength(1);
}, 5000);

test('keeps Date.now integral and equal to new Date().getTime after real-time ticks', async () => {
    const lines: string[] = [];
    const { scripts } = await fixture({ onLog: line => lines.push(line.data) });
    const id = await scripts.create('date-clock');
    await scripts.putCode(id, 'Timer.set(50, false, function () { print("ticked"); });');
    await scripts.start(id);

    await vi.waitFor(() => expect(lines).toEqual(['ticked']));

    const result = await scripts.eval(id, 'JSON.stringify({now:Date.now(), date:new Date().getTime()})') as { result: string };
    const clock = JSON.parse(result.result) as { now: number; date: number };
    expect(Number.isInteger(clock.now)).toBe(true);
    expect(clock.now).toBe(clock.date);
});

test('delivers external events exactly once after another script times out during advancement', async () => {
    const { emulator, scripts } = await fixture();
    const broken = await scripts.create('timeout');
    const healthy = await scripts.create('events');
    await scripts.putCode(broken, 'Timer.set(60000, false, function () { while (true) {} });');
    await scripts.putCode(healthy, 'var count = 0; Shelly.addEventHandler(function () { count++; });');
    await scripts.start(broken);
    await scripts.start(healthy);
    emulator.advance(60000);
    expect(await scripts.getStatus(broken)).toMatchObject({ running: false, errors: ['crashed'] });
    emulator.emitEvent('input:0', { event: 'single_push' });
    expect(await scripts.eval(healthy, 'count')).toEqual({ result: '1' });
    emulator.advance(0);
    expect(await scripts.eval(healthy, 'count')).toEqual({ result: '1' });
    expect(await scripts.getStatus(healthy)).toMatchObject({ running: true });
}, 5000);
