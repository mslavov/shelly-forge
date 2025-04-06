#!/usr/bin/env node

import { Command } from 'commander';
import { loadCommandTools } from './load-commands.js';
import { logger } from './utils/logger.js';

const program = new Command();
program.version('0.1.0');

async function main() {
    try {
        // Load all commands dynamically
        const commands = await loadCommandTools();

        // Register each command with Commander
        for (const cmd of commands) {
            const commandObj = program
                .command(cmd.name)
                .description(cmd.description);

            // Add arguments based on inputSchema
            const schema = cmd.inputSchema.shape;
            const paramKeys = Object.keys(schema);

            // Configure arguments based on schema
            paramKeys.forEach((key, index) => {
                const param = schema[key];
                const isOptional = param._def.typeName === 'ZodOptional' ||
                    param._def.isOptional === true;
                const description = param._def.description || `Parameter ${index + 1}`;

                // Format: <required> or [optional]
                const argFormat = isOptional ? `[${key}]` : `<${key}>`;
                commandObj.argument(argFormat, description);
            });

            // Configure the action handler - wrap to ignore return value
            commandObj.action(async (...args) => {
                try {
                    // Convert arguments array to an object matching the schema
                    const params: Record<string, any> = {};
                    paramKeys.forEach((key, index) => {
                        params[key] = args[index];
                    });

                    // Call the command but ignore the return value (Commander expects void)
                    await cmd.callback(params);
                } catch (error) {
                    logger.error(`Error executing ${cmd.name}`, error);
                    process.exit(1);
                }
            });
        }

        // Parse command line arguments
        program.parse(process.argv);
    } catch (error) {
        logger.error('Failed to initialize commands', error);
        process.exit(1);
    }
}

main();
