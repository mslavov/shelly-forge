import type { Command } from 'commander';
import { runAction, type CommandContext, type CommandResult } from '../core/command.js';
import { ProjectConfig } from '../core/config.js';
import { toForgeError, type ErrorCode } from '../core/errors.js';
import { RpcClient } from '../device/rpc-client.js';
import { DeviceScripts, type DeviceScriptStatus } from '../device/scripts.js';

export interface ScriptStatusResult extends Partial<DeviceScriptStatus> {
    id: number | undefined;
    script: string;
    host: string;
    targetScriptName: string;
    enable?: boolean;
    missing?: boolean;
    error?: { code: ErrorCode; message: string; hint?: string };
}

export async function statusProject(ctx: CommandContext, selector?: string): Promise<CommandResult<{ scripts: ScriptStatusResult[] }>> {
    const config = await ProjectConfig.load(ctx.projectDir);
    const scripts: ScriptStatusResult[] = [];
    let exitCode = 0;
    for (const entry of config.select(selector)) {
        const target = config.resolveDevice(entry, ctx.env);
        const row: ScriptStatusResult = { id: undefined, script: entry.id, host: target.host, targetScriptName: entry.targetScriptName };
        try {
            const device = new DeviceScripts(new RpcClient(target, { logger: ctx.logger }));
            const script = await device.findByName(entry.targetScriptName);
            if (!script) {
                row.missing = true;
                if (exitCode === 0) exitCode = 5;
            } else {
                Object.assign(row, await device.getStatus(script.id), { enable: script.enable });
                if ((row.errors?.length || row.error_msg) && exitCode === 0) exitCode = 5;
            }
        } catch (error) {
            const failure = toForgeError(error);
            row.error = { code: failure.code, message: failure.message, hint: failure.hint };
            exitCode = 4;
        }
        scripts.push(row);
    }
    const lines = ['Script\tHost\tTarget\tRunning\tEnable\tMemory used/peak/free\tCPU\tErrors'];
    for (const row of scripts) lines.push([
        row.script, row.host, row.targetScriptName, row.running ?? '-', row.enable ?? '-',
        `${row.mem_used ?? '-'}/${row.mem_peak ?? '-'}/${row.mem_free ?? '-'}`, row.cpu ?? '-',
        row.error?.message ?? (row.missing ? 'missing' : [...(row.errors ?? []), row.error_msg].filter(Boolean).join('; ') || '-'),
    ].join('\t'));
    return { summary: lines.join('\n'), data: { scripts }, exitCode };
}

export function register(program: Command): void {
    program
        .command('status [selector]')
        .description('Show on-device script status')
        .action(async function (this: Command, selector?: string) {
            await runAction(this, ctx => statusProject(ctx, selector));
        });
}
