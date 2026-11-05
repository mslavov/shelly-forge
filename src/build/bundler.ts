import path from 'node:path';
import * as esbuild from 'esbuild';
import ts from 'typescript';
import { ForgeError } from '../core/errors.js';

export interface BundleOptions {
    projectDir: string;
    entry: string;
    minify?: boolean;
    env?: NodeJS.ProcessEnv;
}

export interface BundleResult {
    code: string;
    unminifiedCode: string;
    inputs: string[];
    publicEnv: string[];
}

export async function bundleScript(options: BundleOptions): Promise<BundleResult> {
    const env = options.env ?? process.env;
    const publicEnv = Object.keys(env).filter(key => key.startsWith('SHELLY_PUBLIC_') && env[key] !== undefined).sort();
    const define = Object.fromEntries(publicEnv.map(key => [`process.env.${key}`, JSON.stringify(env[key] || '')]));
    try {
        const bundle = await esbuild.build({
            absWorkingDir: options.projectDir,
            entryPoints: [path.resolve(options.projectDir, options.entry)],
            bundle: true,
            format: 'iife',
            platform: 'browser',
            // esbuild's own lowering helpers call ES2017 built-ins without feature checks; leave syntax
            // lowering to TypeScript, whose ES5 helpers detect missing built-ins.
            target: 'esnext',
            minify: false,
            sourcemap: false,
            legalComments: 'none',
            charset: 'utf8',
            supported: { arrow: false },
            write: false,
            metafile: true,
            logLevel: 'silent',
            define,
        });
        const bundledCode = bundle.outputFiles?.[0]?.text;
        if (!bundledCode) throw new Error(`No bundle output generated for ${options.entry}`);
        const es5Code = ts.transpileModule(bundledCode, {
            compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.None, removeComments: true, sourceMap: false },
        }).outputText;
        const unminifiedCode = (await esbuild.transform(es5Code, {
            loader: 'js', target: 'es5', minify: false, sourcemap: false, legalComments: 'none', charset: 'utf8',
        })).code;
        const code = options.minify === false ? unminifiedCode : (await esbuild.transform(unminifiedCode, {
            loader: 'js', target: 'es5', minify: true, sourcemap: false, legalComments: 'none', charset: 'utf8',
        })).code;
        const inputs = Object.keys(bundle.metafile.inputs).map(input => path.resolve(options.projectDir, input)).sort();
        return { code, unminifiedCode, inputs, publicEnv };
    } catch (error) {
        throw new ForgeError('BUILD', `Could not bundle ${options.entry}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
}
