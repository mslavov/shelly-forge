import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { main as mcpServerMain } from '../mcp-server.js';
export const name = 'mcp';

export const description = 'Start the Shelly Forge MCP server';

export const inputSchema = z.object({});

export async function callback(args: {}) {
    return await mcp();
}

export default async function mcp(): Promise<string> {
    try {
        logger.debug('Starting Shelly Forge MCP server...');
        await mcpServerMain();

        return 'MCP server started successfully. Press Ctrl+C to terminate.';
    } catch (error) {
        logger.error('Failed to start MCP server', error);
        throw error;
    }
} 