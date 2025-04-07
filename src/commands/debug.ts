import chalk from 'chalk';
import { SolutionsConfig } from '../solutions-config.js';
import { ShellyDevice } from '../shelly-device.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

export const name = 'debug';

export const description = 'Enable or disable debug mode for Shelly script';

export const inputSchema: { [key: string]: z.ZodTypeAny } = {
    mode: z.enum(['on', 'off']).describe('Debug mode: on or off'),
    scriptName: z.string().optional().describe('Name of the script (optional)')
};

export async function callback(args: { mode: 'on' | 'off', scriptName?: string }) {
    return await debug(args.mode, args.scriptName);
}

export default async function debug(mode: string, scriptName?: string): Promise<string> {
    try {
        if (mode !== 'on' && mode !== 'off') {
            throw new Error('Debug mode must be either "on" or "off"');
        }

        const config = new SolutionsConfig();
        await config.load();
        const debugEnabled = mode === 'on';

        if (scriptName) {
            // Debug specific script
            const script = config.findScript(scriptName);
            if (!script) {
                throw new Error(`Script "${scriptName}" not found in solutions.config.json`);
            }

            logger.log(chalk.blue(`Setting debug ${mode} for script: ${scriptName}`));
            const device = new ShellyDevice(script.scriptConfig.device);
            await device.setDebug(debugEnabled);
            logger.log(chalk.green(`✨ Successfully set debug ${mode} for ${scriptName}`));
            return `Debug mode set to ${mode} for script ${scriptName}`;
        } else {
            // Debug all scripts
            const scripts = config.getAllScripts();
            // Keep track of devices we've already configured to avoid duplicates
            const configuredDevices = new Set<string>();
            const configuredScripts: string[] = [];

            for (const { scriptName, scriptConfig } of scripts) {
                if (configuredDevices.has(scriptConfig.device)) {
                    logger.log(
                        chalk.yellow(`Skipping ${scriptName} as device ${scriptConfig.device} was already configured`)
                    );
                    continue;
                }

                logger.log(chalk.blue(`Setting debug ${mode} for script: ${scriptName}`));
                const device = new ShellyDevice(scriptConfig.device);
                await device.setDebug(debugEnabled);
                configuredDevices.add(scriptConfig.device);
                configuredScripts.push(scriptName);
                logger.log(chalk.green(`✨ Successfully set debug ${mode} for ${scriptName}`));
            }

            return `Debug mode set to ${mode} for ${configuredDevices.size} device(s) running ${configuredScripts.length} script(s)`;
        }
    } catch (error) {
        logger.error('Debug command failed', error);
        throw error;
    }
}
