import { expect, test } from 'vitest';
import { createScriptEngine } from '../../src/testing/engine.js';

test('reports the next engine deadline and clears it after cancellation and disposal', () => {
    const engine = createScriptEngine({ now: 1000 });
    try {
        expect(engine.nextScheduledTime()).toBeUndefined();
        engine.runtime.load('var repeating = Timer.set(20, true, function () {}); Timer.set(5, false, function () {});');
        expect(engine.nextScheduledTime()).toBe(1005);
        engine.runtime.advance(5);
        expect(engine.nextScheduledTime()).toBe(1020);
        engine.evaluate('Timer.clear(repeating);');
        expect(engine.nextScheduledTime()).toBeUndefined();
        engine.evaluate('Timer.set(1, false, function () {});');
    } finally { engine.dispose(); }
    expect(engine.nextScheduledTime()).toBeUndefined();
});

test('limits timer callbacks within the engine crash boundary only when configured', () => {
    const limited = createScriptEngine({ maxCallbacksPerAdvance: 2 });
    try {
        limited.runtime.load('function tick() { Timer.set(0, false, tick); } tick();');
        expect(() => limited.runtime.advance(0)).toThrow('Script exceeded 2 timer callbacks in one advance');
        expect(limited.runtime.crashed?.message).toContain('Script exceeded 2 timer callbacks in one advance');
        expect(limited.nextScheduledTime()).toBeUndefined();
    } finally { limited.dispose(); }
    const unlimited = createScriptEngine();
    try {
        unlimited.runtime.load('var count = 0; Timer.set(1, true, function () { count++; });');
        unlimited.runtime.advance(1001);
        expect(unlimited.evaluate('count')).toBe(1001);
        expect(unlimited.runtime.crashed).toBeUndefined();
    } finally { unlimited.dispose(); }
});

test.each([0, -1, 0.5, NaN, Infinity])('rejects an invalid per-advance callback limit %s', maxCallbacksPerAdvance => {
    expect(() => createScriptEngine({ maxCallbacksPerAdvance })).toThrow('maxCallbacksPerAdvance must be a positive safe integer');
});
