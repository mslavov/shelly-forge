import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CommandContext } from '../core/command.js';
import type { ProjectConfig, ScriptEntry } from '../core/config.js';
import { ForgeError } from '../core/errors.js';
import { sha256 } from '../core/hash.js';
import { checkArtifact, type Finding } from './artifact-check.js';
import { bundleScript, type BundleResult } from './bundler.js';
import { publicEnvSha256, readManifest, validateManifest, writeManifest, type BuildManifest, type BuildManifestScript } from './manifest.js';
import { typecheckProject } from './typecheck.js';

export const UNMINIFIED_FINDINGS_HINT = 'Run shelly-forge build --no-minify to write artifacts that match these finding locations.';

export interface BuiltScript {
    entry: ScriptEntry;
    code: string;
    sizeBytes: number;
    sha256: string;
    artifactPath: string;
    findings: Finding[];
    publicEnv: string[];
}

export interface BuildProjectOptions {
    selector?: string;
    typecheck?: boolean;
    minify?: boolean;
    checks?: boolean;
    strict?: boolean;
    write?: boolean;
}

export interface BuildProjectResult {
    scripts: BuiltScript[];
    findings: Finding[];
    manifestPath?: string;
}

function report(ctx: CommandContext, findings: Finding[]): void {
    if (ctx.json) return;
    const groups = new Map<string, Finding[]>();
    for (const finding of findings) {
        const group = finding.scriptId ?? 'TypeScript';
        const entries = groups.get(group) ?? [];
        entries.push(finding);
        groups.set(group, entries);
    }
    for (const [group, entries] of groups) {
        ctx.logger.info(group);
        for (const finding of entries) {
            const file = `${finding.file ?? group}${finding.bundle === 'unminified' ? ' (unminified)' : ''}`;
            ctx.logger[finding.severity === 'error' ? 'error' : 'warn'](`${file}:${finding.line ?? 1}:${finding.column ?? 1} ${finding.rule} ${finding.message}`);
        }
    }
}

export async function buildProject(ctx: CommandContext, config: ProjectConfig, options: BuildProjectOptions = {}): Promise<BuildProjectResult> {
    const entries = config.select(options.selector);
    const enforce = (findings: Finding[]): Finding[] => options.strict
        ? findings.map(finding => finding.severity === 'warning' ? { ...finding, severity: 'error' } : finding)
        : findings;
    const allTypeFindings = options.typecheck === false ? [] : typecheckProject(config.projectDir);
    const bundles: { entry: ScriptEntry; source: Buffer; bundle: BundleResult }[] = [];
    const bundleFindings: Finding[] = [];
    for (const entry of entries) {
        try {
            const source = await readFile(entry.srcPath);
            const bundle = await bundleScript({ projectDir: config.projectDir, entry: entry.src, minify: options.minify, env: ctx.env });
            bundles.push({ entry, source, bundle });
        } catch (cause) {
            bundleFindings.push({ severity: 'error', rule: 'bundle', message: cause instanceof Error ? cause.message : String(cause), scriptId: entry.id, file: entry.src, line: 1, column: 1 });
        }
    }
    const inputs = new Set([...entries.map(entry => entry.srcPath), ...bundles.flatMap(({ bundle }) => bundle.inputs)]);
    const selectedTypeFindings = allTypeFindings.filter(finding => options.selector === undefined || !finding.file
        || finding.rule === 'missing-tsconfig' || finding.file === 'tsconfig.json' || inputs.has(path.resolve(config.projectDir, finding.file)));
    const ignored = allTypeFindings.length - selectedTypeFindings.length;
    if (ignored > 0) ctx.logger.debug(`Ignored ${ignored} TypeScript diagnostic${ignored === 1 ? '' : 's'} outside the selected scripts' inputs.`);
    const typeFindings = enforce(selectedTypeFindings).map(finding => {
        const entry = entries.find(candidate => finding.file && path.resolve(config.projectDir, finding.file) === candidate.srcPath);
        return entry ? { ...finding, scriptId: entry.id } : finding;
    });
    report(ctx, typeFindings);
    if (typeFindings.some(finding => finding.severity === 'error')) {
        const isTypeError = typeFindings.some(finding => finding.rule === 'typescript' && finding.severity === 'error');
        throw new ForgeError(isTypeError ? 'BUILD' : 'CHECK', 'TypeScript checks failed', { details: { findings: typeFindings } });
    }

    const scripts: BuiltScript[] = [];
    const manifestScripts: BuildManifestScript[] = [];
    const findings = [...typeFindings];
    for (const { entry, source, bundle } of bundles) {
        try {
            const artifactFindings = enforce(options.checks === false ? [] : checkArtifact(bundle.unminifiedCode, entry, { publicEnv: bundle.publicEnv, shippedCode: bundle.code }))
                .map(finding => options.minify === false ? finding : { ...finding, bundle: 'unminified' as const });
            const scriptFindings = [...typeFindings.filter(finding => finding.scriptId === entry.id), ...artifactFindings];
            const artifactPath = path.join(config.projectDir, 'dist', `${entry.artifactName}.js`);
            const sizeBytes = Buffer.byteLength(bundle.code, 'utf8');
            const hash = sha256(bundle.code);
            findings.push(...artifactFindings);
            scripts.push({ entry, code: bundle.code, artifactPath, sizeBytes, sha256: hash, findings: scriptFindings, publicEnv: bundle.publicEnv });
            manifestScripts.push({
                solutionId: entry.solution, scriptId: entry.name, deployId: entry.id, targetScriptName: entry.targetScriptName,
                sourcePath: path.relative(config.projectDir, entry.srcPath).split(path.sep).join('/'), sourceSizeBytes: source.length, sourceSha256: sha256(source),
                artifactPath: path.relative(config.projectDir, artifactPath).split(path.sep).join('/'), artifactSizeBytes: sizeBytes, artifactSha256: hash,
                findings: scriptFindings,
                inputs: await Promise.all(bundle.inputs.map(async input => ({ path: path.relative(config.projectDir, input).split(path.sep).join('/'), sha256: sha256(await readFile(input)) }))),
                publicEnvSha256: publicEnvSha256(ctx.env),
            });
            report(ctx, artifactFindings);
        } catch (cause) {
            bundleFindings.push({ severity: 'error', rule: 'bundle', message: cause instanceof Error ? cause.message : String(cause), scriptId: entry.id, file: entry.src, line: 1, column: 1 });
        }
    }
    findings.push(...bundleFindings);
    report(ctx, bundleFindings);
    const hint = findings.some(finding => finding.bundle === 'unminified') ? UNMINIFIED_FINDINGS_HINT : undefined;
    if (bundleFindings.length) throw new ForgeError('BUILD', 'Script bundling failed', { hint, details: { findings } });
    if (findings.some(finding => finding.severity === 'error')) throw new ForgeError('CHECK', 'Artifact checks failed', { hint, details: { findings } });

    const result: BuildProjectResult = { scripts, findings };
    if (options.write !== false) {
        const manifest: BuildManifest = {
            schemaVersion: 1,
            runtime: { engine: 'shelly-js', target: 'es5', bundleTarget: 'esnext', transpileTarget: 'es5', format: 'iife', platform: 'browser', minify: options.minify !== false, sourcemap: false, charset: 'utf8' },
            scripts: manifestScripts,
        };
        try {
            const previous = options.selector === undefined ? undefined : await readManifest(config.projectDir);
            const byId = new Map(previous?.scripts.map(script => [script.deployId, script]));
            for (const script of manifestScripts) byId.set(script.deployId, script);
            manifest.scripts = config.scripts().flatMap(entry => {
                const script = byId.get(entry.id);
                return script ? [script] : [];
            });
            const validated = validateManifest(manifest);
            await mkdir(path.join(config.projectDir, 'dist'), { recursive: true });
            for (const script of scripts) await writeFile(script.artifactPath, script.code, 'utf8');
            await writeManifest(config.projectDir, validated);
        } catch (cause) {
            if (cause instanceof ForgeError) throw cause;
            throw new ForgeError('BUILD', 'Could not write build artifacts', { cause, details: { findings } });
        }
        result.manifestPath = path.join(config.projectDir, 'dist', 'manifest.json');
    }
    return result;
}
