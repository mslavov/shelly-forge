#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_COMMANDS } from './commands/index.js';
import { runAction } from './core/command.js';
import { ForgeError } from './core/errors.js';
import { VERSION } from './version.js';

async function main(): Promise<void> {
    const program = new Command('shelly-forge')
        .description('Build and deploy scripts for Shelly devices')
        .version(VERSION)
        .option('--cwd <dir>', 'Project directory')
        .option('--json', 'Print machine-readable output')
        .option('-v, --verbose', 'Print debug output')
        .option('-q, --quiet', 'Hide progress output')
        .addHelpCommand(false)
        .exitOverride()
        .configureOutput({ writeErr: () => {} });
    for (const register of ALL_COMMANDS) register(program);
    let command = program;
    program.hook('preSubcommand', (_parent, child) => { command = child; });
    try {
        await program.parseAsync();
    } catch (error) {
        if (error instanceof CommanderError && (error.code === 'commander.help' || error.code === 'commander.helpDisplayed')) {
            if (error.exitCode !== 0) {
                process.stderr.write(program.helpInformation());
                process.exitCode = 1;
            }
            return;
        }
        if (error instanceof CommanderError && error.exitCode === 0) return;
        await runAction(command, async () => {
            if (error instanceof CommanderError) throw new ForgeError('USAGE', error.message.replace(/^error: /, ''));
            throw error;
        });
    }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
