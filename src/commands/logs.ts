import chalk from 'chalk';
import { spawn } from 'child_process';
import { SolutionsConfig } from '../solutions-config';

export default async function logs(scriptName?: string): Promise<void> {
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

            console.log(chalk.blue(`Streaming logs for script: ${scriptName} from ${script.solutionName} solution`));
            const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
            const wscat = spawn(npm, ['run', 'wscat', '--', `ws://${script.scriptConfig.device}/debug/log`], {
                stdio: 'inherit',
                shell: true,
            });

            processes.push({ device: script.scriptConfig.device, process: wscat });
        } else {
            // Stream logs for all unique devices
            const uniqueDevices = new Set(config.getAllScripts().map((script) => script.scriptConfig.device));

            console.log(chalk.blue(`Streaming logs from ${uniqueDevices.size} devices...`));

            for (const device of Array.from(uniqueDevices)) {
                console.log(chalk.yellow(`Starting log stream for device: ${device}`));
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
                            console.log(chalk.cyan(`[${device}]`), line.trim());
                        }
                    });
                });

                wscat.stderr?.on('data', (data) => {
                    const lines = data.toString().split('\n');
                    lines.forEach((line) => {
                        if (line.trim()) {
                            console.error(chalk.red(`[${device}]`), line.trim());
                        }
                    });
                });

                processes.push({ device, process: wscat });
            }
        }

        // Handle process errors
        processes.forEach(({ device, process }) => {
            process.on('error', (error: Error) => {
                console.error(chalk.red(`Failed to start wscat for ${device}:`), error.message);
            });
        });

        // Handle cleanup on SIGINT (Ctrl+C)
        process.on('SIGINT', () => {
            console.log(chalk.yellow('\nClosing all log streams...'));
            processes.forEach(({ device, process }) => {
                process.kill();
                console.log(chalk.yellow(`Closed log stream for ${device}`));
            });
            process.exit(0);
        });
    } catch (error) {
        console.error(chalk.red('Logs command failed:'), (error as Error).message);
        process.exit(1);
    }
}
