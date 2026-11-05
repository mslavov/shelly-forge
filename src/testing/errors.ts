export class RpcError extends Error {
    readonly code: number;

    constructor(code: number, message: string) {
        super(message);
        this.name = 'RpcError';
        this.code = code;
    }
}

export class ShellyScriptError extends Error {
    readonly original: unknown;

    constructor(original: unknown) {
        super(`Shelly script error: ${errorMessage(original)}`, { cause: original });
        this.name = 'ShellyScriptError';
        this.original = original;
    }
}

export function errorMessage(value: unknown): string {
    try {
        return value !== null && (typeof value === 'object' || typeof value === 'function') && 'message' in value
            ? String(value.message) : String(value);
    } catch {
        return 'Unprintable thrown value';
    }
}

export function scriptBoundary<T>(action: () => T, onError: (error: ShellyScriptError) => void): T {
    try {
        return action();
    } catch (error) {
        let wrapped = false;
        try { wrapped = error instanceof ShellyScriptError; } catch { /* A thrown Proxy can reject prototype inspection. */ }
        const scriptError = wrapped ? error as ShellyScriptError : new ShellyScriptError(error);
        onError(scriptError);
        throw scriptError;
    }
}

export function copyJson<T>(value: T): T {
    if (value === undefined) return value;
    return JSON.parse(JSON.stringify(value)) as T;
}
