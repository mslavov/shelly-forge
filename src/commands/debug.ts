import chalk from 'chalk';
import { SolutionsConfig } from '../solutions-config.js';
import { ShellyDevice } from '../shelly-device.js';

export default async function debug(mode: string, scriptName?: string): Promise<void> {
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

            console.log(chalk.blue(`Setting debug ${mode} for script: ${scriptName}`));
            const device = new ShellyDevice(script.scriptConfig.device);
            await device.setDebug(debugEnabled);
            console.log(chalk.green(`✨ Successfully set debug ${mode} for ${scriptName}`));
        } else {
            // Debug all scripts
            const scripts = config.getAllScripts();
            // Keep track of devices we've already configured to avoid duplicates
            const configuredDevices = new Set<string>();

            for (const { scriptName, scriptConfig } of scripts) {
                if (configuredDevices.has(scriptConfig.device)) {
                    console.log(
                        chalk.yellow(`Skipping ${scriptName} as device ${scriptConfig.device} was already configured`)
                    );
                    continue;
                }

                console.log(chalk.blue(`Setting debug ${mode} for script: ${scriptName}`));
                const device = new ShellyDevice(scriptConfig.device);
                await device.setDebug(debugEnabled);
                configuredDevices.add(scriptConfig.device);
                console.log(chalk.green(`✨ Successfully set debug ${mode} for ${scriptName}`));
            }
        }
    } catch (error) {
        console.error(chalk.red('Debug command failed:'), (error as Error).message);
        process.exit(1);
    }
}
