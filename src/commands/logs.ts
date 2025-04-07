import chalk from 'chalk';
import { spawn } from 'child_process';
import { SolutionsConfig } from '../solutions-config.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

export const name = 'logs';

export const description = 'Stream logs from Shelly devices';

export const inputSchema: { [key: string]: z.ZodTypeAny } = {
    scriptName: z.string().optional().describe('Name of the script to stream logs from (optional)')
};

export async function callback(args: { scriptName?: string }) {
    return await logs(args.scriptName);
}

export default async function logs(scriptName?: string): Promise<string> {
    try {
        const config = new SolutionsConfig();
        await config.load();

        // Keep track of processes to handle cleanup
        const processes: { device: string; process: ReturnType<typeof spawn> }[] = [];

        if (scriptName) {
            // Stream logs for specific script
            const script = config.findScript(scriptName);
            if (!script) {
                throw new Error(`Script "${scriptName}" not found in solutions.config.json`);
            }

            logger.log(chalk.blue(`Streaming logs for script: ${scriptName} from ${script.solutionName} solution`));
            const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
            const wscat = spawn(npm, ['run', 'wscat', '--', `ws://${script.scriptConfig.device}/debug/log`], {
                stdio: 'inherit',
                shell: true,
            });

            processes.push({ device: script.scriptConfig.device, process: wscat });

            return `Started streaming logs for script ${scriptName} from device ${script.scriptConfig.device}. Press Ctrl+C to stop.`;
        } else {
            // Stream logs for all unique devices
            const uniqueDevices = new Set(config.getAllScripts().map((script) => script.scriptConfig.device));

            logger.log(chalk.blue(`Streaming logs from ${uniqueDevices.size} devices...`));

            for (const device of Array.from(uniqueDevices)) {
                logger.log(chalk.yellow(`Starting log stream for device: ${device}`));
                const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
                const wscat = spawn(npm, ['run', 'wscat', '--', `ws://${device}/debug/log`], {
                    stdio: 'pipe', // Use pipe to handle output
                    shell: true,
                });

                // Prefix each line with the device identifier
                wscat.stdout?.on('data', (data) => {
                    const lines = data.toString().split('\n');
                    lines.forEach((line) => {
                        if (line.trim()) {
                            logger.log(chalk.cyan(`[${device}]`) + ' ' + line.trim());
                        }
                    });
                });

                wscat.stderr?.on('data', (data) => {
                    const lines = data.toString().split('\n');
                    lines.forEach((line) => {
                        if (line.trim()) {
                            logger.error(chalk.red(`[${device}]`) + ' ' + line.trim());
                        }
                    });
                });

                processes.push({ device, process: wscat });
            }

            return `Started streaming logs from ${uniqueDevices.size} devices. Press Ctrl+C to stop.`;
        }

        // Handle process errors
        processes.forEach(({ device, process }) => {
            process.on('error', (error: Error) => {
                logger.error(`Failed to start wscat for ${device}`, error);
            });
        });

        // Handle cleanup on SIGINT (Ctrl+C)
        process.on('SIGINT', () => {
            logger.log(chalk.yellow('\nClosing all log streams...'));
            processes.forEach(({ device, process }) => {
                process.kill();
                logger.log(chalk.yellow(`Closed log stream for ${device}`));
            });
            process.exit(0);
        });
    } catch (error) {
        logger.error('Logs command failed', error);
        throw error;
    }
}
