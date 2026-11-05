import { randomUUID } from 'node:crypto';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../../src/core/paths.js';
import { createTempProject, runCli } from '../helpers/project.js';
import { spawnCli, type CliProcess } from './process.js';

export interface ScenarioTarget {
    host: string;
    password?: string;
    emulator: boolean;
}

const selector = 'e2e/main';
const scriptName = 'shelly-forge-e2e';
interface Script { id: number; name: string; running: boolean; enable: boolean }
interface Envelope<T> { command: string; ok: boolean; exitCode: number; data: T }

function source(marker: string): string {
    return `const state = Shelly as typeof Shelly & { e2eCounter: number; e2eMarker: string };
state.e2eCounter = 0;
state.e2eMarker = ${JSON.stringify(marker)};
print(state.e2eMarker + ' start');
function tick(): void {
    state.e2eCounter++;
    print(state.e2eMarker + ' counter ' + state.e2eCounter);
}
function onStatus(event: ShellyStatusEvent): void {
    if (event.component === 'switch:0') print(state.e2eMarker + ' switch ' + JSON.stringify(event.delta));
}
Shelly.addStatusHandler(onStatus);
Timer.set(500, true, tick);
`;
}

export function defineScenario(name: string, getTarget: () => ScenarioTarget, timeout = 30000) {
    describe(name, () => {
        let target: ScenarioTarget;
        let project: string;
        let cleanup: (() => Promise<void>) | undefined;
        let originalDebug: boolean | undefined;
        let mayManageScript = false;
        let logsAvailable = true;
        const processes = new Set<CliProcess>();
        const marker = `forge-e2e-${randomUUID()}`;
        const editedMarker = `${marker}-edited`;

        function env(): Record<string, string> {
            return { DEVICE_HOSTNAME: target.host, SHELLY_PASSWORD: target.password ?? '', SHELLY_PUBLIC_GREETING: 'Hello' };
        }
        async function cli<T = Record<string, unknown>>(args: string[], exitCode = 0, overrides = {}): Promise<Envelope<T>> {
            const result = await runCli([...args, '--json'], { cwd: project, env: { ...env(), ...overrides } });
            expect(result.exitCode, result.stdout + result.stderr).toBe(exitCode);
            const envelope = JSON.parse(result.stdout) as Envelope<T>;
            expect(envelope).toMatchObject({ command: args[0], ok: exitCode === 0, exitCode });
            return envelope;
        }
        async function rpc<T = Record<string, unknown>>(method: string, params = {}): Promise<T> {
            return (await cli<T>(['rpc', method, JSON.stringify(params), '--device', target.host])).data;
        }
        function start(args: string[]): CliProcess {
            const process = spawnCli(args, project, env());
            processes.add(process);
            return process;
        }
        async function stop(process: CliProcess, command: string): Promise<void> {
            expect(await process.stop(), JSON.stringify(process.output())).toBe(0);
            expect(process.events.at(-1)).toMatchObject({ command, ok: true, exitCode: 0 });
            processes.delete(process);
        }
        async function writeSource(value: string): Promise<void> {
            await writeFile(path.join(project, 'src/e2e/main.ts'), value);
        }
        async function evalState(expectedMarker: string): Promise<void> {
            const result = await cli<{ result: string }>(['eval', selector, 'JSON.stringify({ counter: Shelly.e2eCounter, marker: Shelly.e2eMarker })']);
            const state = JSON.parse(result.data.result) as { counter: number; marker: string };
            expect(state.marker).toBe(expectedMarker);
            expect(state.counter).toBeGreaterThan(0);
        }
        async function stopProcesses(): Promise<void> {
            const results = await Promise.allSettled([...processes].map(process => process.stop()));
            processes.clear();
            const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
            if (errors.length) throw new AggregateError(errors, 'CLI process cleanup failed');
        }

        afterEach(stopProcesses, 10000);

        beforeAll(async () => {
            target = getTarget();
            const temp = await createTempProject();
            cleanup = temp.cleanup;
            const initialized = await runCli(['init', 'scenario', '--no-skills', '--json'], { cwd: temp.dir });
            expect(initialized.exitCode, initialized.stdout + initialized.stderr).toBe(0);
            expect(JSON.parse(initialized.stdout)).toMatchObject({ command: 'init', ok: true, exitCode: 0 });
            project = path.join(temp.dir, 'scenario');
            const modules = path.join(project, 'node_modules');
            await mkdir(modules);
            for (const dependency of ['shelly-forge', 'typescript']) {
                await symlink(dependency === 'shelly-forge' ? PACKAGE_ROOT : path.join(PACKAGE_ROOT, 'node_modules', dependency), path.join(modules, dependency), 'dir');
            }
            await mkdir(path.join(project, 'src/e2e'), { recursive: true });
            await writeFile(path.join(project, 'solutions.config.json'), JSON.stringify({
                e2e: { main: { src: 'src/e2e/main.ts', device: '${DEVICE_HOSTNAME}', targetScriptName: scriptName, enableOnBoot: true } },
            }));
            await writeSource(source(marker));
            const list = await rpc<{ scripts: Script[] }>('Script.List');
            const dedicated = list.scripts.filter(script => script.name === scriptName);
            expect(dedicated.length, 'Duplicate dedicated scripts make cleanup ambiguous').toBeLessThanOrEqual(1);
            if (dedicated.length === 0 && list.scripts.length >= 10) {
                throw new Error('No free script slot. Free one slot or provide the dedicated shelly-forge-e2e script before running test:device.');
            }
            mayManageScript = true;
            const config = await rpc<{ debug: { websocket: { enable: boolean } } }>('Sys.GetConfig');
            originalDebug = config.debug.websocket.enable;
            const changed = await rpc<{ restart_required: boolean }>('Sys.SetConfig', { config: { debug: { websocket: { enable: true } } } });
            logsAvailable = !changed.restart_required;
            if (!logsAvailable) console.info('Skipping log assertions because Sys.SetConfig reports restart_required. The suite will not reboot the device.');
        }, timeout);

        afterAll(async () => {
            const errors: unknown[] = [];
            try { await stopProcesses(); } catch (error) { errors.push(error); }
            try {
                if (mayManageScript) {
                    const list = await rpc<{ scripts: Script[] }>('Script.List');
                    for (const script of list.scripts.filter(script => script.name === scriptName)) await rpc('Script.Delete', { id: script.id });
                    expect((await rpc<{ scripts: Script[] }>('Script.List')).scripts.some(script => script.name === scriptName)).toBe(false);
                }
            } catch (error) { errors.push(error); }
            try {
                if (originalDebug !== undefined) {
                    await rpc('Sys.SetConfig', { config: { debug: { websocket: { enable: originalDebug } } } });
                    expect((await rpc<{ debug: { websocket: { enable: boolean } } }>('Sys.GetConfig')).debug.websocket.enable).toBe(originalDebug);
                }
            } catch (error) { errors.push(error); }
            await cleanup?.();
            if (errors.length) throw new AggregateError(errors, 'Scenario cleanup failed');
        }, timeout);

        it('builds, checks, deploys, reports healthy status and skips an unchanged redeploy', async () => {
            await cli(['build', selector]);
            await cli(['check', selector]);
            const deploy = await cli<{ scripts: Array<{ status: string }> }>(['deploy', selector, '--verify-timeout', '1000']);
            expect(deploy.data.scripts[0].status).toBe('running');
            const status = await cli<{ scripts: Script[] }>(['status', selector]);
            expect(status.data.scripts[0]).toMatchObject({ running: true, enable: true });
            const repeated = await cli<{ scripts: Array<{ action: string }> }>(['deploy', selector, '--no-build']);
            expect(repeated.data.scripts[0].action).toBe('skipped');
        }, timeout);

        it('reads device information, finds the dedicated script and evaluates the counter', async () => {
            expect(await rpc('Shelly.GetDeviceInfo')).toMatchObject({ id: expect.any(String), gen: expect.any(Number) });
            const list = await rpc<{ scripts: Script[] }>('Script.List');
            expect(list.scripts).toContainEqual(expect.objectContaining({ name: scriptName, running: true }));
            await evalState(marker);
        });

        it('bounds logs by matching lines and duration', async context => {
            if (!logsAvailable) context.skip();
            const logs = start(['logs', selector, '--lines', '2', '--duration', '8', '--grep', marker]);
            expect(await logs.exited, JSON.stringify(logs.output())).toBe(0);
            const lines = logs.events.filter(event => event.type === 'log');
            expect(lines).toHaveLength(2);
            for (const line of lines) expect(line.message).toContain(marker);
            expect(logs.events.at(-1)).toMatchObject({ command: 'logs', ok: true, exitCode: 0, data: { emitted: 2 } });
            processes.delete(logs);
        });

        it('watches an edit, redeploys, streams the new marker and exits on SIGINT', async () => {
            const dev = start(['dev', selector, '--verify-timeout', '1000', ...(!logsAvailable ? ['--no-logs'] : [])]);
            await dev.waitFor(() => dev.events.some(event => event.type === 'dev-cycle' && event.status === 'unchanged'), 'finish its initial dev cycle');
            await writeSource(source(editedMarker));
            await dev.waitFor(() => dev.events.some(event => event.type === 'dev-cycle' && event.status === 'deployed'), 'deploy the edited source');
            if (logsAvailable) await dev.waitFor(() => dev.events.some(event => event.type === 'log' && String(event.message).includes(editedMarker)), 'stream the edited marker');
            await stop(dev, 'dev');
            expect(dev.events.at(-1)).toMatchObject({ data: { failures: 0, deploys: 1 } });
            await evalState(editedMarker);
        }, timeout);

        it('rejects a crashing deploy with exit 5 and restores the previous working code', async () => {
            await writeSource('throw new Error("intentional e2e crash");\n');
            const result = await cli(['deploy', selector, '--verify-timeout', '1000'], 5);
            expect(result).toMatchObject({ error: { code: 'UNHEALTHY', details: { failure: { restored: true } } } });
            await evalState(editedMarker);
            await writeSource(source(editedMarker));
        }, timeout);

        it('rejects a wrong password with an authentication hint', async context => {
            if (!target.emulator || !target.password) context.skip();
            const result = await cli(['deploy', selector], 4, { SHELLY_PASSWORD: 'deliberately-wrong' });
            expect(result).toMatchObject({ error: { code: 'DEVICE_AUTH', hint: expect.stringContaining('SHELLY_PASSWORD') } });
        });

        it('delivers switch status changes to the script handler', async context => {
            if (!target.emulator) context.skip();
            const logs = start(['logs', selector, '--duration', '10']);
            await logs.waitFor(() => logs.events.some(event => event.type === 'log'), 'receive a counter before toggling');
            await rpc('Switch.Toggle', { id: 0 });
            await logs.waitFor(() => logs.events.some(event => event.type === 'log' && String(event.message).includes(`${editedMarker} switch`)), 'receive switch status');
            await stop(logs, 'logs');
        });

        it('restarts an enabled script after reboot and reconnects the same log process', async context => {
            if (!target.emulator) context.skip();
            const logs = start(['logs', selector, '--duration', '12', '--verbose']);
            await logs.waitFor(() => logs.events.some(event => event.type === 'log'), 'receive logs before reboot');
            await rpc('Shelly.Reboot');
            await logs.waitFor(() => logs.output().stderr.includes('retrying in'), 'observe the reboot disconnect');
            const count = logs.events.length;
            await logs.waitFor(() => logs.events.slice(count).some(event => event.type === 'log' && String(event.message).includes(`${editedMarker} counter`)), 'receive counter logs after reconnect');
            await stop(logs, 'logs');
            await evalState(editedMarker);
            expect((await rpc<{ scripts: Script[] }>('Script.List')).scripts).toContainEqual(expect.objectContaining({ name: scriptName, running: true, enable: true }));
        });
    });
}
