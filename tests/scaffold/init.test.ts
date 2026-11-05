import { lstat, mkdir, readFile, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { TEMPLATES_DIR } from '../../src/core/paths.js';
import { initProject } from '../../src/scaffold/init-project.js';
import { VERSION } from '../../src/version.js';
import { createTempProject, runCli } from '../helpers/project.js';

async function filesIn(directory: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) files.push(...(await filesIn(path.join(directory, entry.name))).map(file => path.join(entry.name, file)));
        else files.push(entry.name);
    }
    return files;
}

test('copies the real template, sets the package name, and installs fixture skills', async () => {
    const { dir } = await createTempProject({ 'bundled/shelly-forge/SKILL.md': '# Forge\n' });
    const result = await initProject({ projectDir: dir, name: 'my-shelly.project_1', sourceDir: path.join(dir, 'bundled') });
    const target = path.join(dir, 'my-shelly.project_1');
    expect(result).toEqual({
        name: 'my-shelly.project_1', projectDir: target, skills: { installed: ['shelly-forge'], skipped: [] },
        nextSteps: ['cd my-shelly.project_1', 'npm install', 'cp .env.example .env', 'npx shelly-forge create <solution> <script>'],
    });
    const templateDir = path.join(TEMPLATES_DIR, 'default');
    const templatePackage = JSON.parse(await readFile(path.join(templateDir, 'package.json'), 'utf8'));
    expect(JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'))).toEqual({ ...templatePackage, name: 'my-shelly.project_1' });
    for (const file of await filesIn(templateDir)) {
        if (file === 'package.json') continue;
        const output = file === 'gitignore' ? '.gitignore' : file;
        expect(await readFile(path.join(target, output))).toEqual(await readFile(path.join(templateDir, file)));
    }
    expect((await lstat(path.join(target, '.gitignore'))).isFile()).toBe(true);
    await expect(lstat(path.join(target, 'gitignore'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(path.join(target, '.cursor/mcp.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(target, '.agents/skills/shelly-forge/.shelly-forge-version'), 'utf8')).toBe(`${VERSION}\n`);
    expect(await readFile(path.join(target, '.claude/skills/shelly-forge/SKILL.md'), 'utf8')).toBe('# Forge\n');
});

test('creates a project inside an existing empty directory without installing skills', async () => {
    const { dir } = await createTempProject();
    await mkdir(path.join(dir, 'demo'));
    const result = await initProject({ projectDir: dir, name: 'demo', skills: false, sourceDir: path.join(dir, 'missing') });
    expect(result.skills).toBeUndefined();
    expect(JSON.parse(await readFile(path.join(dir, 'demo/package.json'), 'utf8')).name).toBe('demo');
    await expect(lstat(path.join(dir, 'demo/.agents/skills'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test.each(['', '.', '..', '../outside', '/outside', 'nested/project', 'nested\\project', 'MyProject', '_project', '.project', 'project name', 'project@name', 'node_modules', 'favicon.ico', 'x'.repeat(215)])('rejects invalid project name %j before writing', async name => {
    const { dir } = await createTempProject();
    await expect(initProject({ projectDir: dir, name, skills: false })).rejects.toMatchObject({ code: 'USAGE' });
    expect(await readdir(dir)).toEqual([]);
});

test('preserves an existing non-empty directory', async () => {
    const { dir } = await createTempProject({ 'demo/user.txt': 'User data' });
    await expect(initProject({ projectDir: dir, name: 'demo', skills: false })).rejects.toMatchObject({ code: 'USAGE' });
    expect(await readdir(path.join(dir, 'demo'))).toEqual(['user.txt']);
    expect(await readFile(path.join(dir, 'demo/user.txt'), 'utf8')).toBe('User data');
});

test('rejects a file at the target path', async () => {
    const { dir } = await createTempProject({ demo: 'User data' });
    await expect(initProject({ projectDir: dir, name: 'demo', skills: false })).rejects.toMatchObject({ code: 'USAGE' });
    expect(await readFile(path.join(dir, 'demo'), 'utf8')).toBe('User data');
});

test('does not follow a symlink at the target path', async () => {
    const { dir } = await createTempProject();
    const destination = path.join(dir, 'outside');
    await mkdir(destination);
    await symlink(destination, path.join(dir, 'demo'), 'dir');
    await expect(initProject({ projectDir: dir, name: 'demo', skills: false })).rejects.toMatchObject({ code: 'USAGE' });
    expect(await readdir(destination)).toEqual([]);
});

test('checks bundled skills before creating a project', async () => {
    const { dir } = await createTempProject();
    await expect(initProject({ projectDir: dir, name: 'demo', sourceDir: path.join(dir, 'missing') })).rejects.toMatchObject({ code: 'CONFIG' });
    expect(await readdir(dir)).toEqual([]);
});

test('init with a name and --no-skills succeeds without a TTY or MCP configuration', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['init', 'demo', '--no-skills'], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Created project "demo".');
    for (const step of ['cd demo', 'npm install', 'cp .env.example .env', 'npx shelly-forge create <solution> <script>']) {
        expect(result.stdout).toContain(step);
    }
    expect(JSON.parse(await readFile(path.join(dir, 'demo/package.json'), 'utf8')).name).toBe('demo');
    await expect(lstat(path.join(dir, 'demo/.cursor/mcp.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('init without a name on a non-TTY exits 2 without prompting', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['init', '--no-skills'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('error: Project name is required');
    expect(await readdir(dir)).toEqual([]);
});

test('init emits a JSON success envelope with next steps', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['--json', 'init', 'demo', '--no-skills'], { cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true, command: 'init', data: {
            name: 'demo', projectDir: path.join(dir, 'demo'),
            nextSteps: ['cd demo', 'npm install', 'cp .env.example .env', 'npx shelly-forge create <solution> <script>'],
        },
    });
});

test('init without a name emits a JSON USAGE error', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['--json', 'init'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, command: 'init', error: { code: 'USAGE', message: 'Project name is required' } });
});

test('init exits 2 when the target directory is not empty', async () => {
    const { dir } = await createTempProject({ 'demo/user.txt': 'User data' });
    const result = await runCli(['--json', 'init', 'demo', '--no-skills'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).error.code).toBe('USAGE');
    expect(await readFile(path.join(dir, 'demo/user.txt'), 'utf8')).toBe('User data');
});
