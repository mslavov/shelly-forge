import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import esbuild from 'esbuild';
import { SolutionsConfig } from '../solutions-config';

export default async function build(): Promise<void> {
    try {
        const config = new SolutionsConfig();
        await config.load();

        await fs.ensureDir(path.join(process.cwd(), 'dist'));

        const scripts = config.getAllScripts();
        for (const { solutionName, scriptName, scriptConfig } of scripts) {
            const scriptPath = path.join(process.cwd(), scriptConfig.src);

            console.log(chalk.blue(`Building ${scriptName} for solution ${solutionName}...`));

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

            console.log(chalk.green(`✨ Successfully bundled ${scriptName}`));
        }

        const solutions = config.getSolutions();
        for (const solutionName of solutions) {
            const devices = config.getDevicesForSolution(solutionName);
            console.log(chalk.blue(`Solution "${solutionName}" is mapped to devices: ${devices.join(', ')}`));
        }
    } catch (error) {
        console.error(chalk.red('Build failed:'), (error as Error).message);
        process.exit(1);
    }
}
