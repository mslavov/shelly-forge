import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, expect, test, vi } from 'vitest';
import { runAction } from '../../src/core/command.js';
import { EXIT_CODES, ForgeError, type ErrorCode } from '../../src/core/errors.js';
import { PACKAGE_ROOT } from '../../src/core/paths.js';
import { createTempProject } from '../helpers/project.js';

const originalExitCode = process.exitCode;
afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
});

async function fixture(flags: { json?: boolean; verbose?: boolean; quiet?: boolean } = {}) {
    const { dir } = await createTempProject();
    const program = new Command('shelly-forge')
        .option('--cwd <dir>').option('--json').option('--verbose').option('--quiet');
    program.setOptionValue('cwd', dir);
    for (const [key, value] of Object.entries(flags)) program.setOptionValue(key, value);
    const command = program.command('fixture');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    return {
        dir, command,
        stdout: () => stdout.mock.calls.map(([text]) => String(text)).join(''),
        stderr: () => stderr.mock.calls.map(([text]) => String(text)).join(''),
    };
}

test('prints a text result and resets the exit code on success', async () => {
    const f = await fixture();
    process.exitCode = 7;
    await runAction(f.command, async ctx => {
        expect(ctx.projectDir).toBe(f.dir);
        return { summary: 'Done', data: { count: 2 } };
    });
    expect(f.stdout()).toBe('Done\n');
    expect(f.stderr()).toBe('');
    expect(process.exitCode).toBe(0);
});

test.each([0, 4, 5])('prints a JSON envelope using the command name and exit code %i', async exitCode => {
    const f = await fixture({ json: true });
    await runAction(f.command, async ctx => {
        expect(ctx.json).toBe(true);
        return { summary: 'Done', data: { count: 2 }, exitCode };
    });
    expect(JSON.parse(f.stdout())).toEqual({ ok: exitCode === 0, command: 'fixture', exitCode, summary: 'Done', data: { count: 2 } });
    expect(f.stderr()).toBe('');
    expect(process.exitCode).toBe(exitCode);
});

test('omits undefined data from the JSON envelope', async () => {
    const f = await fixture({ json: true });
    await runAction(f.command, async () => ({ summary: 'Done' }));
    expect(JSON.parse(f.stdout())).toEqual({ ok: true, command: 'fixture', exitCode: 0, summary: 'Done' });
});

test('reports one concise error line and optional hint in text mode', async () => {
    const f = await fixture();
    await runAction(f.command, async () => { throw new ForgeError('CONFIG', 'Invalid config', { hint: 'Check the file' }); });
    expect(f.stderr()).toBe('error: Invalid config\nhint: Check the file\n');
    expect(f.stdout()).toBe('');
    expect(process.exitCode).toBe(2);
});

test('prints the stack only with verbose output', async () => {
    const f = await fixture({ verbose: true });
    await runAction(f.command, async () => { throw new Error('broken'); });
    expect(f.stderr()).toContain('error: broken\n');
    expect(f.stderr()).toContain('ForgeError: broken');
    expect(process.exitCode).toBe(1);
});

test.each(Object.entries(EXIT_CODES) as [ErrorCode, number][])('reports %s in JSON with exit code %i', async (code, exitCode) => {
    const f = await fixture({ json: true });
    await runAction(f.command, async () => { throw new ForgeError(code, 'Failed', { hint: 'Retry', details: { count: 1 } }); });
    expect(JSON.parse(f.stdout())).toEqual({ ok: false, command: 'fixture', exitCode, error: { code, message: 'Failed', hint: 'Retry', details: { count: 1 } } });
    expect(f.stderr()).toBe('');
    expect(process.exitCode).toBe(exitCode);
});

test('wraps an unknown thrown value as INTERNAL', async () => {
    const f = await fixture({ json: true });
    await runAction(f.command, async () => { throw 'broken'; });
    expect(JSON.parse(f.stdout()).error).toEqual({ code: 'INTERNAL', message: 'broken' });
    expect(process.exitCode).toBe(1);
});

test('quiet hides progress, not the result, warnings, or errors', async () => {
    const f = await fixture({ quiet: true });
    await runAction(f.command, async ctx => {
        ctx.logger.info('hidden'); ctx.logger.success('hidden'); ctx.logger.debug('hidden');
        ctx.logger.warn('warning'); ctx.logger.error('reported');
        return { summary: 'Done' };
    });
    expect(f.stdout()).toBe('Done\n');
    expect(f.stderr()).toBe('warning\nreported\n');
});

test('verbose passes through to the context and logger', async () => {
    const f = await fixture({ verbose: true });
    await runAction(f.command, async ctx => {
        expect(ctx.verbose).toBe(true);
        ctx.logger.debug('debug');
        return { summary: 'Done' };
    });
    expect(f.stderr()).toBe('debug\n');
});

test.each(['SIGINT', 'SIGTERM'] as const)('%s aborts the context and listeners are removed afterward', async signal => {
    const before = process.listeners(signal);
    const f = await fixture();
    await runAction(f.command, async ctx => {
        expect(ctx.signal.aborted).toBe(false);
        const listener = process.listeners(signal).find(candidate => !before.includes(candidate));
        expect(listener).toBeDefined();
        listener?.(signal);
        expect(ctx.signal.aborted).toBe(true);
        return { summary: 'Stopped' };
    });
    expect(process.listeners(signal)).toEqual(before);
});

test('a second SIGINT exits a child with code 130', async () => {
    const { dir } = await createTempProject();
    const require = createRequire(import.meta.url);
    const script = `
        import { Command } from ${JSON.stringify(pathToFileURL(require.resolve('commander')).href)};
        import { runAction } from ${JSON.stringify(pathToFileURL(path.join(PACKAGE_ROOT, 'dist/core/command.js')).href)};
        const command = new Command('wait');
        await runAction(command, async ctx => {
            setInterval(() => {}, 1000);
            ctx.signal.addEventListener('abort', () => process.stdout.write('aborted\\n'));
            setTimeout(() => {
                process.kill(process.pid, 'SIGINT');
                setTimeout(() => process.kill(process.pid, 'SIGINT'), 20);
            }, 20);
            return await new Promise(() => {});
        });`;
    await expect(promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd: dir }))
        .rejects.toMatchObject({ code: 130, stdout: 'aborted\n', stderr: '' });
});
