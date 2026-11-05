import type { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { runAction, type CommandContext, type CommandResult } from '../core/command.js';
import { ForgeError } from '../core/errors.js';
import { initProject } from '../scaffold/init-project.js';

export function register(program: Command): void {
    program
        .command('init [name]')
        .description('Create a Shelly script project')
        .option('--no-skills', 'Do not install bundled skills')
        .action(async function (this: Command, name: string | undefined) {
            await runAction(this, ctx => handle(ctx, name, this.opts().skills !== false));
        });
}

async function handle(ctx: CommandContext, name: string | undefined, skills: boolean): Promise<CommandResult> {
    if (name === undefined) {
        if (!ctx.isInteractive) throw new ForgeError('USAGE', 'Project name is required', { hint: 'Run shelly-forge init <name>.' });
        const prompt = createInterface({ input: process.stdin, output: process.stdout });
        try {
            name = (await prompt.question('Project name: ', { signal: ctx.signal })).trim();
        } finally {
            prompt.close();
        }
    }
    const result = await initProject({ projectDir: ctx.projectDir, name, skills });
    const skipped = result.skills?.skipped.map(skill => `Skipped ${skill.name}: ${skill.reason}`) ?? [];
    return {
        summary: [`Created project "${result.name}".`, ...skipped, '', 'Next steps:', ...result.nextSteps.map(step => `  ${step}`)].join('\n'),
        data: result,
    };
}
