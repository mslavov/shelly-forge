import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createContext } from '../../src/core/command.js';
import { loadProjectEnv, resolveProjectDir } from '../../src/core/project.js';
import { createTempProject } from '../helpers/project.js';

afterEach(() => vi.restoreAllMocks());

test('resolves cwd before the environment override before process.cwd', () => {
    expect(resolveProjectDir('./explicit', { CURRENT_WORKING_DIRECTORY: './ignored' })).toBe(path.resolve('explicit'));
    expect(resolveProjectDir(undefined, { CURRENT_WORKING_DIRECTORY: './environment' })).toBe(path.resolve('environment'));
    expect(resolveProjectDir(undefined, {})).toBe(process.cwd());
});

test('loads the project env with Node syntax and keeps existing values, including empty values', async () => {
    const { dir } = await createTempProject({ '.env': 'HOST=from-file\nEMPTY=replaced\nexport PORT=8080\nQUOTED="hello # world"\nMULTILINE="line one\nline two"\n' });
    const env: NodeJS.ProcessEnv = { HOST: 'existing', EMPTY: '' };
    expect(loadProjectEnv(dir, env)).toBe(env);
    expect(env).toEqual({ HOST: 'existing', EMPTY: '', PORT: '8080', QUOTED: 'hello # world', MULTILINE: 'line one\nline two' });
});

test('does nothing when the env file is absent', async () => {
    const { dir } = await createTempProject();
    const env = {};
    expect(loadProjectEnv(dir, env)).toBe(env);
    expect(env).toEqual({});
});

test('context loads the selected project env, preserves overrides, and emits text or NDJSON', async () => {
    const { dir } = await createTempProject({ '.env': 'SHELLY_PUBLIC_NAME=fixture' });
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const ctx = createContext({ cwd: dir }, { env: {} });
    expect(ctx.projectDir).toBe(dir);
    expect(ctx.env.SHELLY_PUBLIC_NAME).toBe('fixture');
    expect(ctx.signal.aborted).toBe(false);
    ctx.emit({ id: 1 }, 'hello');
    expect(write).toHaveBeenLastCalledWith('hello\n');
    const json = createContext({ cwd: dir, json: true }, { env: {} });
    expect(json.isInteractive).toBe(false);
    json.emit({ id: 2 }, 'ignored');
    expect(write).toHaveBeenLastCalledWith('{"id":2}\n');
});
