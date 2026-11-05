import { Argument, type Command } from 'commander';
import { runAction, type CommandContext, type CommandResult } from '../core/command.js';
import { ProjectConfig, type DeviceTarget } from '../core/config.js';
import { ForgeError } from '../core/errors.js';
import { deviceKey } from '../core/hosts.js';
import { RpcClient } from '../device/rpc-client.js';
import { setDebugWebsocket } from '../device/scripts.js';

export interface DebugResult {
    host: string;
    enabled: boolean;
    changed: boolean;
    restartRequired: boolean;
}

export async function debugCommand(ctx: CommandContext, mode: string, selector?: string): Promise<CommandResult<{ devices: DebugResult[] }>> {
    if (mode !== 'on' && mode !== 'off') throw new ForgeError('USAGE', 'Debug mode must be on or off');
    const config = await ProjectConfig.load(ctx.projectDir);
    const targets = new Map<string, DeviceTarget>();
    for (const entry of config.select(selector)) {
        const target = config.resolveDevice(entry, ctx.env);
        targets.set(deviceKey(target.host), target);
    }
    const devices: DebugResult[] = [];
    for (const target of targets.values()) {
        const result = await setDebugWebsocket(new RpcClient(target, { logger: ctx.logger }), mode === 'on');
        devices.push({ host: target.host, enabled: mode === 'on', ...result });
    }
    return {
        summary: devices.map(device => `${device.host}: debug ${mode}, ${device.changed ? 'changed' : 'unchanged'}${device.restartRequired ? ', restart required' : ''}`).join('\n'),
        data: { devices },
    };
}

export function register(program: Command): void {
    program
        .command('debug')
        .description('Enable or disable device debug logging')
        .addArgument(new Argument('<on|off>', 'Debug logging mode').choices(['on', 'off']))
        .argument('[selector]', 'Script selector')
        .action(async function (this: Command, mode: string, selector?: string) {
            await runAction(this, ctx => debugCommand(ctx, mode, selector));
        });
}
