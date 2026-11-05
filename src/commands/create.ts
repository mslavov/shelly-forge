import type { Command } from 'commander';
import { lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runAction, type CommandContext, type CommandResult } from '../core/command.js';
import { ProjectConfig } from '../core/config.js';
import { ForgeError } from '../core/errors.js';
import { starterScript, starterTest } from '../scaffold/starter-files.js';

export function register(program: Command): void {
    program
        .command('create <solution> <script>')
        .description('Add a script to the project')
        .option('-d, --device <value>', 'Device hostname or IP address', '${DEVICE_HOSTNAME}')
        .option('--no-boot', 'Do not enable the script on boot')
        .action(async function (this: Command, solution: string, script: string) {
            const options = this.opts<{ device: string; boot: boolean }>();
            await runAction(this, ctx => handle(ctx, solution, script, options.device, options.boot));
        });
}

async function inspect(file: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
    try {
        return await lstat(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
}

async function handle(ctx: CommandContext, solution: string, script: string, device: string, enableOnBoot: boolean): Promise<CommandResult> {
    for (const [label, name] of [['solution', solution], ['script', script]]) {
        if (name.length === 0 || /[^A-Za-z0-9_-]/.test(name)) {
            throw new ForgeError('USAGE', `Invalid ${label} name "${name}"`, {
                hint: 'Use only letters, digits, underscores, and hyphens.',
            });
        }
    }
    if (!device.trim()) throw new ForgeError('USAGE', 'Device must not be empty');

    const id = `${solution}/${script}`;
    const src = `src/${solution}/${script}.ts`;
    const test = `src/${solution}/${script}.test.ts`;
    const config = await ProjectConfig.loadOrCreate(ctx.projectDir);
    if (config.scripts().some(entry => entry.id === id)) {
        throw new ForgeError('USAGE', `Script "${id}" already exists`);
    }
    config.addScript(solution, script, { src, device, enableOnBoot });

    const directories = [path.join(ctx.projectDir, 'src'), path.join(ctx.projectDir, 'src', solution)];
    for (const directory of directories) {
        const entry = await inspect(directory);
        if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) {
            throw new ForgeError('USAGE', `Source directory must be a directory, not a file or symlink: ${directory}`);
        }
    }
    for (const file of [src, test]) {
        if (await inspect(path.join(ctx.projectDir, file))) {
            throw new ForgeError('USAGE', `Refusing to overwrite existing file ${file}`);
        }
    }

    const created: string[] = [];
    try {
        for (const directory of directories) await mkdir(directory, { recursive: true });
        for (const [file, content] of [[src, starterScript(solution, script)], [test, starterTest(solution, script)]]) {
            const absolute = path.join(ctx.projectDir, file);
            await writeFile(absolute, content, { encoding: 'utf8', flag: 'wx' });
            created.push(absolute);
        }
        await config.save();
    } catch (error) {
        for (const file of created) await rm(file, { force: true });
        if (error instanceof ForgeError) throw error;
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new ForgeError('USAGE', 'Refusing to overwrite an existing source or test file', { cause: error });
        }
        throw new ForgeError('CONFIG', `Could not create script "${id}"`, { cause: error });
    }

    const nextSteps = [`npm run build -- ${id}`, 'npm test', `npm run dev -- ${id}`];
    return {
        summary: [`Created script "${id}".`, `  ${src}`, `  ${test}`, '', 'Next steps:', ...nextSteps.map(step => `  ${step}`)].join('\n'),
        data: { id, src, test, device, enableOnBoot, nextSteps },
    };
}
