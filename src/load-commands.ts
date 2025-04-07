import fs from 'fs/promises';
import path from 'path';
import url from 'url';
import { z } from 'zod';
import { logger } from './utils/logger.js';

export interface CommandTool {
    name: string;
    description: string;
    inputSchema: { [key: string]: z.ZodTypeAny };
    callback: (args: any) => Promise<any>;
}

/**
 * Loads all command tools from the commands directory
 * @returns Array of command tools with name, inputSchema, and callback
 */
export async function loadCommandTools(): Promise<CommandTool[]> {
    const commandTools: CommandTool[] = [];
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const commandsDir = path.join(__dirname, 'commands');

    try {
        const files = await fs.readdir(commandsDir);

        for (const file of files) {
            if (file.endsWith('.js')) { // Load only compiled JS files
                const commandPath = path.join(commandsDir, file);
                const commandModule = await import(url.pathToFileURL(commandPath).toString());

                commandTools.push({
                    name: commandModule.name,
                    description: commandModule.description,
                    inputSchema: commandModule.inputSchema,
                    callback: commandModule.callback
                });

                logger.debug(`Loaded command tool: ${commandModule.name}`);
            }
        }

        return commandTools;
    } catch (error) {
        logger.error('Failed to load command tools', error);
        logger.debug(`Failed to load command tools: ${error}`);
        return [];
    }
}

/**
 * Helper function to infer an input schema from a command function
 * This is a simple implementation and may need to be refined
 */
function inferInputSchema(func: Function): z.ZodObject<any> {
    // Basic inference based on function length (number of parameters)
    const paramCount = func.length;
    const schemaShape: Record<string, z.ZodTypeAny> = {};

    // Create a schema with numbered parameters
    for (let i = 0; i < paramCount; i++) {
        schemaShape[`param${i}`] = z.any().optional().describe(`Parameter ${i + 1}`);
    }

    return z.object(schemaShape);
} 