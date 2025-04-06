import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { CURRENT_WORKING_DIRECTORY } from '../utils/cwd.js';

export const name = 'init';

export const description = 'Initialize a new Shelly script project';

export const inputSchema = z.object({
    name: z.string().optional().describe('Project name')
});

export async function callback(args: { name?: string }) {
    return await init(args.name);
}

export default async function init(name?: string): Promise<string> {
    let projectName = name;

    if (!projectName) {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'projectName',
                message: 'What is your project name?',
                default: 'my-shelly-script',
            },
        ]);
        projectName = answers.projectName;
    }

    // Copy template files
    const templateDir = path.join(__dirname, '../../templates/default');
    const targetDir = path.join(CURRENT_WORKING_DIRECTORY, projectName);

    await fs.copy(templateDir, targetDir);

    // Create .cursor directory and mcp.json file
    const cursorDir = path.join(targetDir, '.cursor');
    await fs.ensureDir(cursorDir);

    const mcpConfig = {
        "mcpServers": {
            "shelly-forge": {
                "command": "npx",
                "args": [
                    "shelly-forge",
                    "mcp"
                ],
                "env": {
                    "CURRENT_WORKING_DIRECTORY": targetDir
                }
            }
        }
    };

    await fs.writeJson(path.join(cursorDir, 'mcp.json'), mcpConfig, { spaces: 4 });

    // Rename gitignore to .gitignore
    const gitignorePath = path.join(targetDir, 'gitignore');
    const dotGitignorePath = path.join(targetDir, '.gitignore');
    if (await fs.pathExists(gitignorePath)) {
        await fs.rename(gitignorePath, dotGitignorePath);
    }

    logger.log(chalk.green(`✨ Created new Shelly script project in ${projectName}`));
    return `Created new Shelly script project in ${projectName}`;
}
