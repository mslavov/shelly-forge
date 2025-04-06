import chalk from 'chalk';
import { spawn } from 'child_process';
import path from 'path';
import url from 'url';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

export const name = 'mcp';

export const description = 'Start the Shelly Forge MCP server';

export const inputSchema = z.object({});

export async function callback(args: {}) {
    return await mcp();
}

export default async function mcp(): Promise<string> {
    try {
        logger.log(chalk.blue('Starting Shelly Forge MCP server...'));

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
            logger.error('Failed to start MCP server', error);
            throw error;
        });

        // The process will keep running until terminated
        logger.log(chalk.green('MCP server running. Press Ctrl+C to terminate.'));

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            logger.log(chalk.yellow('\nShutting down MCP server...'));
            if (!mcpProcess.killed) {
                mcpProcess.kill();
            }
            process.exit(0);
        });

        return 'MCP server started successfully. Press Ctrl+C to terminate.';
    } catch (error) {
        logger.error('Failed to start MCP server', error);
        throw error;
    }
} 