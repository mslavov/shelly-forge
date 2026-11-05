import { Command } from 'commander';
import { cp, lstat, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { register } from '../../src/commands/skills.js';
import { installSkills, listSkills } from '../../src/scaffold/skills.js';
import { VERSION } from '../../src/version.js';
import { createTempProject } from '../helpers/project.js';

const fixtures = vi.hoisted(() => ({ sourceDir: '' }));
vi.mock('../../src/core/paths.js', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/core/paths.js')>(),
    get SKILLS_DIR() { return fixtures.sourceDir; },
}));
vi.mock('node:fs/promises', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return { ...actual, cp: vi.fn(actual.cp), rename: vi.fn(actual.rename), symlink: vi.fn(actual.symlink), writeFile: vi.fn(actual.writeFile) };
});

const originalExitCode = process.exitCode;
afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
});

async function fixture(files: Record<string, string> = {}) {
    const { dir } = await createTempProject({
        'bundled/shelly-forge/SKILL.md': '# Shelly Forge\n',
        'bundled/shelly-scripting/SKILL.md': '# Shelly scripting\n',
        'bundled/shelly-scripting/references/api.md': 'API reference\n',
        ...files,
    });
    const sourceDir = path.join(dir, 'bundled');
    fixtures.sourceDir = sourceDir;
    return { projectDir: dir, sourceDir };
}

async function runSkills(projectDir: string, args: string[]) {
    const program = new Command('shelly-forge').option('--cwd <dir>').option('--json');
    program.setOptionValue('cwd', projectDir);
    register(program);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await program.parseAsync(args, { from: 'user' });
    return {
        stdout: stdout.mock.calls.map(([text]) => String(text)).join(''),
        stderr: stderr.mock.calls.map(([text]) => String(text)).join(''),
        exitCode: process.exitCode,
    };
}

test('installs all bundled skills, stamps them, and creates relative Claude links', async () => {
    const options = await fixture();
    expect(await installSkills(options)).toEqual({ installed: ['shelly-forge', 'shelly-scripting'], skipped: [] });
    for (const name of ['shelly-forge', 'shelly-scripting']) {
        const installed = path.join(options.projectDir, '.agents', 'skills', name);
        const alias = path.join(options.projectDir, '.claude', 'skills', name);
        expect(await readFile(path.join(installed, '.shelly-forge-version'), 'utf8')).toBe(`${VERSION}\n`);
        expect(await readFile(path.join(installed, 'SKILL.md'), 'utf8')).toBe(await readFile(path.join(options.sourceDir, name, 'SKILL.md'), 'utf8'));
        expect((await lstat(alias)).isSymbolicLink()).toBe(true);
        expect(await readlink(alias)).toBe(path.join('..', '..', '.agents', 'skills', name));
        expect(await readFile(path.join(alias, '.shelly-forge-version'), 'utf8')).toBe(`${VERSION}\n`);
    }
    expect(await readFile(path.join(options.projectDir, '.agents/skills/shelly-scripting/references/api.md'), 'utf8')).toBe('API reference\n');
});

test('installs only requested skills and ignores duplicate names', async () => {
    const options = await fixture();
    expect(await installSkills({ ...options, names: ['shelly-scripting', 'shelly-scripting'] }))
        .toEqual({ installed: ['shelly-scripting'], skipped: [] });
    expect(await readdir(path.join(options.projectDir, '.agents/skills'))).toEqual(['shelly-scripting']);
});

test.each(['unknown', '../shelly-forge', '/shelly-forge'])('rejects unknown skill %s before writing anything', async name => {
    const options = await fixture();
    await expect(installSkills({ ...options, names: ['shelly-scripting', name] })).rejects.toMatchObject({
        code: 'USAGE', message: expect.stringContaining('Available skills: shelly-forge, shelly-scripting'),
    });
    await expect(lstat(path.join(options.projectDir, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test.each(['.agents', '.claude'])('preserves a user-owned skill under %s and reports why', async parent => {
    const options = await fixture({ [`${parent}/skills/shelly-forge/SKILL.md`]: 'User instructions\n' });
    const result = await installSkills({ ...options, names: ['shelly-forge'] });
    expect(result).toEqual({
        installed: [], skipped: [{ name: 'shelly-forge', reason: expect.stringContaining('User-owned skill') }],
    });
    expect(await readFile(path.join(options.projectDir, parent, 'skills/shelly-forge/SKILL.md'), 'utf8')).toBe('User instructions\n');
});

test('force replaces user-owned directories in both locations', async () => {
    const options = await fixture({
        '.agents/skills/shelly-forge/custom.md': 'Keep without force',
        '.claude/skills/shelly-forge/custom.md': 'Keep without force',
    });
    expect(await installSkills({ ...options, names: ['shelly-forge'], force: true }))
        .toEqual({ installed: ['shelly-forge'], skipped: [] });
    expect(await readdir(path.join(options.projectDir, '.agents/skills/shelly-forge'))).toEqual(['.shelly-forge-version', 'SKILL.md']);
    expect((await lstat(path.join(options.projectDir, '.claude/skills/shelly-forge'))).isSymbolicLink()).toBe(true);
});

test('skips the current version without overwriting edits, unless forced', async () => {
    const options = await fixture();
    await installSkills({ ...options, names: ['shelly-forge'] });
    const file = path.join(options.projectDir, '.agents/skills/shelly-forge/SKILL.md');
    await writeFile(file, 'Local edits');
    expect(await installSkills({ ...options, names: ['shelly-forge'] })).toEqual({
        installed: [], skipped: [{ name: 'shelly-forge', reason: `Already installed at version ${VERSION}` }],
    });
    expect(await readFile(file, 'utf8')).toBe('Local edits');
    expect(await installSkills({ ...options, names: ['shelly-forge'], force: true })).toEqual({ installed: ['shelly-forge'], skipped: [] });
    expect(await readFile(file, 'utf8')).toBe('# Shelly Forge\n');
});

test('updates a managed skill with an older version stamp', async () => {
    const options = await fixture({
        '.agents/skills/shelly-forge/.shelly-forge-version': '0.3.0\n',
        '.agents/skills/shelly-forge/old.md': 'Old content',
    });
    expect(await installSkills({ ...options, names: ['shelly-forge'] })).toEqual({ installed: ['shelly-forge'], skipped: [] });
    expect(await readFile(path.join(options.projectDir, '.agents/skills/shelly-forge/.shelly-forge-version'), 'utf8')).toBe(`${VERSION}\n`);
    await expect(lstat(path.join(options.projectDir, '.agents/skills/shelly-forge/old.md'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test.each(['copy', 'stamp'])('preserves the installed skill if the replacement %s fails', async operation => {
    const options = await fixture();
    await installSkills({ ...options, names: ['shelly-forge'] });
    const failure = Object.assign(new Error('Disk write failed'), { code: 'ENOSPC' });
    if (operation === 'copy') vi.mocked(cp).mockRejectedValueOnce(failure);
    else vi.mocked(writeFile).mockRejectedValueOnce(failure);
    await expect(installSkills({ ...options, names: ['shelly-forge'], force: true })).rejects.toMatchObject({ code: 'CONFIG' });
    expect(await readFile(path.join(options.projectDir, '.agents/skills/shelly-forge/SKILL.md'), 'utf8')).toBe('# Shelly Forge\n');
    expect(await readFile(path.join(options.projectDir, '.claude/skills/shelly-forge/SKILL.md'), 'utf8')).toBe('# Shelly Forge\n');
    expect(await readdir(path.join(options.projectDir, '.agents/skills'))).toEqual(['shelly-forge']);
});

test('restores the previous installation if the replacement rename fails', async () => {
    const options = await fixture();
    await installSkills({ ...options, names: ['shelly-forge'] });
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementationOnce(actual.rename)
        .mockRejectedValueOnce(Object.assign(new Error('Rename failed'), { code: 'EACCES' }));
    await expect(installSkills({ ...options, names: ['shelly-forge'], force: true })).rejects.toMatchObject({ code: 'CONFIG' });
    expect(await readFile(path.join(options.projectDir, '.agents/skills/shelly-forge/SKILL.md'), 'utf8')).toBe('# Shelly Forge\n');
    expect(await readFile(path.join(options.projectDir, '.claude/skills/shelly-forge/SKILL.md'), 'utf8')).toBe('# Shelly Forge\n');
    expect(await readdir(path.join(options.projectDir, '.agents/skills'))).toEqual(['shelly-forge']);
});

test('reinstalls a missing managed directory without force when its Claude link remains', async () => {
    const options = await fixture();
    await installSkills({ ...options, names: ['shelly-forge'] });
    await rm(path.join(options.projectDir, '.agents/skills/shelly-forge'), { recursive: true });
    expect(await installSkills({ ...options, names: ['shelly-forge'] })).toEqual({ installed: ['shelly-forge'], skipped: [] });
    expect(await readFile(path.join(options.projectDir, '.claude/skills/shelly-forge/SKILL.md'), 'utf8')).toBe('# Shelly Forge\n');
});

test('copies Claude skills when symlinks are unavailable, and updates those copies', async () => {
    const options = await fixture();
    vi.mocked(symlink).mockRejectedValueOnce(Object.assign(new Error('Symlinks require a privilege'), { code: 'EPERM' }));
    await installSkills({ ...options, names: ['shelly-forge'] });
    const alias = path.join(options.projectDir, '.claude/skills/shelly-forge');
    expect((await lstat(alias)).isDirectory()).toBe(true);
    expect(await readFile(path.join(alias, '.shelly-forge-version'), 'utf8')).toBe(`${VERSION}\n`);
    expect(await readFile(path.join(alias, 'SKILL.md'), 'utf8')).toBe('# Shelly Forge\n');
    await writeFile(path.join(options.sourceDir, 'shelly-forge/SKILL.md'), 'Updated instructions');
    vi.mocked(symlink).mockRejectedValueOnce(Object.assign(new Error('Symlinks require a privilege'), { code: 'EPERM' }));
    await installSkills({ ...options, names: ['shelly-forge'], force: true });
    expect(await readFile(path.join(alias, 'SKILL.md'), 'utf8')).toBe('Updated instructions');
});

test('lists bundled versions, installed versions, and ownership', async () => {
    const options = await fixture({ '.agents/skills/shelly-scripting/SKILL.md': 'User instructions' });
    expect(await listSkills(options)).toEqual([
        { name: 'shelly-forge', bundledVersion: VERSION, managed: false },
        { name: 'shelly-scripting', bundledVersion: VERSION, managed: false },
    ]);
    await installSkills({ ...options, names: ['shelly-forge'] });
    expect(await listSkills(options)).toEqual([
        { name: 'shelly-forge', bundledVersion: VERSION, installedVersion: VERSION, managed: true },
        { name: 'shelly-scripting', bundledVersion: VERSION, managed: false },
    ]);
});

test.each(['missing', 'empty'])('reports a CONFIG error with a hint for %s bundled skills', async source => {
    const { dir } = await createTempProject();
    const options = { projectDir: dir, sourceDir: source === 'missing' ? path.join(dir, 'missing') : dir };
    await expect(installSkills(options)).rejects.toMatchObject({ code: 'CONFIG', hint: expect.stringContaining('Reinstall shelly-forge') });
    await expect(listSkills(options)).rejects.toMatchObject({ code: 'CONFIG', hint: expect.stringContaining('Reinstall shelly-forge') });
});

test('skills install returns a JSON envelope with installed and skipped names', async () => {
    const options = await fixture();
    await installSkills({ ...options, names: ['shelly-forge'] });
    const result = await runSkills(options.projectDir, ['--json', 'skills', 'install']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true, command: 'skills', data: { installed: ['shelly-scripting'], skipped: [{ name: 'shelly-forge' }] },
    });
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
});

test('skills list prints a table with bundled and installed versions and ownership', async () => {
    const options = await fixture();
    await installSkills({ ...options, names: ['shelly-forge'] });
    const result = await runSkills(options.projectDir, ['skills', 'list']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/Name\s+Bundled version\s+Installed version\s+Managed/);
    expect(result.stdout).toMatch(new RegExp(`shelly-forge\\s+${VERSION.replaceAll('.', '\\.')}\\s+${VERSION.replaceAll('.', '\\.')}\\s+yes`));
    expect(result.stdout).toMatch(/shelly-scripting\s+\S+\s+-\s+no/);
});

test('skills list returns a JSON envelope', async () => {
    const options = await fixture();
    const result = await runSkills(options.projectDir, ['--json', 'skills', 'list']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true, command: 'skills', data: [
            { name: 'shelly-forge', bundledVersion: VERSION, managed: false },
            { name: 'shelly-scripting', bundledVersion: VERSION, managed: false },
        ],
    });
});

test('skills install reports unknown names with available names and exit code 2', async () => {
    const options = await fixture();
    const result = await runSkills(options.projectDir, ['--json', 'skills', 'install', 'unknown']);
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false, command: 'skills', error: { code: 'USAGE', message: expect.stringContaining('Available skills: shelly-forge, shelly-scripting') },
    });
});

test.each([['skills', 'list', 'shelly-forge'], ['skills', 'list', '--force']])('rejects unsupported list arguments %j', async (...args) => {
    const options = await fixture();
    const result = await runSkills(options.projectDir, ['--json', ...args]);
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe('USAGE');
});
