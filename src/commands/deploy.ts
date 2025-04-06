import path from 'path';
import chalk from 'chalk';
import fs from 'fs-extra';
import { SolutionsConfig } from '../solutions-config.js';
import { ShellyDevice } from '../shelly-device.js';
import { ScriptHashCache } from '../script-hash-cache.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

export const name = 'deploy';

export const description = 'Deploy scripts to Shelly devices';

export const inputSchema = z.object({});

export async function callback(args: {}) {
    return await deploy();
}

export default async function deploy(): Promise<string> {
    try {
        const config = new SolutionsConfig();
        await config.load();

        const scripts = config.getAllScripts();
        const deployedScripts = [];

        for (const { solutionName, scriptName, scriptConfig } of scripts) {
            logger.log(chalk.blue(`Processing ${scriptName} from ${solutionName}...`));

            // Check if the built file exists
            const builtFilePath = path.join(process.cwd(), 'dist', `${solutionName}-${scriptName}.js`);
            if (!(await fs.pathExists(builtFilePath))) {
                logger.log(chalk.yellow(`Built file not found for ${scriptName}, skipping...`));
                continue;
            }

            // Read the built JavaScript file
            const code = await fs.readFile(builtFilePath, 'utf8');

            // Check if the code has changed
            if (!ScriptHashCache.hasChanged(code, `${solutionName}-${scriptName}`)) {
                logger.log(chalk.yellow(`Script ${scriptName} unchanged, skipping deployment`));
                continue;
            }

            // Deploy to device
            logger.log(chalk.blue(`Deploying ${scriptName} to ${scriptConfig.device}...`));
            const device = new ShellyDevice(scriptConfig.device);
            await device.deploy(
                scriptName,
                code,
                scriptConfig.enableOnBoot ?? true // Use config value or default to true
            );

            // Update hash after successful deployment
            ScriptHashCache.updateHash(code, `${solutionName}-${scriptName}`);
            logger.log(chalk.green(`✨ Successfully deployed ${scriptName}`));
            deployedScripts.push(scriptName);

            if (scriptConfig.enableOnBoot === false) {
                logger.log(chalk.yellow(`Note: Script ${scriptName} is configured to not start on boot`));
            }
        }

        if (deployedScripts.length === 0) {
            return "No scripts were deployed (all scripts unchanged or not found)";
        }

        return `Successfully deployed ${deployedScripts.length} script(s): ${deployedScripts.join(', ')}`;
    } catch (error) {
        logger.error('Deploy failed', error);
        throw error;
    }
}
