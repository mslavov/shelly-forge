import type { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runAction, type CommandContext, type CommandResult } from '../core/command.js';
import { ForgeError } from '../core/errors.js';
import { isRecord } from '../core/validation.js';
import { startEmulator, type EmulatorOptions } from '../emulator/index.js';

export interface EmulateOptions {
    port?: number;
    bind?: string;
    model?: string;
    switches?: number;
    kvs?: string;
    components?: string;
    mdns?: boolean;
}

export async function emulate(ctx: CommandContext, options: EmulateOptions = {}): Promise<CommandResult<{ host: string }>> {
    let kvs: Record<string, string> | undefined;
    if (options.kvs !== undefined) {
        let value: unknown;
        try { value = JSON.parse(await readFile(path.resolve(ctx.projectDir, options.kvs), 'utf8')); }
        catch (cause) { throw new ForgeError('USAGE', 'Could not read --kvs as JSON', { cause }); }
        if (!isRecord(value) || Object.values(value).some(item => typeof item !== 'string')) {
            throw new ForgeError('USAGE', '--kvs must contain a JSON object of string values');
        }
        kvs = value as Record<string, string>;
    }
    let components: EmulatorOptions['components'];
    if (options.components !== undefined) {
        let value: unknown;
        try { value = JSON.parse(await readFile(path.resolve(ctx.projectDir, options.components), 'utf8')); }
        catch (cause) { throw new ForgeError('USAGE', 'Could not read --components as JSON', { cause }); }
        if (!isRecord(value)) throw new ForgeError('USAGE', '--components must contain a JSON object');
        for (const [key, entry] of Object.entries(value)) {
            if (!/^[a-z][a-z0-9]*(?::(?:0|[1-9]\d*))?$/.test(key)) {
                throw new ForgeError('USAGE', `Invalid --components key ${JSON.stringify(key)}; expected a lowercase component name with an optional numeric ID`);
            }
            if (!isRecord(entry) || Object.entries(entry).some(([field, data]) => !['status', 'config'].includes(field) || !isRecord(data))) {
                throw new ForgeError('USAGE', `--components entry ${JSON.stringify(key)} must be an object with only optional status and config objects`);
            }
        }
        components = value as EmulatorOptions['components'];
    }
    const emulator = await startEmulator({
        port: options.port ?? 8080, bind: options.bind, switches: options.switches, mdns: options.mdns, kvs, components,
        deviceInfo: options.model === undefined ? undefined : { model: options.model },
        password: ctx.env.SHELLY_EMULATOR_PASSWORD || undefined, logger: ctx.logger,
        onLog: line => ctx.logger.info(`[emulator] ${line.data}`),
        onRpc: method => ctx.logger.debug(`Emulator RPC ${method}`),
    });
    try {
        ctx.logger.info(`Emulator listening on ${emulator.host}`);
        if (ctx.json) ctx.emit({ type: 'ready', host: emulator.host, auth: Boolean(ctx.env.SHELLY_EMULATOR_PASSWORD) }, '');
        await new Promise<void>(resolve => {
            if (ctx.signal.aborted) resolve();
            else ctx.signal.addEventListener('abort', () => resolve(), { once: true });
        });
    } finally { await emulator.close(); }
    return { summary: `Emulator stopped on ${emulator.host}`, data: { host: emulator.host } };
}

export function register(program: Command): void {
    program.command('emulate')
        .description('Run a local Shelly device emulator')
        .option('--port <n>', 'Listen on this port, or 0 for a free port', Number, 8080)
        .option('--bind <address>', 'Listen on this address', '127.0.0.1')
        .option('--model <model>', 'Device model identifier')
        .option('--switches <n>', 'Number of switch components, from 0 to 4', Number, 1)
        .option('--kvs <file>', 'Initial KVS values as a JSON object of strings')
        .option('--components <file>', 'Initial component status and config as a JSON object')
        .option('--mdns', 'Advertise the emulator through multicast DNS')
        .action(async function (this: Command) { await runAction(this, ctx => emulate(ctx, this.opts<EmulateOptions>())); });
}
