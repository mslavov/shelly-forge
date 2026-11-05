import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PACKAGE_ROOT } from '../../src/core/paths.js';

export function spawnCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
    const child = spawn(process.execPath, [path.join(PACKAGE_ROOT, 'dist/cli.js'), ...args, '--json'], {
        cwd,
        env: { ...process.env, CURRENT_WORKING_DIRECTORY: cwd, NO_COLOR: '1', SHELLY_PASSWORD: '', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const events: Record<string, unknown>[] = [];
    let pending = '';
    let invalidLine: string | undefined;
    child.stdout.on('data', chunk => {
        stdout += String(chunk);
        pending += String(chunk);
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            try {
                events.push(JSON.parse(line) as Record<string, unknown>);
            } catch {
                invalidLine ??= line;
            }
        }
    });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    const exited = new Promise<number | null>((resolve, reject) => {
        child.once('error', error => { finished = true; reject(error); });
        child.once('close', code => { finished = true; resolve(code); });
    });
    async function waitFor(predicate: () => boolean, label: string, timeout = 15000): Promise<void> {
        const deadline = Date.now() + timeout;
        while (true) {
            if (invalidLine !== undefined) throw new Error(`CLI emitted non-JSON stdout: ${invalidLine}\n${stderr}`);
            if (predicate()) return;
            if (finished || Date.now() >= deadline) throw new Error(`CLI did not ${label}\n${stdout}\n${stderr}`);
            await delay(25);
        }
    }
    async function stop(): Promise<number | null> {
        if (finished) return exited;
        child.kill('SIGINT');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
        try { return await exited; } finally { clearTimeout(timer); }
    }
    return { events, exited, waitFor, stop, output: () => ({ stdout, stderr }) };
}

export type CliProcess = ReturnType<typeof spawnCli>;
