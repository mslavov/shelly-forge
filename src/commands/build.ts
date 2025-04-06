import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import esbuild from 'esbuild';
import { SolutionsConfig } from '../solutions-config.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

export const name = 'build';

export const description = 'Build all Shelly scripts using esbuild';

export const inputSchema = z.object({});

export async function callback(args: {}) {
    return await build();
}

export default async function build(): Promise<string> {
    try {
        const config = new SolutionsConfig();
        await config.load();

        await fs.ensureDir(path.join(process.cwd(), 'dist'));

        const scripts = config.getAllScripts();
        const builtScripts: string[] = [];

        for (const { solutionName, scriptName, scriptConfig } of scripts) {
            const scriptPath = path.join(process.cwd(), scriptConfig.src);

            logger.log(chalk.blue(`Building ${scriptName} for solution ${solutionName}...`));

            const envVars = Object.entries(process.env)
                .filter(([key]) => key.startsWith('SHELLY_PUBLIC_'))
                .reduce(
                    (acc, [key, value]) => ({
                        ...acc,
                        [`process.env.${key}`]: JSON.stringify(value || ''),
                    }),
                    {}
                );

            await esbuild.build({
                entryPoints: [scriptPath],
                bundle: true,
                outfile: path.join(process.cwd(), 'dist', `${solutionName}-${scriptName}.js`),
                format: 'iife',
                platform: 'browser',
                minify: true,
                supported: { arrow: false },
                define: envVars,
            });

            builtScripts.push(`${solutionName}-${scriptName}`);
            logger.log(chalk.green(`✨ Successfully bundled ${scriptName}`));
        }

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
