import { isRecord } from '../core/validation.js';
import type { DeviceState } from '../testing/device-state.js';
import { RpcError } from '../testing/errors.js';
import type { ScriptManager } from './scripts.js';

export const RPC_METHODS = [
    'Shelly.GetDeviceInfo', 'Shelly.GetStatus', 'Shelly.GetConfig', 'Shelly.ListMethods', 'Shelly.Reboot',
    'Sys.GetStatus', 'Sys.GetConfig', 'Sys.SetConfig',
    'Switch.GetStatus', 'Switch.Set', 'Switch.Toggle',
    'KVS.Set', 'KVS.Get', 'KVS.GetMany', 'KVS.List', 'KVS.Delete',
    'Script.List', 'Script.Create', 'Script.Delete', 'Script.GetConfig', 'Script.SetConfig',
    'Script.PutCode', 'Script.GetCode', 'Script.Start', 'Script.Stop', 'Script.GetStatus', 'Script.Eval',
] as const;

const CANONICAL_METHODS = new Map(RPC_METHODS.map(method => [method.toLowerCase(), method]));

export class RpcRouter {
    debugEnabled = false;

    constructor(private readonly device: DeviceState, private readonly scripts: ScriptManager, private readonly reboot: () => void) {}

    private sysConfig(): Record<string, unknown> { return { debug: { websocket: { enable: this.debugEnabled } } }; }

    private methods(): string[] {
        const methods = new Set<string>(RPC_METHODS);
        for (const component of this.device.componentKeys()) {
            const type = component.split(':')[0];
            for (const action of ['GetStatus', 'GetConfig']) {
                const method = this.device.canonical(`${type}.${action}`);
                if (method) methods.add(method);
            }
        }
        return [...methods];
    }

    call(requested: string, params: Record<string, unknown>): unknown {
        const method = CANONICAL_METHODS.get(requested.toLowerCase()) ?? this.device.canonical(requested);
        if (method === undefined) throw new RpcError(404, `No handler for ${requested}`);
        if (method.startsWith('Script.')) return this.scripts.call(method, params);
        switch (method) {
            case 'Shelly.ListMethods': return { methods: this.methods() };
            case 'Shelly.Reboot': this.reboot(); return {};
            case 'Sys.GetConfig': return this.sysConfig();
            case 'Sys.SetConfig': {
                const config = params.config;
                if (!isRecord(config)) throw new RpcError(-103, 'Invalid debug config');
                if (isRecord(config.debug) && isRecord(config.debug.websocket) && Object.hasOwn(config.debug.websocket, 'enable')) {
                    if (typeof config.debug.websocket.enable !== 'boolean') throw new RpcError(-103, 'Invalid debug config');
                    this.debugEnabled = config.debug.websocket.enable;
                }
                return { restart_required: false };
            }
            case 'Shelly.GetConfig':
                return {
                    sys: this.sysConfig(),
                    ...Object.fromEntries(this.device.componentKeys().filter(key => key !== 'sys').map(key => [key, this.device.getConfig(key)])),
                    ...Object.fromEntries(this.scripts.list().map(script => [`script:${script.id}`, {
                        id: script.id, name: script.name, enable: script.enable,
                    }])),
                };
            case 'Shelly.GetStatus':
                return {
                    sys: this.device.getStatus('sys'),
                    ...Object.fromEntries(this.device.componentKeys().filter(key => key !== 'sys').map(key => [key, this.device.getStatus(key)])),
                    ...Object.fromEntries(this.scripts.list().map(script => [`script:${script.id}`, this.scripts.status(script.id)])),
                };
            default: return this.device.call(method, params);
        }
    }
}
