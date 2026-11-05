import { createScriptEngine } from './engine.js';
import type { ShellyRuntime, ShellyRuntimeOptions } from './types.js';

export function createShellyRuntime(options: ShellyRuntimeOptions = {}): ShellyRuntime {
    return createScriptEngine(options).runtime;
}
