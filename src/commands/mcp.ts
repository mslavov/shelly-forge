import chalk from 'chalk';
import { spawn } from 'child_process';
import path from 'path';
import url from 'url';

export default async function mcp(): Promise<void> {
    try {
        console.log(chalk.blue('Starting Shelly Forge MCP server...'));

        // Get the directory path of the current module
        const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

        // Get the path to the MCP server file
        const serverPath = path.resolve(__dirname, '../mcp-server.js');

        // Spawn the MCP server as a child process
        const mcpProcess = spawn('node', [serverPath], {
            stdio: 'inherit', // Forward stdio to parent process
            detached: false
        });

        // Handle process events
        mcpProcess.on('error', (error) => {
            console.error(chalk.red('Failed to start MCP server:'), error.message);
            process.exit(1);
        });

        // The process will keep running until terminated
        console.log(chalk.green('MCP server running. Press Ctrl+C to terminate.'));

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log(chalk.yellow('\nShutting down MCP server...'));
            if (!mcpProcess.killed) {
                mcpProcess.kill();
            }
            process.exit(0);
        });

    } catch (error) {
        console.error(chalk.red('Failed to start MCP server:'), (error as Error).message);
        process.exit(1);
    }
} 