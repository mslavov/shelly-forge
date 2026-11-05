export const SCRIPT_MAX_BYTES = 65535;
export const SCRIPT_BUDGET_WARN_RATIO = 0.8;
export const RESOURCE_LIMITS = {
    timers: 5, eventHandlers: 5, statusHandlers: 5, inFlightCalls: 5,
    mqttSubscriptions: 10, httpEndpoints: 5,
} as const;
export const KVS_LIMITS = { maxKeyLength: 42, maxValueLength: 253, maxKeys: 50 } as const;
export const UNSUPPORTED_ARRAY_METHODS = [
    'map', 'forEach', 'filter', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex',
    'flat', 'flatMap', 'includes', 'fill', 'copyWithin', 'entries', 'keys', 'values',
] as const;
export const UNSUPPORTED_GLOBALS = [
    'Promise', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate',
    'queueMicrotask', 'fetch', 'XMLHttpRequest', 'require', 'process', 'Symbol', 'Proxy', 'Reflect',
    'WeakMap', 'WeakSet',
] as const;
export const DEBUG_LOG_PATH = '/debug/log';
