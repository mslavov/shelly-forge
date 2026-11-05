import type { Command } from 'commander';
import { runAction, type CommandResult } from '../core/command.js';
import { ProjectConfig } from '../core/config.js';
import { buildProject, UNMINIFIED_FINDINGS_HINT, type BuildProjectResult } from '../build/build-project.js';

export function buildCommandResult(result: BuildProjectResult, verb: string): CommandResult {
    const hint = result.findings.some(finding => finding.bundle === 'unminified') ? ` ${UNMINIFIED_FINDINGS_HINT}` : '';
    return {
        summary: `${verb} ${result.scripts.length} script${result.scripts.length === 1 ? '' : 's'}.${hint}`,
        data: {
            scripts: result.scripts.map(script => ({ id: script.entry.id, artifactPath: script.artifactPath, sizeBytes: script.sizeBytes, sha256: script.sha256, findings: script.findings })),
            findings: result.findings,
            totals: { scripts: result.scripts.length, sizeBytes: result.scripts.reduce((total, script) => total + script.sizeBytes, 0), errors: result.findings.filter(finding => finding.severity === 'error').length, warnings: result.findings.filter(finding => finding.severity === 'warning').length },
            ...(result.manifestPath ? { manifestPath: result.manifestPath } : {}),
        },
    };
}

export function register(program: Command): void {
    program
        .command('build [selector]')
        .description('Build selected scripts')
        .option('--no-typecheck', 'Skip TypeScript checks')
        .option('--no-minify', 'Keep the output unminified')
        .option('--no-check', 'Skip artifact checks')
        .option('--strict', 'Treat warnings as errors')
        .action(async function (this: Command) {
            const options = this.optsWithGlobals();
            await runAction(this, async ctx => buildCommandResult(await buildProject(ctx, await ProjectConfig.load(ctx.projectDir), {
                selector: this.args[0], typecheck: options.typecheck, minify: options.minify, checks: options.check, strict: options.strict,
            }), 'Built'));
        });
}
