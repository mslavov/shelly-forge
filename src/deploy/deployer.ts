import { setTimeout as delay } from 'node:timers/promises';
import type { BuiltScript } from '../build/build-project.js';
import type { CommandContext } from '../core/command.js';
import { validateSelectedTargets, type DeviceTarget, type ProjectConfig } from '../core/config.js';
import { ForgeError, toForgeError } from '../core/errors.js';
import { sha256 } from '../core/hash.js';
import { deviceKey } from '../core/hosts.js';
import { SCRIPT_MAX_BYTES } from '../core/runtime-profile.js';
import { RpcClient } from '../device/rpc-client.js';
import { DeviceScripts, type DeviceScriptStatus } from '../device/scripts.js';
import { deployCacheKey, invalidateDeployCache, readDeployCache, readLastGood, recordDeployment } from './deploy-cache.js';

export type DeployScript = Pick<BuiltScript, 'entry' | 'code' | 'sizeBytes' | 'sha256'>;

export interface DeployOptions {
    force?: boolean;
    dryRun?: boolean;
    verify?: boolean;
    rollback?: boolean;
    verifyTimeoutMs?: number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    now?: () => number;
}

export interface DeployScriptResult {
    id: string;
    host: string;
    targetScriptName: string;
    action: 'created' | 'updated' | 'skipped' | 'failed';
    sizeBytes: number;
    status: 'running' | 'unchanged' | 'planned' | 'unverified' | 'failed';
    scriptId?: number;
}

export interface DeployResult {
    scripts: DeployScriptResult[];
    dryRun: boolean;
}

interface DeployDevice {
    scripts: DeviceScripts;
    verificationSignal?: AbortSignal;
}

function checkCancelled(ctx: CommandContext): void {
    if (ctx.signal.aborted) throw new ForgeError('DEPLOY', 'Deployment interrupted', {
        hint: 'Inspect the device with shelly-forge status before deploying again.',
    });
}

async function verifyRunning(ctx: CommandContext, device: DeployDevice, id: number, timeoutMs: number, options: DeployOptions): Promise<DeviceScriptStatus> {
    const now = options.now ?? (() => performance.now());
    const sleep = options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
    const deadline = now() + timeoutMs;
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]);
    device.verificationSignal = signal;
    let status: DeviceScriptStatus | undefined;
    let healthyPolls = 0;
    try {
        while (now() < deadline && !signal.aborted) {
            checkCancelled(ctx);
            status = await device.scripts.getStatus(id);
            checkCancelled(ctx);
            if (status.errors?.length || status.error_msg || !status.running) {
                const errors = [...(status.errors ?? []), status.error_msg, ...(!status.running ? ['not running'] : [])].filter(Boolean);
                throw new ForgeError('UNHEALTHY', `Script ${id} failed: ${errors.join('; ')}`, { details: status });
            }
            if (now() > deadline || signal.aborted) break;
            healthyPolls++;
            const nextPoll = Math.min(deadline, now() + 500);
            while (now() < nextPoll) {
                await sleep(nextPoll - now(), ctx.signal);
            }
            checkCancelled(ctx);
            if (now() >= deadline) return status;
        }
    } catch (cause) {
        checkCancelled(ctx);
        if (cause instanceof ForgeError && cause.code === 'UNHEALTHY') throw cause;
        if (!signal.aborted) throw cause;
    } finally {
        device.verificationSignal = undefined;
    }
    if (healthyPolls > 0 && status) return status;
    throw new ForgeError('UNHEALTHY', `Script ${id} did not pass verification within ${timeoutMs} ms`, { details: status });
}

export function validateVerifyTimeout(timeoutMs = 3000): number {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 0xffffffff) {
        throw new ForgeError('USAGE', 'Verify timeout must be a positive integer of at most 4294967295 milliseconds');
    }
    return timeoutMs;
}

export async function deployScripts(ctx: CommandContext, config: ProjectConfig, scripts: readonly DeployScript[], options: DeployOptions = {},
    resolvedTargets?: ReadonlyMap<string, DeviceTarget>): Promise<DeployResult> {
    const timeoutMs = validateVerifyTimeout(options.verifyTimeoutMs);
    const validatedTargets = resolvedTargets ?? validateSelectedTargets(config, scripts.map(script => script.entry), ctx.env);
    const targets = scripts.map(script => {
        const sizeBytes = Buffer.byteLength(script.code);
        if (sizeBytes === 0 || sizeBytes > SCRIPT_MAX_BYTES) throw new ForgeError('BUILD', `${script.entry.id} has ${sizeBytes} bytes; scripts must contain 1 to ${SCRIPT_MAX_BYTES} bytes`);
        if (script.sizeBytes !== sizeBytes || script.sha256 !== sha256(script.code)) throw new ForgeError('BUILD', `Artifact integrity mismatch for ${script.entry.id}`);
        const target = validatedTargets.get(script.entry.id);
        if (!target) throw new ForgeError('INTERNAL', `Missing device target for ${script.entry.id}`);
        return { script, target };
    });
    const cache = await readDeployCache(config.projectDir);
    const result: DeployResult = { scripts: [], dryRun: options.dryRun ?? false };
    const devices = new Map<string, DeployDevice>();
    for (const { script, target } of targets) {
        checkCancelled(ctx);
        const { entry } = script;
        const item: DeployScriptResult = {
            id: entry.id, host: target.host, targetScriptName: entry.targetScriptName,
            sizeBytes: script.sizeBytes, action: 'failed', status: 'failed',
        };
        try {
            const key = JSON.stringify([deviceKey(target.host), target.password]);
            let connection = devices.get(key);
            if (!connection) {
                const created: DeployDevice = {
                    scripts: new DeviceScripts(new RpcClient(target, {
                        logger: ctx.logger,
                        fetch: (input, init) => fetch(input, {
                            ...init,
                            signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), ...(created.verificationSignal ? [created.verificationSignal] : [])]),
                        }),
                    })),
                };
                devices.set(key, created);
                connection = created;
            }
            const device = connection.scripts;
            const existing = await device.findByName(entry.targetScriptName);
            checkCancelled(ctx);
            const cached = cache[deployCacheKey(target.host, entry.targetScriptName)];
            if (!options.force && existing && cached?.sha256 === script.sha256 && cached.scriptId === existing.id
                && existing.enable === entry.enableOnBoot && existing.running === true) {
                result.scripts.push({ ...item, scriptId: existing.id, action: 'skipped', status: options.dryRun ? 'planned' : 'unchanged' });
                ctx.logger.info(`${entry.id}: unchanged`);
                continue;
            }
            item.action = existing ? 'updated' : 'created';
            if (options.dryRun) {
                result.scripts.push({ ...item, scriptId: existing?.id, status: 'planned' });
                ctx.logger.info(`${entry.id}: would ${existing ? 'update' : 'create'} ${script.sizeBytes} bytes on ${target.host}`);
                continue;
            }
            const previous = options.rollback === false ? undefined : await readLastGood(config.projectDir, target.host, entry.targetScriptName);
            checkCancelled(ctx);
            // A failed or unverified upload must not leave an old hash eligible for a cache skip.
            await invalidateDeployCache(config.projectDir, target.host, entry.targetScriptName);
            checkCancelled(ctx);
            const id = existing?.id ?? await device.create(entry.targetScriptName);
            item.scriptId = id;
            checkCancelled(ctx);
            // Finish replacing and starting the script before honoring an interrupt.
            await device.stop(id);
            ctx.logger.info(`${entry.id}: uploading ${script.sizeBytes} bytes`);
            try {
                await device.putCode(id, script.code);
            } catch (cause) {
                throw new ForgeError('DEPLOY', `Upload failed for ${entry.id}: ${toForgeError(cause).message}`, {
                    cause, hint: 'The on-device script is stopped and may be partially written. Run shelly-forge deploy again to upload the complete artifact.',
                    details: { cause: toForgeError(cause).code },
                });
            }
            await device.setConfig(id, { name: entry.targetScriptName, enable: entry.enableOnBoot });
            try {
                await device.start(id);
                checkCancelled(ctx);
                if (options.verify !== false) {
                    ctx.logger.info(`${entry.id}: verifying`);
                    await verifyRunning(ctx, connection, id, timeoutMs, options);
                }
            } catch (cause) {
                checkCancelled(ctx);
                const failure = toForgeError(cause);
                let restored = false;
                let rollbackError: string | undefined;
                if (previous && previous !== script.code) {
                    try {
                        ctx.logger.info(`${entry.id}: restoring previous version`);
                        checkCancelled(ctx);
                        await device.stop(id);
                        await device.putCode(id, previous);
                        await device.setConfig(id, { name: entry.targetScriptName, enable: entry.enableOnBoot });
                        await device.start(id);
                        checkCancelled(ctx);
                        await verifyRunning(ctx, connection, id, timeoutMs, options);
                        await recordDeployment(config.projectDir, target.host, entry.targetScriptName, id, previous);
                        checkCancelled(ctx);
                        restored = true;
                    } catch (error) {
                        checkCancelled(ctx);
                        rollbackError = toForgeError(error).message;
                    }
                }
                throw new ForgeError('UNHEALTHY', `${entry.id}: ${failure.message}.${restored ? ' The previous version was restored.' : rollbackError ? ` Rollback failed: ${rollbackError}` : ' The new version was not verified.'}`, {
                    cause, hint: `Run shelly-forge status ${entry.id} and shelly-forge logs ${entry.id} to inspect the device.`,
                    details: { failure: failure.details, restored, rollbackError },
                });
            }
            if (options.verify !== false) {
                checkCancelled(ctx);
                await recordDeployment(config.projectDir, target.host, entry.targetScriptName, id, script.code);
                checkCancelled(ctx);
            }
            item.status = options.verify === false ? 'unverified' : 'running';
            result.scripts.push(item);
            ctx.logger.info(`${entry.id}: done${options.verify === false ? ' without verification' : ''}`);
        } catch (cause) {
            const failure = toForgeError(cause);
            result.scripts.push({ ...item, action: 'failed', status: 'failed' });
            throw new ForgeError(failure.code, failure.message, {
                cause, hint: failure.hint, details: { scripts: result.scripts, failure: failure.details },
            });
        }
    }
    return result;
}
