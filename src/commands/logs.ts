import type { Command } from 'commander';
import { runAction, type CommandContext, type CommandResult } from '../core/command.js';
import { ProjectConfig, type DeviceTarget } from '../core/config.js';
import { ForgeError } from '../core/errors.js';
import { deviceKey } from '../core/hosts.js';
import { deviceLogEvent, formatDeviceLogLine, streamDeviceLogs } from '../device/log-stream.js';
import { RpcClient } from '../device/rpc-client.js';
import { setDebugWebsocket } from '../device/scripts.js';

export interface LogsOptions {
    duration?: number;
    lines?: number;
    grep?: string;
    enableDebug?: boolean;
}

export interface LogsResult {
    devices: Array<{ device: string; lines: number }>;
    lines: number;
    emitted: number;
}

export function register(program: Command): void {
    program
        .command('logs [selector]')
        .description('Stream device logs')
        .option('--duration <seconds>', 'Stop after this many seconds', Number)
        .option('--lines <n>', 'Stop after this many matching lines', Number)
        .option('--grep <pattern>', 'Filter logs by regular expression')
        .option('--no-enable-debug', 'Do not enable debug logging automatically')
        .action(async function (this: Command) {
            await runAction(this, ctx => logs(ctx, this.args[0], this.opts<LogsOptions>()));
        });
}

export async function logs(ctx: CommandContext, selector?: string, options: LogsOptions = {}): Promise<CommandResult<LogsResult>> {
    if (options.duration !== undefined && (!Number.isFinite(options.duration) || options.duration <= 0 || options.duration * 1000 > 2147483647)) {
        throw new ForgeError('USAGE', '--duration must be a positive number of seconds no greater than 2147483.647');
    }
    if (options.lines !== undefined && (!Number.isSafeInteger(options.lines) || options.lines < 1)) {
        throw new ForgeError('USAGE', '--lines must be a positive integer');
    }
    let filter: RegExp | undefined;
    try {
        filter = options.grep === undefined ? undefined : new RegExp(options.grep);
    } catch {
        throw new ForgeError('USAGE', '--grep must be a valid regular expression');
    }
    const config = await ProjectConfig.load(ctx.projectDir);
    const devices = new Map<string, { target: DeviceTarget; label: string; lines: number }>();
    for (const entry of config.select(selector)) {
        const target = config.resolveDevice(entry, ctx.env);
        const key = deviceKey(target.host);
        if (!devices.has(key)) devices.set(key, { target, label: selector ? entry.id : target.host, lines: 0 });
    }
    const controller = new AbortController();
    const signal = AbortSignal.any([ctx.signal, controller.signal]);
    const timer = options.duration === undefined ? undefined : setTimeout(() => controller.abort(), options.duration * 1000);
    let lines = 0;
    let emitted = 0;
    const streams = [...devices.values()].map(async device => {
        if (signal.aborted) return;
        if (options.enableDebug !== false) {
            const rpc = new RpcClient(device.target, {
                logger: ctx.logger,
                fetch: (input, init) => fetch(input, {
                    ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
                }),
            });
            const result = await setDebugWebsocket(rpc, true).catch(error => {
                if (!signal.aborted) throw error;
                return undefined;
            });
            if (!result || signal.aborted) return;
            if (result.changed) {
                ctx.logger.info(`Enabled debug websocket logging on ${device.target.host}.${result.restartRequired ? ' Device restart required.' : ''}`);
            }
        }
        await streamDeviceLogs(device.target, {
            signal, logger: ctx.logger,
            onLine(line) {
                if (signal.aborted) return;
                device.lines++;
                lines++;
                if (filter && !filter.test(line.message)) return;
                ctx.emit({ ...deviceLogEvent(line) }, formatDeviceLogLine(line, device.label));
                emitted++;
                if (options.lines !== undefined && emitted >= options.lines) controller.abort();
            },
        });
    });
    try {
        await Promise.all(streams);
    } finally {
        controller.abort();
        if (timer !== undefined) clearTimeout(timer);
        await Promise.allSettled(streams);
    }
    const counts = [...devices.values()].map(device => ({ device: device.target.host, lines: device.lines }));
    return {
        summary: [`Received ${lines} log lines from ${counts.length} devices.`, ...counts.map(device => `[${device.device}] ${device.lines} lines`)].join('\n'),
        data: { devices: counts, lines, emitted },
    };
}
