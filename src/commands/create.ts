import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { SolutionsConfig } from '../solutions-config.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { CURRENT_WORKING_DIRECTORY } from '../utils/cwd.js';

export const name = 'create';

export const description = 'Create a new Shelly script';

export const inputSchema: { [key: string]: z.ZodTypeAny } = {
    name: z.string().describe('Name of the script'),
    hostname: z.string().describe('Hostname/IP of the Shelly device'),
    solution: z.string().optional().describe('Solution name for organizing scripts')
};

export async function callback(args: { name: string, hostname: string, solution?: string }) {
    return await create(args.name, args.hostname, args.solution);
}

export default async function create(name: string, hostname: string, solution = 'default'): Promise<string> {
    try {
        const baseDir = path.join(CURRENT_WORKING_DIRECTORY, 'src');
        const scriptsDir = path.join(baseDir, solution);

        await fs.ensureDir(scriptsDir);

        const scriptPath = path.join(scriptsDir, `${name}.ts`);

        if (await fs.pathExists(scriptPath)) {
            throw new Error(`Script ${name} already exists at ${scriptPath}`);
        }

        const scriptContent = `print("Hello World");
`;

        await fs.writeFile(scriptPath, scriptContent, 'utf8');

        const config = new SolutionsConfig();
        if (await config.exists()) {
            await config.load();
        }

        config.addScript(solution, name, {
            src: `src/${solution}/${name}.ts`,
            device: hostname,
        });

        await config.save();
        logger.log(chalk.blue('Updated solutions.config.json'));

        logger.log(chalk.green(`✨ Created new script at ${path.relative(CURRENT_WORKING_DIRECTORY, scriptPath)}`));
        logger.log(chalk.yellow('\nTo start development:'));
        logger.log(chalk.yellow(`SCRIPT_NAME=${name} npm run dev`));

        return `Created new script '${name}' in solution '${solution}' for device ${hostname}`;
    } catch (error) {
        logger.error('Failed to create script', error);
        throw error;
    }
}
