import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import esbuild from 'esbuild';
import type { BuildOptions, TransformOptions } from 'esbuild';
import ts from 'typescript';
import { createHash } from 'crypto';
import { SolutionsConfig } from '../solutions-config.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { CURRENT_WORKING_DIRECTORY } from '../utils/cwd.js';

export const name = 'build';

export const description = 'Build all Shelly scripts using esbuild';

export const inputSchema: { [key: string]: z.ZodTypeAny } = {
    scriptName: z.string().optional().describe('Script selector to build (solution/script, solution-script, or unique script name)')
};

const DIST_DIR = path.join(CURRENT_WORKING_DIRECTORY, 'dist');
const MANIFEST_PATH = path.join(DIST_DIR, 'manifest.json');

const SHELLY_BUNDLE_OPTIONS: BuildOptions = {
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2015',
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    supported: { arrow: false },
    write: false,
};

const SHELLY_TYPESCRIPT_OPTIONS: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.None,
    removeComments: true,
    sourceMap: false,
};

const SHELLY_MINIFY_OPTIONS: TransformOptions = {
    loader: 'js',
    target: 'es5',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
};

interface BuildManifestScript {
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
}

interface BuildManifest {
    schemaVersion: 1;
    runtime: {
        engine: 'shelly-js';
        target: 'es5';
        bundleTarget: 'es2015';
        transpileTarget: 'es5';
        format: 'iife';
        platform: 'browser';
        minify: true;
        sourcemap: false;
        charset: 'utf8';
    };
    scripts: BuildManifestScript[];
}

function sha256(content: string | Buffer): string {
    return createHash('sha256').update(content).digest('hex');
}

function relativePath(filePath: string): string {
    return path.relative(CURRENT_WORKING_DIRECTORY, filePath).split(path.sep).join(path.posix.sep);
}

export async function callback(args: { scriptName?: string }) {
    return await build(args.scriptName);
}

export default async function build(scriptSelector?: string): Promise<string> {
    try {
        const config = new SolutionsConfig();
        await config.load();
        config.validateUniqueDeviceTargets();

        await fs.ensureDir(DIST_DIR);

        const scripts = config.getScripts(scriptSelector);
        const builtScripts: string[] = [];
        const manifest: BuildManifest = {
            schemaVersion: 1,
            runtime: {
                engine: 'shelly-js',
                target: 'es5',
                bundleTarget: 'es2015',
                transpileTarget: 'es5',
                format: 'iife',
                platform: 'browser',
                minify: true,
                sourcemap: false,
                charset: 'utf8',
            },
            scripts: [],
        };

        for (const { solutionName, scriptName, scriptConfig, scriptId, artifactName, targetScriptName } of scripts) {
            const scriptPath = path.join(CURRENT_WORKING_DIRECTORY, scriptConfig.src);
            const artifactPath = path.join(DIST_DIR, `${artifactName}.js`);

            logger.log(chalk.blue(`Building ${scriptId} for on-device script ${targetScriptName}...`));

            const envVars = Object.entries(process.env)
                .filter(([key]) => key.startsWith('SHELLY_PUBLIC_'))
                .reduce(
                    (acc, [key, value]) => ({
                        ...acc,
                        [`process.env.${key}`]: JSON.stringify(value || ''),
                    }),
                    {}
                );

            const bundle = await esbuild.build({
                ...SHELLY_BUNDLE_OPTIONS,
                entryPoints: [scriptPath],
                outfile: artifactPath,
                define: envVars,
            });

            const bundledCode = bundle.outputFiles?.[0]?.text;
            if (!bundledCode) {
                throw new Error(`No bundle output generated for ${scriptId}`);
            }

            const es5Code = ts.transpileModule(bundledCode, {
                compilerOptions: SHELLY_TYPESCRIPT_OPTIONS,
            }).outputText;
            const minifiedCode = await esbuild.transform(es5Code, SHELLY_MINIFY_OPTIONS);
            await fs.writeFile(artifactPath, minifiedCode.code, 'utf8');

            const sourceContent = await fs.readFile(scriptPath);
            const artifactContent = await fs.readFile(artifactPath);

            manifest.scripts.push({
                solutionId: solutionName,
                scriptId: scriptName,
                deployId: scriptId,
                targetScriptName,
                sourcePath: relativePath(scriptPath),
                sourceSizeBytes: sourceContent.length,
                sourceSha256: sha256(sourceContent),
                artifactPath: relativePath(artifactPath),
                artifactSizeBytes: artifactContent.length,
                artifactSha256: sha256(artifactContent),
            });

            builtScripts.push(scriptId);
            logger.log(chalk.green(`✨ Successfully bundled ${scriptId}`));
        }

        await fs.writeJson(MANIFEST_PATH, manifest, { spaces: 2 });
        logger.log(chalk.green(`Wrote build manifest to ${relativePath(MANIFEST_PATH)}`));

        const solutions = config.getSolutions();
        const solutionSummary: string[] = [];

        for (const solutionName of solutions) {
            const devices = config.getDevicesForSolution(solutionName);
            logger.log(chalk.blue(`Solution "${solutionName}" is mapped to devices: ${devices.join(', ')}`));
            solutionSummary.push(`"${solutionName}" (${devices.length} devices)`);
        }

        return `Successfully built ${builtScripts.length} scripts across ${solutions.length} solutions: ${solutionSummary.join(', ')}`;
    } catch (error) {
        logger.error('Build failed', error);
        throw error;
    }
}
