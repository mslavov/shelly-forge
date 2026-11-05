import type { Command } from 'commander';
import { buildProject } from '../build/build-project.js';
import { runAction, type CommandContext, type CommandResult } from '../core/command.js';
import { ProjectConfig, validateSelectedTargets, type DeviceTarget, type ScriptEntry } from '../core/config.js';
import { ForgeError, toForgeError } from '../core/errors.js';
import { deviceKey } from '../core/hosts.js';
import { loadProjectEnv } from '../core/project.js';
import { deployScripts, validateVerifyTimeout } from '../deploy/deployer.js';
import { createRebuildQueue } from '../dev/rebuild-queue.js';
import { watchProject, type WatchFactory } from '../dev/watch-project.js';
import { deviceLogEvent, formatDeviceLogLine, streamDeviceLogs } from '../device/log-stream.js';
import { RpcClient } from '../device/rpc-client.js';
import { setDebugWebsocket } from '../device/scripts.js';

export interface DevOptions {
    logs?: boolean;
    keepDebug?: boolean;
    verifyTimeout?: number;
}

export interface DevDependencies {
    watch?: WatchFactory;
    debounceMs?: number;
    inheritedEnv?: NodeJS.ProcessEnv;
}

export interface DevResult {
    cycles: number;
    deploys: number;
    failures: number;
}

function selectScript(config: ProjectConfig, selector: string): ScriptEntry {
    if (!selector) throw new ForgeError('USAGE', 'dev requires a selector for exactly one script');
    try {
        const entries = config.select(selector);
        if (entries.length === 1) return entries[0];
    } catch (cause) {
        throw new ForgeError('USAGE', toForgeError(cause).message, { cause });
    }
    throw new ForgeError('USAGE', 'dev requires a selector for exactly one script');
}

export async function dev(
    ctx: CommandContext, selector: string, options: DevOptions = {}, dependencies: DevDependencies = {},
): Promise<CommandResult<DevResult>> {
    validateVerifyTimeout(options.verifyTimeout);
    const counts: DevResult = { cycles: 0, deploys: 0, failures: 0 };
    const inheritedEnv = { ...(dependencies.inheritedEnv ?? ctx.env) };
    const cycleContext = (): CommandContext => ({ ...ctx, env: loadProjectEnv(ctx.projectDir, { ...inheritedEnv }) });
    const config = await ProjectConfig.load(ctx.projectDir);
    selectScript(config, selector);
    const debugDevices = new Map<string, { rpc: RpcClient; host: string; changed: boolean }>();
    let stream: { target: DeviceTarget; label: string; controller: AbortController; task: Promise<void> } | undefined;
    let shutdownExitCode: number | undefined;
    let revision = 0;

    function reportError(source: string, cause: unknown): void {
        const error = toForgeError(cause);
        if (ctx.json) {
            ctx.emit({ type: 'dev-error', source, error: { code: error.code, message: error.message, hint: error.hint, details: error.details } }, '');
        } else {
            ctx.logger.error(`${source}: ${error.message}`);
            if (error.hint) ctx.logger.error(`hint: ${error.hint}`);
        }
    }

    async function stopLogs(): Promise<void> {
        const previous = stream;
        stream = undefined;
        previous?.controller.abort();
        await previous?.task;
    }

    async function prepareDevice(target: DeviceTarget, entry: ScriptEntry): Promise<void> {
        const key = deviceKey(target.host);
        const rpc = new RpcClient(target, { logger: ctx.logger });
        const state = debugDevices.get(key) ?? { rpc, host: target.host, changed: false };
        const result = await setDebugWebsocket(rpc, true);
        state.changed ||= result.changed;
        state.rpc = rpc;
        debugDevices.set(key, state);
        if (result.changed) ctx.logger.info(`Enabled debug websocket logging on ${target.host}.${result.restartRequired ? ' Device restart required.' : ''}`);
        if (ctx.signal.aborted || options.logs === false) return;
        if (stream?.target.host === target.host && stream.target.password === target.password) {
            stream.label = entry.id;
            return;
        }
        await stopLogs();
        const controller = new AbortController();
        const signal = AbortSignal.any([ctx.signal, controller.signal]);
        const current = { target, label: entry.id, controller, task: Promise.resolve() };
        stream = current;
        current.task = streamDeviceLogs(target, {
            signal, logger: ctx.logger,
            onLine(line) {
                if (!signal.aborted) ctx.emit({ ...deviceLogEvent(line) }, formatDeviceLogLine(line, current.label));
            },
        }).catch(error => {
            if (!signal.aborted) reportError('logs', error);
        }).finally(() => {
            if (stream === current) stream = undefined;
        });
    }

    async function cycle(): Promise<void> {
        if (ctx.signal.aborted) return;
        const started = performance.now();
        const startRevision = revision;
        const cycleNumber = ++counts.cycles;
        let scriptId = selector;
        let status: 'deployed' | 'unchanged' | 'failed' | 'interrupted' | 'superseded' = 'interrupted';
        let failure: ForgeError | undefined;
        try {
            const currentCtx = cycleContext();
            const currentConfig = await ProjectConfig.load(ctx.projectDir);
            const entry = selectScript(currentConfig, selector);
            scriptId = entry.id;
            const targets = validateSelectedTargets(currentConfig, [entry], currentCtx.env);
            const target = targets.get(entry.id);
            if (!target) throw new ForgeError('INTERNAL', `Missing device target for ${entry.id}`);
            if (ctx.signal.aborted) return;
            await prepareDevice(target, entry);
            if (ctx.signal.aborted) return;
            const build = await buildProject(currentCtx, currentConfig, { selector: entry.id });
            if (ctx.signal.aborted) return;
            if (revision !== startRevision) {
                status = 'superseded';
                return;
            }
            const deployment = await deployScripts(currentCtx, currentConfig, build.scripts, { verifyTimeoutMs: options.verifyTimeout }, targets);
            const deployed = deployment.scripts.filter(script => script.action !== 'skipped').length;
            counts.deploys += deployed;
            status = deployed ? 'deployed' : 'unchanged';
        } catch (cause) {
            if (!ctx.signal.aborted) {
                failure = toForgeError(cause);
                counts.failures++;
                status = 'failed';
                if (!ctx.json) reportError(scriptId, failure);
            }
        } finally {
            const durationMs = Math.round(performance.now() - started);
            ctx.emit({
                type: 'dev-cycle', cycle: cycleNumber, script: scriptId, status, durationMs,
                ...(failure ? { error: { code: failure.code, message: failure.message, hint: failure.hint, details: failure.details } } : {}),
            }, `[${scriptId}] cycle ${cycleNumber}: ${status} in ${durationMs} ms`);
        }
    }

    const queue = createRebuildQueue(cycle, { debounceMs: dependencies.debounceMs, onError: error => reportError('dev', error) });
    const watcher = watchProject(ctx.projectDir, {
        watch: dependencies.watch,
        onChange() {
            revision++;
            queue.schedule();
        },
        onError: error => reportError('watch', error),
    });
    try {
        queue.runNow();
        await new Promise<void>(resolve => {
            if (ctx.signal.aborted) resolve();
            else ctx.signal.addEventListener('abort', () => resolve(), { once: true });
        });
    } finally {
        watcher.close();
        await queue.close();
        await stopLogs();
        if (!options.keepDebug) {
            for (const device of debugDevices.values()) {
                if (!device.changed) continue;
                try {
                    await setDebugWebsocket(device.rpc, false);
                    ctx.logger.info(`Restored debug websocket logging on ${device.host}.`);
                } catch (error) {
                    shutdownExitCode = toForgeError(error).exitCode;
                    reportError('debug cleanup', error);
                }
            }
        }
    }
    return {
        summary: `Stopped dev after ${counts.cycles} cycles, ${counts.deploys} deploys, and ${counts.failures} failures.`,
        data: counts,
        ...(shutdownExitCode === undefined ? {} : { exitCode: shutdownExitCode }),
    };
}

export function register(program: Command): void {
    program
        .command('dev <selector>')
        .description('Watch, build, deploy, and stream logs')
        .option('--no-logs', 'Do not stream device logs')
        .option('--keep-debug', 'Leave debug logging enabled on exit')
        .option('--verify-timeout <ms>', 'Health check timeout in milliseconds', Number, 3000)
        .action(async function (this: Command, selector: string) {
            // Capture inherited values before runAction loads .env so later edits can replace file values.
            const inheritedEnv = { ...process.env };
            await runAction(this, ctx => dev(ctx, selector, this.opts<DevOptions>(), { inheritedEnv }));
        });
}
