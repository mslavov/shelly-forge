#!/usr/bin/env node

import { Command } from 'commander';
import init from './commands/init';
import deploy from './commands/deploy';
import debug from './commands/debug';
import logs from './commands/logs';
import create from './commands/create';
import build from './commands/build';

const program = new Command();

program.version('0.1.0');

program
    .command('init')
    .description('Initialize a new Shelly script project')
    .argument('[name]', 'Project name')
    .action(init);

program.command('deploy').description('Deploy the script to Shelly device').action(deploy);

program
    .command('debug')
    .description('Turn debug mode on/off for a specific script')
    .argument('<mode>', 'Debug mode: "on" or "off"')
    .argument('[scriptName]', 'Name of the script (optional)')
    .action(debug);

program
    .command('logs')
    .description('Stream logs from a Shelly script')
    .argument('[scriptName]', 'Name of the script (optional)')
    .action(logs);

program
    .command('create')
    .description('Create a new Shelly script')
    .argument('<name>', 'Name of the script')
    .argument('<hostname>', 'Hostname/IP of the Shelly device')
    .argument('[solution]', 'Solution name for organizing scripts')
    .action(create);

program.command('build').description('Build all Shelly scripts using esbuild').action(build);

program.parse(process.argv);
