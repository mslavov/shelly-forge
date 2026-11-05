import { lstat, mkdir, readFile, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { ProjectConfig } from '../../src/core/config.js';
import { starterScript, starterTest } from '../../src/scaffold/starter-files.js';
import { createTempProject, runCli } from '../helpers/project.js';

test('creates a script, test, and config with an unresolved device reference', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['create', 'lighting', 'hall'], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Created script "lighting/hall".');
    for (const step of ['npm run build -- lighting/hall', 'npm test', 'npm run dev -- lighting/hall']) {
        expect(result.stdout).toContain(step);
    }
    expect(await readFile(path.join(dir, 'src/lighting/hall.ts'), 'utf8')).toBe(starterScript('lighting', 'hall'));
    expect(await readFile(path.join(dir, 'src/lighting/hall.test.ts'), 'utf8')).toBe(starterTest('lighting', 'hall'));
    expect(JSON.parse(await readFile(path.join(dir, 'solutions.config.json'), 'utf8'))).toEqual({
        lighting: { hall: { src: 'src/lighting/hall.ts', device: '${DEVICE_HOSTNAME}', enableOnBoot: true } },
    });
});

test('supports a device override and --no-boot and preserves unrelated config', async () => {
    const existing = {
        $schema: './node_modules/shelly-forge/schema/solutions.config.schema.json',
        other: { old: { src: 'src/other/old.ts', device: '${OTHER_HOST}', password: '${PASSWORD}', targetScriptName: 'custom' } },
    };
    const { dir } = await createTempProject({ 'solutions.config.json': JSON.stringify(existing) });
    const result = await runCli(['create', 'Room_1', 'light-strip', '-d', 'shelly.local', '--no-boot'], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(await readFile(path.join(dir, 'solutions.config.json'), 'utf8'))).toEqual({
        ...existing, Room_1: { 'light-strip': { src: 'src/Room_1/light-strip.ts', device: 'shelly.local', enableOnBoot: false } },
    });
});

test('returns paths, device settings, and next steps in the JSON envelope', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['--json', 'create', 'garden', 'pump', '--device', '${GARDEN_HOST}', '--no-boot'], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual({
        ok: true,
        exitCode: 0,
        command: 'create',
        summary: expect.stringContaining('Created script "garden/pump".'),
        data: {
            id: 'garden/pump', src: 'src/garden/pump.ts', test: 'src/garden/pump.test.ts',
            device: '${GARDEN_HOST}', enableOnBoot: false,
            nextSteps: ['npm run build -- garden/pump', 'npm test', 'npm run dev -- garden/pump'],
        },
    });
});

test.each([
    ['../outside', 'hello'], ['room/path', 'hello'], ['room\\path', 'hello'], ['', 'hello'],
    ['room', '../outside'], ['room', 'hello.ts'], ['room', 'hello world'], ['room', ''],
    ['room', 'hello\n'], ['room', 'x;touch file'],
])('rejects invalid names %j and %j without writing', async (solution, script) => {
    const { dir } = await createTempProject();
    const result = await runCli(['--json', 'create', solution, script], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, command: 'create', error: { code: 'USAGE' } });
    expect(await readdir(dir)).toEqual([]);
});

test.each(['src/room/hello.ts', 'src/room/hello.test.ts'])('preserves an existing file at %s', async file => {
    const { dir } = await createTempProject({ [file]: 'user content\n' });
    const result = await runCli(['--json', 'create', 'room', 'hello'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'USAGE', message: expect.stringContaining('Refusing to overwrite') } });
    expect(await readdir(path.join(dir, 'src/room'))).toEqual([path.basename(file)]);
    expect(await readFile(path.join(dir, file), 'utf8')).toBe('user content\n');
    await expect(lstat(path.join(dir, 'solutions.config.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('rejects an already configured script even when its files are missing', async () => {
    const content = JSON.stringify({ room: { hello: { src: 'different.ts', device: 'shelly.local' } } });
    const { dir } = await createTempProject({ 'solutions.config.json': content });
    const result = await runCli(['--json', 'create', 'room', 'hello'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'USAGE', message: 'Script "room/hello" already exists' } });
    expect(await readFile(path.join(dir, 'solutions.config.json'), 'utf8')).toBe(content);
    expect(await readdir(dir)).toEqual(['solutions.config.json']);
});

test('rejects a colliding artifact before writing files or changing config', async () => {
    const content = JSON.stringify({ 'a-b': { c: { src: 'old.ts', device: 'shelly.local' } } });
    const { dir } = await createTempProject({ 'solutions.config.json': content });
    const result = await runCli(['--json', 'create', 'a', 'b-c'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe('CONFIG');
    expect(await readFile(path.join(dir, 'solutions.config.json'), 'utf8')).toBe(content);
    expect(await readdir(dir)).toEqual(['solutions.config.json']);
});

test('accepts valid names that match Object prototype properties', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['create', '__proto__', 'constructor'], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect((await ProjectConfig.load(dir)).scripts()).toMatchObject([
        { id: '__proto__/constructor', src: 'src/__proto__/constructor.ts', deviceRef: '${DEVICE_HOSTNAME}' },
    ]);
});

test.each(['src', 'src/room'])('rejects a source directory symlink at %s', async link => {
    const { dir } = await createTempProject();
    const destination = path.join(dir, 'outside');
    await mkdir(destination);
    await mkdir(path.dirname(path.join(dir, link)), { recursive: true });
    await symlink(destination, path.join(dir, link), 'dir');
    const result = await runCli(['--json', 'create', 'room', 'hello'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe('USAGE');
    expect(await readdir(destination)).toEqual([]);
});

test('does not overwrite a dangling source symlink', async () => {
    const { dir } = await createTempProject();
    await mkdir(path.join(dir, 'src/room'), { recursive: true });
    await symlink(path.join(dir, 'missing'), path.join(dir, 'src/room/hello.ts'));
    const result = await runCli(['--json', 'create', 'room', 'hello'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe('USAGE');
    expect((await lstat(path.join(dir, 'src/room/hello.ts'))).isSymbolicLink()).toBe(true);
    await expect(lstat(path.join(dir, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('rejects an empty device before writing', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['--json', 'create', 'room', 'hello', '--device', ''], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe('USAGE');
    expect(await readdir(dir)).toEqual([]);
});

test('keeps generated KVS keys within the device limit for long valid names', () => {
    const source = starterScript('a'.repeat(60), 'b'.repeat(60));
    const key = source.match(/^const counterKey = '([^']+)';$/m)![1];
    expect(Buffer.byteLength(key, 'utf8')).toBeLessThanOrEqual(42);
    expect(starterTest('a'.repeat(60), 'b'.repeat(60))).toContain(`'${key}'`);
    expect(starterScript('a'.repeat(60), 'c'.repeat(60))).not.toContain(key);
});
