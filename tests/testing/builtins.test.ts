import { expect, test } from 'vitest';
import ts from 'typescript';
import { UNSUPPORTED_BUILTINS } from '../../src/testing/builtins.js';
import { createShellyRuntime, ShellyScriptError } from '../../src/testing/index.js';

test.each(Object.entries(UNSUPPORTED_BUILTINS))('strict mode removes %s additions only in the sandbox', (target, names) => {
    const runtime = createShellyRuntime();
    const permissive = createShellyRuntime({ strictBuiltins: false });
    for (const name of names) {
        const property = `${target}[${JSON.stringify(name)}]`;
        runtime.load(`print(typeof ${property});`);
        permissive.load(`print(typeof ${property});`);
    }
    expect(runtime.logs).toEqual(names.map(() => 'undefined'));
    if (target === 'globalThis') {
        expect(permissive.logs[names.findIndex(name => name === 'Map')]).toBe('function');
        expect(typeof Map).toBe('function');
    }
    if (target === 'Object') {
        expect(permissive.logs).toEqual(names.map(() => 'function'));
        expect(typeof Object.assign).toBe('function');
    }
});

const expressions = [
    ...['at(0)', 'find(function () { return true; })', 'findIndex(function () { return true; })',
        'findLast(function () { return true; })', 'findLastIndex(function () { return true; })',
        'toReversed()', 'toSorted()', 'toSpliced(0, 1)', 'with(0, 2)', 'map(function (x) { return x; })',
        'forEach(function () {})', 'filter(function () { return true; })', 'reduce(function (x) { return x; })',
        'reduceRight(function (x) { return x; })', 'some(function () { return true; })', 'every(function () { return true; })',
        'flat()', 'flatMap(function (x) { return [x]; })', 'includes(1)', 'fill(0)', 'copyWithin(0)',
        'entries()', 'keys()', 'values()'].map(call => `[1].${call}`),
    'Array.from([1])', 'Array.of(1)', 'Array.fromAsync([1])',
    ...['startsWith("a")', 'endsWith("a")', 'includes("a")', 'padStart(2)', 'padEnd(2)', 'repeat(2)',
        'codePointAt(0)', 'normalize()', 'trimStart()', 'trimEnd()', 'trimLeft()', 'trimRight()',
        'matchAll(/a/g)', 'replaceAll("a", "b")', 'isWellFormed()', 'toWellFormed()'].map(call => `"a".${call}`),
    'String.fromCodePoint(65)', 'String.raw({raw: ["a"]})',
    'Object.assign({}, {a: 1})', 'Object.entries({a: 1})', 'Object.values({a: 1})', 'Object.fromEntries([["a", 1]])',
    'Object.is(1, 1)', 'Object.getOwnPropertySymbols({})', 'Object.getOwnPropertyDescriptors({})',
    'Object.setPrototypeOf({}, null)', 'Object.hasOwn({a: 1}, "a")', 'Object.groupBy([1], function () { return "a"; })',
    ...['isInteger(1)', 'isSafeInteger(1)', 'isNaN(1)', 'isFinite(1)', 'parseInt("1")', 'parseFloat("1")'].map(call => `Number.${call}`),
    ...['acosh', 'asinh', 'atanh', 'cbrt', 'clz32', 'cosh', 'expm1', 'fround', 'hypot', 'imul', 'log10',
        'log1p', 'log2', 'sign', 'sinh', 'tanh', 'trunc'].map(name => `Math.${name}(1)`),
    'new Map()', 'new Set()', 'new WeakMap()', 'new WeakSet()', 'new WeakRef({})',
    'new FinalizationRegistry(function () {})', 'BigInt(1)', 'new Intl.DateTimeFormat()',
    'new ArrayBuffer(1)', 'new SharedArrayBuffer(1)', 'new DataView(new ArrayBuffer(1))',
    ...['Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array',
        'Float32Array', 'Float64Array', 'Uint8ClampedArray', 'BigUint64Array', 'BigInt64Array'].map(name => `new ${name}(1)`),
    'Atomics.isLockFree(1)', 'new WebAssembly.Memory({initial: 0})', 'new AggregateError([], "error")',
    'Iterator.from([1])',
];

test.each(expressions)('%s fails only in strict mode', expression => {
    const runtime = createShellyRuntime();
    expect(() => runtime.load(expression)).toThrow(ShellyScriptError);
    const permissive = createShellyRuntime({ strictBuiltins: false });
    expect(() => permissive.load(expression)).not.toThrow();
    expect(permissive.crashed).toBeUndefined();
});

test('strict mode removes modern constants and RegExp accessors', () => {
    const code = `print(Number.EPSILON > 0, Number.MAX_SAFE_INTEGER > 0, Number.MIN_SAFE_INTEGER < 0,
        /a/g.flags, /a/y.sticky, /a/u.unicode, /a/s.dotAll, /a/d.hasIndices, /a/v.unicodeSets);`;
    const runtime = createShellyRuntime();
    runtime.load(code);
    expect(runtime.logs).toEqual(['false false false undefined undefined undefined undefined undefined undefined']);
    const permissive = createShellyRuntime({ strictBuiltins: false });
    permissive.load(code);
    expect(permissive.logs).toEqual(['true true true g true true true true true']);
});

test.each([true, false])('String.at returns numeric character codes with strictBuiltins=%s', strictBuiltins => {
    const runtime = createShellyRuntime({ strictBuiltins });
    runtime.load(`print('AZ'.at(0), typeof 'AZ'.at(0), 'AZ'.at(1), 'AZ'.at(2), 'AZ'.at(-1), ''.at(0));`);
    expect(runtime.logs).toEqual(['65 number 90 undefined undefined undefined']);
    expect('AZ'.at(0)).toBe('A');
});

test('Object.assign feature detection still selects an ES5 fallback', () => {
    const runtime = createShellyRuntime();
    runtime.load(`var assign = Object.assign || function (target, source) {
        for (var key in source) if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
        return target;
    };
    print(assign({}, {value: 42}));`);
    expect(runtime.logs).toEqual(['{"value":42}']);
});

test('TypeScript object spread helpers use their ES5 fallback', () => {
    const runtime = createShellyRuntime();
    const { outputText } = ts.transpileModule(`const original = { value: 42 }; const copied = { ...original, enabled: true }; print(copied);`, {
        compilerOptions: { target: ts.ScriptTarget.ES5 },
    });
    runtime.load(outputText);
    expect(runtime.crashed).toBeUndefined();
    expect(runtime.logs).toEqual(['{"value":42,"enabled":true}']);
});

test('strict mode preserves the declared Number constructor and ES5 methods', () => {
    const runtime = createShellyRuntime();
    runtime.load(`
        print(Number(), Number('12'), Number.call(new Number(1), '2'), new Number().valueOf(), isNaN(new Number(undefined).valueOf()));
        print(new Number(3) instanceof Number, (3).constructor === Number, new Number(3).constructor === Number);
        print(Number.MAX_VALUE > 0, Number.MIN_VALUE > 0, isNaN(Number.NaN), Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
        print((3).toFixed(2), (12).toExponential(1), (12).toPrecision(3), (3).toString());
        print(typeof (3).constructor.isInteger, typeof new Number(3).constructor.EPSILON);
    `);
    expect(runtime.logs).toEqual([
        '0 12 2 0 true', 'true true true', 'true true true -Infinity Infinity', '3.00 1.2e+1 12.0 3', 'undefined undefined',
    ]);
});
