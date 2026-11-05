import type { Command } from 'commander';
import { runAction } from '../core/command.js';
import { ProjectConfig } from '../core/config.js';
import { buildProject } from '../build/build-project.js';
import { buildCommandResult } from './build.js';

export function register(program: Command): void {
    program
        .command('check [selector]')
        .description('Check scripts without writing artifacts')
        .option('--no-typecheck', 'Skip TypeScript checks')
        .option('--strict', 'Treat warnings as errors')
        .action(async function (this: Command) {
            const options = this.optsWithGlobals();
            await runAction(this, async ctx => buildCommandResult(await buildProject(ctx, await ProjectConfig.load(ctx.projectDir), {
                selector: this.args[0], typecheck: options.typecheck, strict: options.strict, write: false,
            }), 'Checked'));
        });
}
