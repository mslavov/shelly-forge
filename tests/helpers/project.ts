import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, onTestFinished } from 'vitest';
import { PACKAGE_ROOT } from '../../src/core/paths.js';

export async function createTempProject(files: Record<string, string> = {}): Promise<{ dir: string; cleanup: () => Promise<void> }> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'shelly-forge-'));
    const cleanup = () => rm(dir, { recursive: true, force: true });
    if (expect.getState().currentTestName) onTestFinished(cleanup);
    try {
        for (const [name, content] of Object.entries(files)) {
            const file = path.resolve(dir, name);
            const relative = path.relative(dir, file);
            if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                throw new Error('Fixture files must stay inside the temporary project');
            }
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, content, 'utf8');
        }
    } catch (error) {
        await cleanup();
        throw error;
    }
    return { dir, cleanup };
}

export function runCli(args: string[], options: { cwd: string; env?: Record<string, string> }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
        execFile(process.execPath, [path.join(PACKAGE_ROOT, 'dist', 'cli.js'), ...args], {
            cwd: options.cwd,
            env: { ...process.env, CURRENT_WORKING_DIRECTORY: options.cwd, NO_COLOR: '1', ...options.env },
            encoding: 'utf8',
        }, (error, stdout, stderr) => {
            if (error && typeof error.code !== 'number') return reject(error);
            resolve({ stdout, stderr, exitCode: typeof error?.code === 'number' ? error.code : 0 });
        });
    });
}
