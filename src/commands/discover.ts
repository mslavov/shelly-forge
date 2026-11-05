import type { Command } from 'commander';
import { runAction, type CommandContext, type CommandResult } from '../core/command.js';
import { ForgeError } from '../core/errors.js';
import { discoverDevices, type DiscoveredDevice } from '../device/discovery.js';

export interface DiscoverOptions {
    duration?: number;
}

export function register(program: Command): void {
    program
        .command('discover')
        .description('Discover Shelly devices on the network')
        .option('--duration <seconds>', 'Discovery duration in seconds', Number, 5)
        .action(async function (this: Command) {
            await runAction(this, ctx => discover(ctx, this.opts<DiscoverOptions>()));
        });
}

export async function discover(
    ctx: CommandContext, options: DiscoverOptions = {}, find: typeof discoverDevices = discoverDevices,
): Promise<CommandResult<DiscoveredDevice[]>> {
    const duration = options.duration ?? 5;
    if (!Number.isInteger(duration) || duration < 1 || duration * 1000 > 2147483647) {
        throw new ForgeError('USAGE', '--duration must be a positive integer no greater than 2147483 seconds');
    }
    const devices = await find({ durationMs: duration * 1000, signal: ctx.signal });
    if (devices.length === 0) return { summary: 'No Shelly devices found.', data: devices };
    const rows = [
        ['Name', 'Host', 'Model', 'Gen', 'Firmware', 'Auth'],
        ...devices.map(device => [device.name, device.host, device.model ?? '-', String(device.gen ?? '-'),
            device.ver ?? device.fw_id ?? '-', device.authRequired ? 'required' : device.reachable ? 'no' : 'unknown']),
    ].map(row => row.map(cell => cell.replace(/[\x00-\x1f\x7f]/g, ' ')));
    const widths = rows[0].map((_, i) => Math.max(...rows.map(row => row[i].length)));
    const table = rows.map(row => row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
    return { summary: `Found ${devices.length} Shelly devices.\n${table}`, data: devices };
}
