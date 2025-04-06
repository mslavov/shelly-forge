import fs from 'fs/promises';
import path from 'path';
import url from 'url';
import { z } from 'zod';
import { logger } from './utils/logger.js';

export interface CommandTool {
    name: string;
    description: string;
    inputSchema: z.ZodObject<any>;
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

                // Skip if default export is not a function
                if (typeof commandModule.default !== 'function') {
                    logger.log(`Skipping command file ${file}: No default export function`);
                    continue;
                }

                // Get the command name from the filename (without extension)
                const name = file.replace(/\.js$/, '');

                // Create input schema based on function parameters
                const inputSchema = inferInputSchema(commandModule.default);

                // Create the callback function
                const callback = async (args: any) => {
                    return await commandModule.default(...Object.values(args));
                };

                commandTools.push({
                    name,
                    description: `Command: ${name}`,
                    inputSchema,
                    callback
                });

                logger.log(`Loaded command tool: ${name}`);
            }
        }

        return commandTools;
    } catch (error) {
        logger.error('Failed to load command tools', error);
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