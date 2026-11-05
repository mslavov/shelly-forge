import { Argument, type Command } from 'commander';
import { runAction, type CommandContext, type CommandResult } from '../core/command.js';
import { ForgeError } from '../core/errors.js';
import { installSkills, listSkills } from '../scaffold/skills.js';

export function register(program: Command): void {
    program
        .command('skills')
        .description('Install or list bundled agent skills')
        .addArgument(new Argument('<action>', 'Skill action').choices(['install', 'list']))
        .argument('[names...]', 'Skill names')
        .option('--force', 'Replace existing skills')
        .action(async function (this: Command, action: string, names: string[]) {
            await runAction(this, ctx => handle(ctx, action, names, this.opts().force === true));
        });
}

async function handle(ctx: CommandContext, action: string, names: string[], force: boolean): Promise<CommandResult> {
    if (action === 'list') {
        if (names.length || force) throw new ForgeError('USAGE', 'skills list does not accept names or --force');
        const skills = await listSkills({ projectDir: ctx.projectDir });
        const rows = [
            ['Name', 'Bundled version', 'Installed version', 'Managed'],
            ...skills.map(skill => [skill.name, skill.bundledVersion, skill.installedVersion ?? '-', skill.managed ? 'yes' : 'no']),
        ];
        const widths = rows[0].map((_, index) => Math.max(...rows.map(row => row[index].length)));
        return { summary: rows.map(row => row.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd()).join('\n'), data: skills };
    }
    const result = await installSkills({ projectDir: ctx.projectDir, names, force });
    return {
        summary: [
            `Installed ${result.installed.length} skill${result.installed.length === 1 ? '' : 's'}${result.installed.length ? `: ${result.installed.join(', ')}` : ''}.`,
            ...result.skipped.map(skill => `Skipped ${skill.name}: ${skill.reason}`),
        ].join('\n'),
        data: result,
    };
}
