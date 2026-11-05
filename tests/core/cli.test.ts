import { Command } from 'commander';
import { readdir } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { ALL_COMMANDS } from '../../src/commands/index.js';
import { createTempProject, runCli } from '../helpers/project.js';

const commandOptions = {
    init: ['--no-skills'],
    create: ['--device', '--no-boot'],
    build: ['--no-typecheck', '--no-minify', '--no-check', '--strict'],
    check: ['--no-typecheck', '--strict'],
    deploy: ['--force', '--no-build', '--dry-run', '--no-verify', '--no-rollback', '--verify-timeout'],
    dev: ['--no-logs', '--keep-debug', '--verify-timeout'],
    status: [],
    logs: ['--duration', '--lines', '--grep', '--no-enable-debug'],
    debug: [],
    rpc: ['--device', '--script'],
    eval: [],
    discover: ['--duration'],
    skills: ['--force'],
};

test('registers exactly the thirteen commands in help order with all options', () => {
    const program = new Command();
    for (const register of ALL_COMMANDS) register(program);
    expect(program.commands.map(command => command.name())).toEqual(Object.keys(commandOptions));
    for (const command of program.commands) {
        expect(command.options.map(option => option.long)).toEqual(commandOptions[command.name() as keyof typeof commandOptions]);
    }
    expect(program.commands.find(command => command.name() === 'deploy')?.opts().verifyTimeout).toBe(3000);
    expect(program.commands.find(command => command.name() === 'discover')?.opts().duration).toBe(5);
    expect(program.commands.find(command => command.name() === 'create')?.opts().device).toBe('${DEVICE_HOSTNAME}');
});

test('help and version succeed without creating files', async () => {
    const { dir } = await createTempProject();
    const help = await runCli(['--help'], { cwd: dir });
    expect(help.exitCode).toBe(0);
    expect(help.stderr).toBe('');
    for (const name of Object.keys(commandOptions)) expect(help.stdout).toContain(name);
    const version = await runCli(['--version'], { cwd: dir });
    expect(version).toEqual({ stdout: '0.4.0\n', stderr: '', exitCode: 0 });
    expect(await readdir(dir)).toEqual([]);
});

test('reports usage errors without a stack in text mode', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['--unknown'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("error: unknown option '--unknown'\n");
    expect(result.stdout).toBe('');
});

test('prints help to stderr and exits one without arguments', async () => {
    const { dir } = await createTempProject();
    const result = await runCli([], { cwd: dir });
    const help = await runCli(['--help'], { cwd: dir });
    expect(result).toEqual({ stdout: '', stderr: help.stdout, exitCode: 1 });
    expect(result.stderr).not.toContain('error:');
    expect(await readdir(dir)).toEqual([]);
});

test('reports missing arguments in the JSON envelope', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['--json', 'rpc'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ ok: false, command: 'rpc', exitCode: 2, error: { code: 'USAGE', message: "missing required argument 'method'" } });
});

test('validates debug modes before running the command', async () => {
    const { dir } = await createTempProject();
    const result = await runCli(['--json', 'debug', 'invalid'], { cwd: dir });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe('USAGE');
});
