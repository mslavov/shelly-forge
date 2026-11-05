import type { Command } from 'commander';
import { buildProject } from '../build/build-project.js';
import { verifyArtifact } from '../build/manifest.js';
import { runAction, type CommandContext, type CommandResult } from '../core/command.js';
import { ProjectConfig, validateSelectedTargets } from '../core/config.js';
import { deployScripts, validateVerifyTimeout, type DeployOptions, type DeployResult } from '../deploy/deployer.js';

export interface DeployCommandOptions extends DeployOptions {
    build?: boolean;
}

export async function deployProject(ctx: CommandContext, selector?: string, options: DeployCommandOptions = {}): Promise<CommandResult<DeployResult>> {
    validateVerifyTimeout(options.verifyTimeoutMs);
    const config = await ProjectConfig.load(ctx.projectDir);
    const entries = config.select(selector);
    const targets = validateSelectedTargets(config, entries, ctx.env);
    const scripts = options.build === false
        ? await Promise.all(entries.map(async entry => ({ entry, ...await verifyArtifact(ctx.projectDir, entry, ctx.env) })))
        : (await buildProject(ctx, config, { selector })).scripts;
    const data = await deployScripts(ctx, config, scripts, options, targets);
    const changed = data.scripts.filter(script => script.action !== 'skipped').length;
    return { summary: `${options.dryRun ? 'Planned' : 'Deployed'} ${changed} script(s), skipped ${data.scripts.length - changed}.`, data };
}

export function register(program: Command): void {
    program
        .command('deploy [selector]')
        .description('Deploy selected scripts')
        .option('--force', 'Upload unchanged scripts')
        .option('--no-build', 'Use existing build artifacts')
        .option('--dry-run', 'Show the deployment without uploading')
        .option('--no-verify', 'Skip post-deploy health checks')
        .option('--no-rollback', 'Do not restore the last working script on failure')
        .option('--verify-timeout <ms>', 'Health check timeout in milliseconds', Number, 3000)
        .action(async function (this: Command, selector?: string) {
            const options = this.opts();
            await runAction(this, ctx => deployProject(ctx, selector, { ...options, verifyTimeoutMs: options.verifyTimeout }));
        });
}
