import { execFile } from 'node:child_process';
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Writable } from 'node:stream';
import { afterEach, expect, test, vi } from 'vitest';
import { createLogger } from '../../src/core/logger.js';
import { PACKAGE_ROOT } from '../../src/core/paths.js';
import { createTempProject } from '../helpers/project.js';

afterEach(() => vi.unstubAllEnvs());

function sink(isTTY = false) {
    let text = '';
    const stream = Object.assign(new Writable({ write(chunk, _encoding, callback) { text += String(chunk); callback(); } }), { isTTY });
    return { stream, output: () => text };
}

test('importing core and commands creates no files or signal handlers', async () => {
    const { dir } = await createTempProject();
    const paths = ['core/logger.js', 'core/command.js', 'core/config.js', 'commands/index.js', 'cli.js'];
    const script = `const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];\n${paths.map(file => `await import(${JSON.stringify(pathToFileURL(path.join(PACKAGE_ROOT, 'dist', file)).href)});`).join('\n')}\nconsole.log(JSON.stringify([before, [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]]));`;
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { cwd: dir });
    expect(JSON.parse(result.stdout)).toEqual([[0, 0], [0, 0]]);
    expect(result.stderr).toBe('');
    expect(await readdir(dir)).toEqual([]);
});

test('hides progress in quiet mode but prints warnings and errors', () => {
    const { stream, output } = sink();
    const logger = createLogger({ level: 'quiet', stream });
    logger.info('info'); logger.success('success'); logger.debug('debug'); logger.warn('warning'); logger.error('error');
    expect(output()).toBe('warning\nerror\n');
});

test('shows debug output only at verbose level', () => {
    for (const level of ['info', 'verbose'] as const) {
        const { stream, output } = sink();
        const logger = createLogger({ level, stream });
        logger.info('info'); logger.success('success'); logger.debug('debug');
        expect(output()).toBe(level === 'verbose' ? 'info\nsuccess\ndebug\n' : 'info\nsuccess\n');
    }
});

test('creates the file sink lazily only inside a configured project', async () => {
    const { dir } = await createTempProject();
    const logFile = path.join(dir, '.shelly-forge/logs/forge.log');
    const logger = createLogger({ level: 'quiet', logFile, stream: sink().stream });
    expect(await readdir(dir)).toEqual([]);
    logger.debug('ignored outside a project');
    expect(await readdir(dir)).toEqual([]);
    await writeFile(path.join(dir, 'solutions.config.json'), '{}');
    expect(await readdir(dir)).toEqual(['solutions.config.json']);
    logger.debug('recorded even in quiet mode');
    expect(await readFile(logFile, 'utf8')).toMatch(/DEBUG: recorded even in quiet mode\n$/);
});

test('null logFile disables the file sink', async () => {
    const { dir } = await createTempProject({ 'solutions.config.json': '{}' });
    createLogger({ level: 'quiet', logFile: null, stream: sink().stream }).debug('no file');
    expect(await readdir(dir)).toEqual(['solutions.config.json']);
});

test('rotates files larger than 1 MB when the sink first opens', async () => {
    const { dir } = await createTempProject({ 'solutions.config.json': '{}' });
    const logFile = path.join(dir, '.shelly-forge/logs/forge.log');
    await mkdir(path.dirname(logFile), { recursive: true });
    await writeFile(logFile, 'x'.repeat(1024 * 1024 + 1));
    await writeFile(`${logFile}.1`, 'old rotation');
    const logger = createLogger({ level: 'quiet', logFile, stream: sink().stream });
    expect((await stat(logFile)).size).toBe(1024 * 1024 + 1);
    logger.debug('new file');
    logger.debug('same file');
    expect((await stat(`${logFile}.1`)).size).toBe(1024 * 1024 + 1);
    expect(await readFile(logFile, 'utf8')).toMatch(/DEBUG: new file\n.*DEBUG: same file\n$/);
});

test('does not rotate a file at exactly 1 MB', async () => {
    const { dir } = await createTempProject({ 'solutions.config.json': '{}', '.shelly-forge/logs/forge.log': 'x'.repeat(1024 * 1024) });
    const logFile = path.join(dir, '.shelly-forge/logs/forge.log');
    createLogger({ level: 'quiet', logFile, stream: sink().stream }).debug('append');
    expect((await stat(logFile)).size).toBeGreaterThan(1024 * 1024);
    await expect(stat(`${logFile}.1`)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('only colors a TTY when NO_COLOR is unset and color is not disabled', () => {
    vi.stubEnv('NO_COLOR', undefined);
    const tty = sink(true);
    createLogger({ level: 'info', stream: tty.stream }).success('yes');
    expect(tty.output()).toContain('\u001b[');
    vi.stubEnv('NO_COLOR', '');
    const disabled = sink(true);
    createLogger({ level: 'info', stream: disabled.stream, color: true }).error('plain');
    expect(disabled.output()).toBe('plain\n');
    vi.stubEnv('NO_COLOR', undefined);
    const pipe = sink();
    createLogger({ level: 'info', stream: pipe.stream, color: true }).warn('plain');
    expect(pipe.output()).toBe('plain\n');
});
