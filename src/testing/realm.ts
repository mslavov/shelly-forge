import { runInContext, type Context } from 'node:vm';
import { errorMessage } from './errors.js';
import type { ScriptCallback } from './types.js';

function isHostError(value: unknown): value is Error {
    try { return value instanceof Error; } catch { return false; }
}

export function createScriptRealm(context: Context) {
    const parse = runInContext('(function (json) { return JSON.parse(json); })', context) as (json: string) => unknown;
    const makeWrapper = runInContext('(function (invoke) { return function () { return invoke(arguments); }; })', context) as
        (invoke: (args: IArguments) => unknown) => ScriptCallback;
    const makeError = runInContext(`(function (name, message) {
        var kinds = { Error: Error, TypeError: TypeError, RangeError: RangeError, SyntaxError: SyntaxError,
            ReferenceError: ReferenceError, URIError: URIError, EvalError: EvalError };
        var error = new (Object.prototype.hasOwnProperty.call(kinds, name) ? kinds[name] : Error)(message);
        error.name = name;
        return error;
    })`, context) as (name: string, message: string) => Error;

    function wrap(callback: ScriptCallback): ScriptCallback {
        return makeWrapper(args => {
            try {
                return Reflect.apply(callback, undefined, args);
            } catch (error) {
                // Host Error constructors would otherwise give scripts access to the host realm.
                if (isHostError(error)) throw makeError(error.name, errorMessage(error));
                throw error;
            }
        });
    }

    function apiValue(value: unknown): unknown {
        if (typeof value === 'function') return wrap(value as ScriptCallback);
        if (value === null || typeof value !== 'object') return value;
        const result = parse(Array.isArray(value) ? '[]' : '{}') as object;
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
            Object.defineProperty(result, key, {
                ...descriptor,
                ...(Object.hasOwn(descriptor, 'value') ? { value: apiValue(descriptor.value) } : {}),
                ...(descriptor.get ? { get: wrap(descriptor.get) } : {}),
                ...(descriptor.set ? { set: wrap(descriptor.set as ScriptCallback) } : {}),
            });
        }
        return result;
    }

    return {
        wrap,
        toScript: <T>(value: T): T => value === undefined ? value : parse(JSON.stringify(value)) as T,
        expose(globals: Record<string, unknown>): void {
            for (const [name, value] of Object.entries(globals)) context[name] = apiValue(value);
        },
    };
}
