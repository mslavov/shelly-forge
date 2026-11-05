import type { Command } from 'commander';
import path from 'node:path';
import { toForgeError } from './errors.js';
import { createLogger, type Logger } from './logger.js';
import { loadProjectEnv, resolveProjectDir } from './project.js';

export interface CommandContext {
    projectDir: string;
    logger: Logger;
    json: boolean;
    verbose: boolean;
    signal: AbortSignal;
    env: NodeJS.ProcessEnv;
    isInteractive: boolean;
    emit(event: Record<string, unknown>, text: string): void;
}

export interface CommandResult<T = unknown> {
    summary: string;
    data?: T;
    exitCode?: number;
}

export function createContext(
    globalOptions: { cwd?: string; json?: boolean; verbose?: boolean; quiet?: boolean },
    overrides: Partial<CommandContext> = {},
): CommandContext {
    const projectDir = overrides.projectDir ?? resolveProjectDir(globalOptions.cwd, overrides.env);
    const env = loadProjectEnv(projectDir, overrides.env ?? process.env);
    const json = overrides.json ?? globalOptions.json ?? false;
    const verbose = overrides.verbose ?? globalOptions.verbose ?? false;
    return {
        projectDir,
        env,
        json,
        verbose,
        logger: createLogger({
            level: globalOptions.quiet ? 'quiet' : verbose ? 'verbose' : 'info',
            color: !json,
            logFile: path.join(projectDir, '.shelly-forge', 'logs', 'forge.log'),
        }),
        signal: new AbortController().signal,
        isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY && !json),
        emit: (event, text) => process.stdout.write(`${json ? JSON.stringify(event) : text}\n`),
        ...overrides,
    };
}

export async function runAction(command: Command, handler: (ctx: CommandContext) => Promise<CommandResult>): Promise<void> {
    const options = command.optsWithGlobals();
    const controller = new AbortController();
    let interrupts = 0;
    const interrupt = () => {
        if (++interrupts > 1) process.exit(130);
        controller.abort();
    };
    const terminate = () => controller.abort();
    let ctx: CommandContext | undefined;
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    try {
        ctx = createContext(options, { signal: controller.signal });
        const result = await handler(ctx);
        const exitCode = result.exitCode ?? 0;
        process.stdout.write(`${ctx.json ? JSON.stringify({ ok: exitCode === 0, command: command.name(), exitCode, summary: result.summary, data: result.data }) : result.summary}\n`);
        process.exitCode = exitCode;
    } catch (error) {
        const failure = toForgeError(error);
        if (ctx?.json ?? options.json) {
            process.stdout.write(`${JSON.stringify({ ok: false, command: command.name(), exitCode: failure.exitCode, error: {
                code: failure.code, message: failure.message, hint: failure.hint, details: failure.details,
            } })}\n`);
        } else {
            const logger = ctx?.logger ?? createLogger({ level: options.verbose ? 'verbose' : 'info' });
            logger.error(`error: ${failure.message}`);
            if (failure.hint) logger.error(`hint: ${failure.hint}`);
            if (options.verbose && failure.stack) logger.debug(failure.stack);
        }
        process.exitCode = failure.exitCode;
    } finally {
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', terminate);
    }
}
