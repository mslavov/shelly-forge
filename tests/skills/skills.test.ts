import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Command } from 'commander';
import { describe, expect, test } from 'vitest';
import { ALL_COMMANDS } from '../../src/commands/index.js';
import { PACKAGE_ROOT, SKILLS_DIR } from '../../src/core/paths.js';
import { createTempProject, runCli } from '../helpers/project.js';

const execFileAsync = promisify(execFile);
const program = new Command('shelly-forge');
for (const register of ALL_COMMANDS) register(program);
const commandNames = new Set(program.commands.map(command => command.name()));
const skillNames = (await readdir(SKILLS_DIR, { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name);

function parseFrontmatter(markdown: string): Record<string, string> {
    const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
    if (!header) throw new Error('Missing YAML frontmatter');
    const result: Record<string, string> = {};
    const lines = header[1].split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
        if (!lines[index].trim() || lines[index].startsWith('#')) continue;
        const field = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[index]);
        if (!field || Object.hasOwn(result, field[1])) throw new Error(`Invalid frontmatter line: ${lines[index]}`);
        let value = field[2];
        if (/^[>|]-?$/.test(value)) {
            const block: string[] = [];
            while (index + 1 < lines.length && /^(?: {2,}\S.*|\s*)$/.test(lines[index + 1])) {
                block.push(lines[++index].replace(/^ {2}/, ''));
            }
            value = block.join(value.startsWith('>') ? ' ' : '\n').trim();
        } else if (value.startsWith('"')) {
            value = JSON.parse(value) as string;
        } else if (value.startsWith("'")) {
            if (!value.endsWith("'")) throw new Error('Unclosed frontmatter string');
            value = value.slice(1, -1).replace(/''/g, "'");
        } else if (!value || /:\s|\s#|^[\[\]{}&*!|>@`]/.test(value)) {
            throw new Error('Expected a plain, quoted, or block string in frontmatter');
        }
        result[field[1]] = value;
    }
    return result;
}

async function markdownFiles(directory: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await markdownFiles(file));
        else if (entry.name.endsWith('.md')) files.push(file);
    }
    return files;
}

function linkTargets(markdown: string): string[] {
    const links = /!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)|^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm;
    return Array.from(markdown.matchAll(links), match => (match[1] ?? match[2]).replace(/^<|>$/g, ''));
}

function mentionedCommands(markdown: string): string[] {
    const invocation = /\bshelly-forge[ \t]+(?:(?:--(?:json|verbose|quiet)|-[vq])[ \t]+|--cwd[ \t]+(?:'[^']*'|"[^"]*"|\S+)[ \t]+)*([a-z][a-z-]*)\b/;
    const fragments = [
        ...Array.from(markdown.matchAll(/(?<!`)`([^`\n]+)`(?!`)/g), match => match[1]),
        ...Array.from(markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm), match => match[1]),
    ];
    const commands: string[] = [];
    for (const fragment of fragments) {
        for (const line of fragment.split('\n')) {
            const match = invocation.exec(line);
            if (match) commands.push(match[1]);
        }
    }
    return commands;
}

test('discovers bundled skills', () => {
    expect(skillNames.length).toBeGreaterThan(0);
});

for (const name of skillNames) {
    describe(name, () => {
        const directory = path.join(SKILLS_DIR, name);

        test('has a named skill with a short description in string frontmatter', async () => {
            const frontmatter = parseFrontmatter(await readFile(path.join(directory, 'SKILL.md'), 'utf8'));
            expect(frontmatter.name).toBe(name);
            expect(frontmatter.description.trim().length).toBeGreaterThan(0);
            expect(frontmatter.description.length).toBeLessThan(1024);
        });

        test('resolves every relative Markdown link to a file', async () => {
            for (const file of await markdownFiles(directory)) {
                for (const target of linkTargets(await readFile(file, 'utf8'))) {
                    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;
                    const relative = decodeURIComponent(target.split(/[?#]/, 1)[0]);
                    expect((await stat(path.resolve(path.dirname(file), relative))).isFile(), `${file}: ${target}`).toBe(true);
                }
            }
        });

        test('mentions only registered CLI commands', async () => {
            for (const file of await markdownFiles(directory)) {
                for (const command of mentionedCommands(await readFile(file, 'utf8'))) {
                    expect(commandNames.has(command), `${file}: shelly-forge ${command}`).toBe(true);
                }
            }
        });
    });
}

test('command extraction includes global options but excludes prose, imports, and arguments', () => {
    const markdown = [
        'Use the [shelly-forge skill](../shelly-forge/SKILL.md).',
        '`shelly-forge check` and `shelly-forge --json deploy`.',
        '`shelly-forge --cwd "my project" --quiet status`.',
        '`shelly-forge/testing` and `shelly-forge unknown`.',
        '```sh',
        'npx shelly-forge --json skills install shelly-forge shelly-scripting',
        '```',
    ].join('\n');
    expect(mentionedCommands(markdown)).toEqual(['check', 'deploy', 'status', 'unknown', 'skills']);
});

describe('CLI reference', () => {
    test('contains the current global help', async () => {
        const help = await runCli(['--help'], { cwd: PACKAGE_ROOT });
        expect(help.exitCode).toBe(0);
        const reference = await readFile(path.join(SKILLS_DIR, 'shelly-forge/reference/cli.md'), 'utf8');
        const blocks = Array.from(reference.matchAll(/^```text\n([\s\S]*?)\n```/gm), match => match[1]);
        expect(blocks).toHaveLength(commandNames.size + 1);
        expect(blocks).toContain(help.stdout.trimEnd());
    });

    for (const name of commandNames) {
        test(`contains the exact ${name} usage and options`, async () => {
            const help = await runCli([name, '--help'], { cwd: PACKAGE_ROOT });
            expect(help.exitCode).toBe(0);
            const reference = await readFile(path.join(SKILLS_DIR, 'shelly-forge/reference/cli.md'), 'utf8');
            const blocks = Array.from(reference.matchAll(/^```text\n([\s\S]*?)\n```/gm), match => match[1]);
            expect(blocks).toContain(help.stdout.trimEnd());
        });
    }

    test('keeps JSON result examples consistent with their exit codes', async () => {
        const reference = await readFile(path.join(SKILLS_DIR, 'shelly-forge/reference/cli.md'), 'utf8');
        const blocks = Array.from(reference.matchAll(/^```(?:json|jsonl)\n([\s\S]*?)\n```/gm), match => match[1]);
        const envelopes: Record<string, unknown>[] = [];
        for (const block of blocks) {
            for (const line of block.split('\n')) {
                const value = JSON.parse(line) as Record<string, unknown>;
                if ('type' in value) {
                    expect(value).not.toHaveProperty('ok');
                    expect(value).not.toHaveProperty('exitCode');
                    continue;
                }
                expect(Number.isInteger(value.exitCode)).toBe(true);
                expect(value.ok).toBe(value.exitCode === 0);
                expect(commandNames.has(String(value.command))).toBe(true);
                envelopes.push(value);
            }
        }
        expect(envelopes.length).toBeGreaterThan(0);
        expect(envelopes).toContainEqual(expect.objectContaining({ command: 'status', ok: false, exitCode: 5 }));
        expect(envelopes).toContainEqual(expect.objectContaining({ ok: false, exitCode: 2, error: expect.any(Object) }));
    });
});

test('every testing reference example passes in an external consumer project', async () => {
    const reference = await readFile(path.join(SKILLS_DIR, 'shelly-forge/reference/testing.md'), 'utf8');
    const examples = Array.from(reference.matchAll(/Save as `([^`]+)`\.\n\n```ts\n([\s\S]*?)\n```/g));
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.length).toBe(Array.from(reference.matchAll(/^```ts$/gm)).length);
    const { dir, cleanup } = await createTempProject();
    try {
        const initialized = await runCli(['init', 'examples', '--no-skills'], { cwd: dir });
        expect(initialized.exitCode, initialized.stdout + initialized.stderr).toBe(0);
        const project = path.join(dir, 'examples');
        const modules = path.join(project, 'node_modules');
        await mkdir(modules);
        for (const name of ['shelly-forge', 'typescript', 'vitest', '@types']) {
            await symlink(name === 'shelly-forge' ? PACKAGE_ROOT : path.join(PACKAGE_ROOT, 'node_modules', name), path.join(modules, name), 'dir');
        }
        await copyFile(path.join(project, '.env.example'), path.join(project, '.env'));
        for (const [, filename, code] of examples) {
            expect(filename).toMatch(/^src\/(?:[\w-]+\/)*[\w.-]+\.test\.ts$/);
            const file = path.join(project, filename);
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, `${code}\n`);
        }
        for (const config of ['tsconfig.json', 'tsconfig.test.json']) {
            await execFileAsync(process.execPath, [path.join(modules, 'typescript/bin/tsc'), '-p', config], { cwd: project });
        }
        const report = path.join(project, 'examples-results.json');
        await execFileAsync(process.execPath, [path.join(modules, 'vitest/vitest.mjs'), 'run', '--reporter=json', '--outputFile', report], {
            cwd: project, maxBuffer: 1024 * 1024,
        });
        expect(JSON.parse(await readFile(report, 'utf8'))).toMatchObject({ success: true, numPassedTests: 13, numFailedTests: 0 });
    } finally {
        await cleanup();
    }
}, 90000);
