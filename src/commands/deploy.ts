import path from 'path';
import chalk from 'chalk';
import fs from 'fs-extra';
import { SolutionsConfig } from '../solutions-config.js';
import { ShellyDevice } from '../shelly-device.js';
import { ScriptHashCache } from '../script-hash-cache.js';

export default async function deploy(): Promise<void> {
    try {
        const config = new SolutionsConfig();
        await config.load();

        const scripts = config.getAllScripts();
        for (const { solutionName, scriptName, scriptConfig } of scripts) {
            console.log(chalk.blue(`Processing ${scriptName} from ${solutionName}...`));

            // Check if the built file exists
            const builtFilePath = path.join(process.cwd(), 'dist', `${solutionName}-${scriptName}.js`);
            if (!(await fs.pathExists(builtFilePath))) {
                console.log(chalk.yellow(`Built file not found for ${scriptName}, skipping...`));
                continue;
            }

            // Read the built JavaScript file
            const code = await fs.readFile(builtFilePath, 'utf8');

            // Check if the code has changed
            if (!ScriptHashCache.hasChanged(code, `${solutionName}-${scriptName}`)) {
                console.log(chalk.yellow(`Script ${scriptName} unchanged, skipping deployment`));
                continue;
            }

            // Deploy to device
            console.log(chalk.blue(`Deploying ${scriptName} to ${scriptConfig.device}...`));
            const device = new ShellyDevice(scriptConfig.device);
            await device.deploy(
                scriptName,
                code,
                scriptConfig.enableOnBoot ?? true // Use config value or default to true
            );

            // Update hash after successful deployment
            ScriptHashCache.updateHash(code, `${solutionName}-${scriptName}`);
            console.log(chalk.green(`✨ Successfully deployed ${scriptName}`));
            if (scriptConfig.enableOnBoot === false) {
                console.log(chalk.yellow(`Note: Script ${scriptName} is configured to not start on boot`));
            }
        }
    } catch (error) {
        console.error(chalk.red('Deploy failed:'), (error as Error).message);
        process.exit(1);
    }
}
