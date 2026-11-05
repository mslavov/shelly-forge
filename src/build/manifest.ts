import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ScriptEntry } from '../core/config.js';
import { ForgeError } from '../core/errors.js';
import { sha256 } from '../core/hash.js';
import type { Finding } from './artifact-check.js';

export interface BuildManifestScript {
    solutionId: string;
    scriptId: string;
    deployId: string;
    targetScriptName: string;
    sourcePath: string;
    sourceSizeBytes: number;
    sourceSha256: string;
    artifactPath: string;
    artifactSizeBytes: number;
    artifactSha256: string;
    findings: Finding[];
    inputs?: { path: string; sha256: string }[];
    publicEnvSha256?: string;
}

export interface BuildManifest {
    schemaVersion: 1;
    runtime: {
        engine: 'shelly-js';
        target: 'es5';
        bundleTarget: 'esnext' | 'es2015';
        transpileTarget: 'es5';
        format: 'iife';
        platform: 'browser';
        minify: boolean;
        sourcemap: false;
        charset: 'utf8';
    };
    scripts: BuildManifestScript[];
}

const inputPath = z.string().min(1).refine(value => !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) && !value.includes('\\') && !value.includes('\0'), 'Expected a relative path');
const relativePath = inputPath.refine(value => !value.split('/').includes('..'), 'Expected a project-relative path');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const size = z.number().int().nonnegative();
const findingSchema = z.object({
    severity: z.enum(['error', 'warning']), rule: z.string(), message: z.string(), scriptId: z.string().optional(),
    file: z.string().optional(), line: z.number().int().positive().optional(), column: z.number().int().positive().optional(),
    bundle: z.literal('unminified').optional(),
});
const manifestSchema = z.object({
    schemaVersion: z.literal(1),
    runtime: z.object({
        engine: z.literal('shelly-js'), target: z.literal('es5'), bundleTarget: z.enum(['esnext', 'es2015']), transpileTarget: z.literal('es5'),
        format: z.literal('iife'), platform: z.literal('browser'), minify: z.boolean(), sourcemap: z.literal(false), charset: z.literal('utf8'),
    }),
    scripts: z.array(z.object({
        solutionId: z.string(), scriptId: z.string(), deployId: z.string(), targetScriptName: z.string(),
        sourcePath: relativePath, sourceSizeBytes: size, sourceSha256: hash,
        artifactPath: relativePath, artifactSizeBytes: size, artifactSha256: hash,
        findings: z.array(findingSchema).default([]),
        inputs: z.array(z.object({ path: inputPath, sha256: hash })).min(1).optional(),
        publicEnvSha256: hash.optional(),
    })),
});

export function publicEnvSha256(env: NodeJS.ProcessEnv): string {
    const pairs = Object.keys(env).filter(name => name.startsWith('SHELLY_PUBLIC_') && env[name] !== undefined)
        .sort().map(name => `${name}=${env[name]}`);
    return sha256(JSON.stringify(pairs));
}

export function validateManifest(manifest: BuildManifest): BuildManifest {
    return manifestSchema.parse(manifest);
}

export async function writeManifest(projectDir: string, manifest: BuildManifest): Promise<void> {
    try {
        const validated = validateManifest(manifest);
        await mkdir(path.join(projectDir, 'dist'), { recursive: true });
        await writeFile(path.join(projectDir, 'dist', 'manifest.json'), `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
    } catch (cause) {
        throw new ForgeError('BUILD', 'Could not write dist/manifest.json', { cause });
    }
}

export async function readManifest(projectDir: string): Promise<BuildManifest | undefined> {
    let content: string;
    try {
        content = await readFile(path.join(projectDir, 'dist', 'manifest.json'), 'utf8');
    } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw new ForgeError('BUILD', 'Could not read dist/manifest.json', { cause });
    }
    try {
        const manifest = manifestSchema.parse(JSON.parse(content));
        if (new Set(manifest.scripts.map(script => script.deployId)).size !== manifest.scripts.length) throw new Error('Duplicate script ids');
        return manifest;
    } catch (cause) {
        throw new ForgeError('BUILD', 'Invalid dist/manifest.json', { cause, hint: 'Run shelly-forge build to regenerate the manifest.' });
    }
}

export async function verifyArtifact(projectDir: string, entry: ScriptEntry, env: NodeJS.ProcessEnv = process.env): Promise<{ code: string; sha256: string; sizeBytes: number }> {
    const hint = `Run shelly-forge build ${entry.id} to rebuild the artifact.`;
    const manifest = await readManifest(projectDir);
    const script = manifest?.scripts.find(value => value.deployId === entry.id);
    if (!script) throw new ForgeError('BUILD', `No build manifest entry for ${entry.id}`, { hint });
    const artifactPath = `dist/${entry.artifactName}.js`;
    const sourcePath = path.relative(projectDir, entry.srcPath).split(path.sep).join('/');
    if (script.artifactPath !== artifactPath || script.sourcePath !== sourcePath || script.solutionId !== entry.solution || script.scriptId !== entry.name) {
        throw new ForgeError('BUILD', `Build manifest paths do not match ${entry.id}`, { hint });
    }
    if (!script.inputs || !script.publicEnvSha256) {
        throw new ForgeError('BUILD', `Build manifest for ${entry.id} lacks input or public environment hashes`, { hint });
    }
    if (publicEnvSha256(env) !== script.publicEnvSha256) {
        throw new ForgeError('BUILD', `Public environment values for ${entry.id} have changed since the build`, { hint });
    }
    try {
        const [artifact, source] = await Promise.all([readFile(path.join(projectDir, artifactPath)), readFile(entry.srcPath)]);
        const artifactHash = sha256(artifact);
        if (artifactHash !== script.artifactSha256 || artifact.length !== script.artifactSizeBytes) {
            throw new ForgeError('BUILD', `Artifact for ${entry.id} differs from the build manifest`, { hint });
        }
        if (sha256(source) !== script.sourceSha256 || source.length !== script.sourceSizeBytes) {
            throw new ForgeError('BUILD', `Source ${sourcePath} for ${entry.id} has changed since the build`, { hint });
        }
        for (const input of script.inputs) {
            let content: Buffer;
            try {
                content = await readFile(path.join(projectDir, input.path));
            } catch (cause) {
                throw new ForgeError('BUILD', `Could not read input ${input.path} for ${entry.id}`, { cause, hint });
            }
            if (sha256(content) !== input.sha256) {
                throw new ForgeError('BUILD', `Input ${input.path} for ${entry.id} has changed since the build`, { hint });
            }
        }
        return { code: artifact.toString('utf8'), sha256: artifactHash, sizeBytes: artifact.length };
    } catch (cause) {
        if (cause instanceof ForgeError) throw cause;
        throw new ForgeError('BUILD', `Could not read the artifact or source for ${entry.id}`, { cause, hint });
    }
}
