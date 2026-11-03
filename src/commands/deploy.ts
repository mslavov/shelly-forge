import path from 'path';
import chalk from 'chalk';
import fs from 'fs-extra';
import { SolutionsConfig } from '../solutions-config.js';
import { ShellyDevice } from '../shelly-device.js';
import { ScriptHashCache } from '../script-hash-cache.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { CURRENT_WORKING_DIRECTORY } from '../utils/cwd.js';

export const name = 'deploy';

export const description = 'Deploy scripts to Shelly devices';

export const inputSchema: { [key: string]: z.ZodTypeAny } = {
    scriptName: z.string().optional().describe('Script selector to deploy (solution/script, solution-script, or unique script name)')
};

export async function callback(args: { scriptName?: string }) {
    return await deploy(args.scriptName);
}

export default async function deploy(scriptSelector?: string): Promise<string> {
    try {
        const config = new SolutionsConfig();
        await config.load();
        config.validateUniqueDeviceTargets();

        const scripts = config.getScripts(scriptSelector);
        const deployedScripts = [];

        for (const { scriptConfig, scriptId, artifactName, targetScriptName } of scripts) {
            logger.log(chalk.blue(`Processing ${scriptId} for on-device script ${targetScriptName}...`));

            // Check if the built file exists
            const builtFilePath = path.join(CURRENT_WORKING_DIRECTORY, 'dist', `${artifactName}.js`);
            if (!(await fs.pathExists(builtFilePath))) {
                logger.log(chalk.yellow(`Built file not found for ${scriptId}, skipping...`));
                continue;
            }

            // Read the built JavaScript file
            const code = await fs.readFile(builtFilePath, 'utf8');
            const cacheKey = JSON.stringify([scriptId, scriptConfig.device, targetScriptName]);

            // Check if the code has changed
            if (!ScriptHashCache.hasChanged(code, cacheKey)) {
                logger.log(chalk.yellow(`Script ${scriptId} unchanged, skipping deployment`));
                continue;
            }

            // Deploy to device
            logger.log(chalk.blue(`Deploying ${scriptId} as ${targetScriptName} to ${scriptConfig.device}...`));
            const device = new ShellyDevice(scriptConfig.device);
            await device.deploy(
                targetScriptName,
                code,
                scriptConfig.enableOnBoot ?? true // Use config value or default to true
            );

            // Update hash after successful deployment
            ScriptHashCache.updateHash(code, cacheKey);
            logger.log(chalk.green(`✨ Successfully deployed ${scriptId}`));
            deployedScripts.push(scriptId);

            if (scriptConfig.enableOnBoot === false) {
                logger.log(chalk.yellow(`Note: Script ${scriptId} is configured to not start on boot`));
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
