import { runInContext, type Context } from 'node:vm';
import { UNSUPPORTED_ARRAY_METHODS, UNSUPPORTED_GLOBALS } from '../core/runtime-profile.js';

export const UNSUPPORTED_BUILTINS = {
    'Array.prototype': [...UNSUPPORTED_ARRAY_METHODS, 'at', 'findLast', 'findLastIndex', 'toReversed', 'toSorted', 'toSpliced', 'with'],
    Array: ['from', 'of', 'fromAsync'],
    'String.prototype': [
        'startsWith', 'endsWith', 'includes', 'padStart', 'padEnd', 'repeat', 'codePointAt', 'normalize',
        'trimStart', 'trimEnd', 'trimLeft', 'trimRight', 'matchAll', 'replaceAll', 'isWellFormed', 'toWellFormed',
    ],
    String: ['fromCodePoint', 'raw'],
    Object: ['assign', 'entries', 'values', 'fromEntries', 'is', 'getOwnPropertySymbols', 'getOwnPropertyDescriptors', 'setPrototypeOf', 'hasOwn', 'groupBy'],
    Number: ['isInteger', 'isSafeInteger', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'EPSILON', 'MAX_SAFE_INTEGER', 'MIN_SAFE_INTEGER'],
    Math: ['acosh', 'asinh', 'atanh', 'cbrt', 'clz32', 'cosh', 'expm1', 'fround', 'f16round', 'hypot', 'imul', 'log10', 'log1p', 'log2', 'sign', 'sinh', 'tanh', 'trunc', 'sumPrecise'],
    'RegExp.prototype': ['flags', 'sticky', 'unicode', 'dotAll', 'hasIndices', 'unicodeSets'],
    Error: ['isError'],
    globalThis: [
        ...UNSUPPORTED_GLOBALS, 'Map', 'Set', 'WeakRef', 'FinalizationRegistry', 'BigInt', 'Intl',
        'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Atomics', 'Uint8Array', 'Int8Array', 'Uint16Array',
        'Int16Array', 'Uint32Array', 'Int32Array', 'Float16Array', 'Float32Array', 'Float64Array',
        'Uint8ClampedArray', 'BigUint64Array', 'BigInt64Array', 'WebAssembly', 'AggregateError', 'Iterator',
    ],
} as const;

export function installBuiltins(context: Context, strict: boolean): void {
    runInContext(`String.prototype.at = function (index) {
        var code = String(this).charCodeAt(index);
        return isNaN(code) ? undefined : code;
    };`, context);
    if (!strict) return;
    // Number's ES2015 constants are non-configurable, so deletion cannot hide them.
    runInContext(`(function (NativeNumber, omitted) {
        function Number(value) {
            if (new.target) return new NativeNumber(arguments.length === 0 ? 0 : value);
            return NativeNumber.apply(undefined, arguments);
        }
        var names = Object.getOwnPropertyNames(NativeNumber);
        for (var i = 0; i < names.length; i++) {
            var name = names[i];
            if (omitted.indexOf(name) < 0) Object.defineProperty(Number, name, Object.getOwnPropertyDescriptor(NativeNumber, name));
        }
        Number.prototype.constructor = Number;
        globalThis.Number = Number;
    })(Number, ${JSON.stringify(UNSUPPORTED_BUILTINS.Number)});`, context);
    for (const [target, names] of Object.entries(UNSUPPORTED_BUILTINS)) {
        for (const name of names) runInContext(`delete ${target}[${JSON.stringify(name)}]`, context);
    }
}
