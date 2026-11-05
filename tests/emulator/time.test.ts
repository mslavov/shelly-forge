import { expect, test, vi } from 'vitest';
import type { EmulatorLogLine } from '../../src/emulator/index.js';
import { fixture } from './helpers.js';

test('advances a deployed minute timer three times and shares time with device status', async () => {
    const lines: EmulatorLogLine[] = [];
    const { emulator, rpc, scripts } = await fixture({ onLog: line => lines.push(line) });
    const id = await scripts.create('minute-timer');
    await scripts.putCode(id, `
        var started = Date.now();
        var initialUptime = Shelly.getUptimeMs();
        Timer.set(60000, true, function () {
            print("minute");
            Shelly.call("Switch.Toggle", {id:0});
        });
    `);
    await scripts.start(id);
    const before = await rpc.call<{ unixtime: number; uptime: number }>('Sys.GetStatus');

    expect(emulator.advance(180000)).toBeUndefined();

    expect(lines.map(line => ({ level: line.level, data: line.data }))).toEqual([
        { level: 2, data: 'minute' }, { level: 2, data: 'minute' }, { level: 2, data: 'minute' },
    ]);
    expect(lines[1].ts - lines[0].ts).toBeCloseTo(60, 5);
    expect(lines[2].ts - lines[1].ts).toBeCloseTo(60, 5);
    expect(await rpc.call('Switch.GetStatus', { id: 0 })).toMatchObject({ output: true });
    const after = await rpc.call<{ unixtime: number; uptime: number }>('Sys.GetStatus');
    expect(after.unixtime - before.unixtime).toBeGreaterThanOrEqual(180);
    expect(after.unixtime - before.unixtime).toBeLessThanOrEqual(182);
    expect(after.uptime - before.uptime).toBeGreaterThanOrEqual(180);
    expect(after.uptime - before.uptime).toBeLessThanOrEqual(182);
    const result = await scripts.eval(id, 'JSON.stringify({now:Date.now(), elapsed:Date.now()-started, uptime:Shelly.getUptimeMs()-initialUptime})') as { result: string };
    const clock = JSON.parse(result.result) as { now: number; elapsed: number; uptime: number };
    expect(clock.elapsed).toBeGreaterThanOrEqual(180000);
    expect(clock.elapsed).toBeLessThan(182000);
    expect(clock.uptime).toBe(clock.elapsed);
    expect(Math.abs(Math.floor(clock.now / 1000) - after.unixtime)).toBeLessThanOrEqual(2);
});

test('interleaves shared toggle_after deadlines with script timers', async () => {
    const lines: EmulatorLogLine[] = [];
    const { emulator, rpc, scripts } = await fixture({ onLog: line => lines.push(line) });
    const id = await scripts.create('switch-observer');
    await scripts.putCode(id, `
        Shelly.addStatusHandler(function (event) {
            if (event.component === "switch:0") print("change", event.delta.output);
        });
        Timer.set(60000, true, function () {
            print("observe", Shelly.getComponentStatus("switch", 0).output);
        });
    `);
    await scripts.start(id);
    await rpc.call('Switch.Set', { id: 0, on: true, toggle_after: 90 });

    emulator.advance(180000);

    expect(lines.map(line => line.data)).toEqual([
        'change true', 'observe true', 'change false', 'observe false', 'observe false',
    ]);
    expect(lines[2].ts - lines[0].ts).toBeCloseTo(90, 5);
    expect(await rpc.call('Switch.GetStatus', { id: 0 })).toMatchObject({ output: false, source: 'timer' });
});

test('runs timers and their RPC callbacks chronologically across scripts', async () => {
    const lines: EmulatorLogLine[] = [];
    const { emulator, rpc, scripts } = await fixture({ onLog: line => lines.push(line) });
    for (const [name, interval] of [['fast', 40000], ['slow', 70000]] as const) {
        const id = await scripts.create(name);
        await scripts.putCode(id, `
            Timer.set(${interval}, true, function () {
                Shelly.call("Switch.Toggle", {id:0}, function (result) {
                    print("${name}", result.was_on);
                });
            });
        `);
        await scripts.start(id);
    }

    emulator.advance(210000);

    expect(lines.map(line => line.data)).toEqual([
        'fast false', 'slow true', 'fast false', 'fast true',
        'slow false', 'fast true', 'fast false', 'slow true',
    ]);
    for (let index = 1; index < lines.length; index++) expect(lines[index].ts).toBeGreaterThan(lines[index - 1].ts);
    expect(await rpc.call('Switch.GetStatus', { id: 0 })).toMatchObject({ output: false });
});

test('flushes pending and nested RPC callbacks when advancing zero milliseconds', async () => {
    const lines: string[] = [];
    const { emulator, rpc, scripts } = await fixture({ onLog: line => lines.push(line.data) });
    const id = await scripts.create('pending-callbacks');
    await scripts.putCode(id, `
        Shelly.addEventHandler(function () {
            Shelly.call("Sys.GetStatus", {}, function (result, code) {
                print("status", code);
                Shelly.call("Switch.Toggle", {id:0}, function (result, code) {
                    print("toggle", code, result.was_on);
                });
            });
        });
    `);
    await scripts.start(id);

    emulator.emitEvent('input:0', { event: 'single_push' });
    expect(lines).toEqual([]);
    emulator.advance(0);

    expect(lines).toEqual(['status 0', 'toggle 0 false']);
    expect(await rpc.call('Switch.GetStatus', { id: 0 })).toMatchObject({ output: true });
});

test('isolates a timer crash and continues other scripts through the target time', async () => {
    const lines: EmulatorLogLine[] = [];
    const { emulator, scripts } = await fixture({ onLog: line => lines.push(line) });
    const broken = await scripts.create('broken-timer');
    const healthy = await scripts.create('healthy-timer');
    await scripts.putCode(broken, `
        Timer.set(30000, true, function () { throw new Error("timer failed"); });
        Timer.set(60000, true, function () { print("must not run"); });
    `);
    await scripts.putCode(healthy, 'Timer.set(45000, true, function () { print("healthy"); });');
    await scripts.start(broken);
    await scripts.start(healthy);

    expect(() => emulator.advance(180000)).not.toThrow();

    expect(lines.filter(line => line.level === 0)).toEqual([
        expect.objectContaining({ data: expect.stringContaining(`script:${broken} crashed: Shelly script error: timer failed`) }),
    ]);
    expect(lines.filter(line => line.level === 2).map(line => line.data)).toEqual(Array(4).fill('healthy'));
    expect(await scripts.getStatus(broken)).toMatchObject({ running: false, errors: ['crashed'] });
    expect(await scripts.getStatus(healthy)).toMatchObject({ running: true });
    emulator.advance(45000);
    expect(lines.filter(line => line.level === 2)).toHaveLength(5);
    expect(lines.filter(line => line.level === 0)).toHaveLength(1);
});

test('rejects invalid advances without consuming scheduled work', async () => {
    const lines: string[] = [];
    const { emulator, scripts } = await fixture({ onLog: line => lines.push(line.data) });
    const id = await scripts.create('validation');
    await scripts.putCode(id, 'Timer.set(60000, false, function () { print("due"); });');
    await scripts.start(id);

    for (const value of [-1, 0.5, NaN, Infinity, -Infinity, '1000', null, undefined, {}]) {
        expect(() => emulator.advance(value as number)).toThrow(TypeError);
    }
    expect(emulator.advance(0)).toBeUndefined();
    expect(lines).toEqual([]);
    emulator.advance(60000);
    expect(lines).toEqual(['due']);
    expect(await scripts.getStatus(id)).toMatchObject({ running: true });
});

test('continues ticking in real time without resetting the advanced clock', async () => {
    const lines: EmulatorLogLine[] = [];
    const { emulator, scripts } = await fixture({ onLog: line => lines.push(line) });
    const id = await scripts.create('real-time');
    await scripts.putCode(id, 'var started = Date.now();');
    await scripts.start(id);
    emulator.advance(60000);
    await scripts.eval(id, 'Timer.set(50, true, function () { print(Date.now()-started, Shelly.getUptimeMs()); });');

    await vi.waitFor(() => expect(lines.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });

    for (const line of lines.slice(0, 2)) {
        const [elapsed, uptime] = line.data.split(' ').map(Number);
        expect(elapsed).toBeGreaterThanOrEqual(60000);
        expect(elapsed).toBeLessThan(62000);
        expect(uptime).toBe(elapsed);
    }
    expect(lines[1].ts).toBeGreaterThan(lines[0].ts);
    expect(await scripts.getStatus(id)).toMatchObject({ running: true });
});
