import type { Command } from 'commander';
import { runAction, type CommandContext, type CommandResult } from '../core/command.js';
import { ProjectConfig } from '../core/config.js';
import { ForgeError } from '../core/errors.js';
import { RpcClient } from '../device/rpc-client.js';
import { DeviceScripts } from '../device/scripts.js';

export async function evalCommand(ctx: CommandContext, selector: string, code: string): Promise<CommandResult> {
    const config = await ProjectConfig.load(ctx.projectDir);
    const [entry] = config.select(selector);
    const target = config.resolveDevice(entry, ctx.env);
    const device = new DeviceScripts(new RpcClient(target, { logger: ctx.logger }));
    const script = await device.findByName(entry.targetScriptName);
    if (!script) throw new ForgeError('UNHEALTHY', `On-device script "${entry.targetScriptName}" is missing on ${target.host}`, {
        hint: `Run shelly-forge deploy ${entry.id} first.`,
    });
    const data = await device.eval(script.id, code);
    return { summary: JSON.stringify(data, null, 2), data };
}

export function register(program: Command): void {
    program
        .command('eval <selector> <code>')
        .description('Evaluate code in a running script')
        .action(async function (this: Command, selector: string, code: string) {
            await runAction(this, ctx => evalCommand(ctx, selector, code));
        });
}
