export type ErrorCode =
    | 'USAGE' | 'CONFIG' | 'BUILD' | 'CHECK'
    | 'DEVICE_UNREACHABLE' | 'DEVICE_AUTH' | 'DEVICE_RPC'
    | 'DEPLOY' | 'UNHEALTHY' | 'NOT_IMPLEMENTED' | 'INTERNAL';

export const EXIT_CODES: Record<ErrorCode, number> = {
    USAGE: 2, CONFIG: 2, BUILD: 3, CHECK: 3,
    DEVICE_UNREACHABLE: 4, DEVICE_AUTH: 4, DEVICE_RPC: 4, DEPLOY: 4,
    UNHEALTHY: 5, NOT_IMPLEMENTED: 1, INTERNAL: 1,
};

export class ForgeError extends Error {
    readonly code: ErrorCode;
    readonly hint?: string;
    readonly details?: unknown;

    constructor(code: ErrorCode, message: string, options?: { hint?: string; cause?: unknown; details?: unknown }) {
        super(message, { cause: options?.cause });
        this.name = 'ForgeError';
        this.code = code;
        this.hint = options?.hint;
        this.details = options?.details;
    }

    get exitCode(): number {
        return EXIT_CODES[this.code];
    }
}

export function toForgeError(error: unknown): ForgeError {
    if (error instanceof ForgeError) return error;
    return new ForgeError('INTERNAL', error instanceof Error ? error.message : String(error), { cause: error });
}
