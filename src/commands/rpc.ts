import type { Command } from 'commander';
import { runAction, type CommandContext, type CommandResult } from '../core/command.js';
import { ProjectConfig, type DeviceTarget } from '../core/config.js';
import { ForgeError } from '../core/errors.js';
import { deviceKey } from '../core/hosts.js';
import { isRecord } from '../core/validation.js';
import { RpcClient } from '../device/rpc-client.js';

export async function rpcCommand(ctx: CommandContext, method: string, params?: string, options: { device?: string; script?: string } = {}): Promise<CommandResult> {
    let parsed: unknown = {};
    try {
        if (params !== undefined) parsed = JSON.parse(params);
    } catch (cause) {
        throw new ForgeError('USAGE', 'RPC parameters must be valid JSON', { cause });
    }
    if (!isRecord(parsed)) throw new ForgeError('USAGE', 'RPC parameters must be a JSON object');
    if (options.device !== undefined && options.script !== undefined) throw new ForgeError('USAGE', 'Use either --device or --script, not both');
    let target: DeviceTarget;
    if (options.device !== undefined) {
        target = { host: options.device, username: 'admin', password: ctx.env.SHELLY_PASSWORD };
    } else {
        const config = await ProjectConfig.load(ctx.projectDir);
        const devices = new Map<string, DeviceTarget>();
        for (const entry of config.select(options.script)) {
            const device = config.resolveDevice(entry, ctx.env);
            devices.set(deviceKey(device.host), device);
        }
        if (devices.size !== 1) throw new ForgeError('CONFIG', 'RPC needs one device. Use --device <host> or --script <selector>.');
        target = [...devices.values()][0];
    }
    const data = await new RpcClient(target, { logger: ctx.logger }).call(method, parsed);
    return { summary: JSON.stringify(data, null, 2), data };
}

export function register(program: Command): void {
    program
        .command('rpc <method> [params]')
        .description('Call a device RPC method with optional JSON parameters')
        .option('-d, --device <host>', 'Device hostname or IP address')
        .option('-s, --script <selector>', 'Use the device of this script')
        .action(async function (this: Command, method: string, params?: string) {
            await runAction(this, ctx => rpcCommand(ctx, method, params, this.opts()));
        });
}
