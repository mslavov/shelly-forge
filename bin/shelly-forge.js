#!/usr/bin/env node

const { program } = require('commander');
const inquirer = require('inquirer');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const { spawn } = require('child_process');

program.version('1.0.0');

program
    .command('init')
    .description('Initialize a new Shelly script project')
    .action(async () => {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'projectName',
                message: 'What is your project name?',
                default: 'my-shelly-script',
            },
        ]);

        // Copy template files
        const templateDir = path.join(__dirname, '../templates/default');
        const targetDir = path.join(process.cwd(), answers.projectName);

        await fs.copy(templateDir, targetDir);
        console.log(chalk.green(`✨ Created new Shelly script project in ${answers.projectName}`));
    });

program
    .command('deploy')
    .description('Deploy the script to Shelly device')
    .action(async () => {
        try {
            const distPath = path.join(process.cwd(), 'dist');
            const scripts = require(path.join(distPath, 'index.js'));

            if (typeof scripts !== 'object') {
                throw new Error('dist/index.js must export an object of ShellyScript instances');
            }

            for (const [name, script] of Object.entries(scripts)) {
                if (typeof script.deploy !== 'function') {
                    console.log(chalk.yellow(`Warning: Script "${name}" does not have a deploy method, skipping...`));
                    continue;
                }

                console.log(chalk.blue(`Deploying script: ${name}`));
                const success = await script.deploy(name);
                if (success) {
                    console.log(chalk.green(`✨ Successfully deployed ${name}`));
                } else {
                    console.log(chalk.yellow(`✨ Skipping deployment of ${name} as it has not changed`));
                }
            }
        } catch (error) {
            console.error(chalk.red('Deploy failed:'), error.message);
            process.exit(1);
        }
    });

program
    .command('debug')
    .description('Turn debug mode on/off for a specific script')
    .argument('<mode>', 'Debug mode: "on" or "off"')
    .argument('[scriptName]', 'Name of the script (optional)')
    .action(async (mode, scriptName) => {
        try {
            if (mode !== 'on' && mode !== 'off') {
                throw new Error('Debug mode must be either "on" or "off"');
            }

            const distPath = path.join(process.cwd(), 'dist');
            const scripts = require(path.join(distPath, 'index.js'));

            if (typeof scripts !== 'object') {
                throw new Error('dist/index.js must export an object of ShellyScript instances');
            }

            const debugEnabled = mode === 'on';

            if (scriptName) {
                // Debug specific script
                const script = scripts[scriptName];
                if (!script) {
                    throw new Error(`Script "${scriptName}" not found`);
                }
                if (typeof script.setDebug !== 'function') {
                    throw new Error(`Script "${scriptName}" does not support debug mode`);
                }

                console.log(chalk.blue(`Setting debug ${mode} for script: ${scriptName}`));
                await script.setDebug(debugEnabled);
                console.log(chalk.green(`✨ Successfully set debug ${mode} for ${scriptName}`));
            } else {
                // Debug all scripts
                for (const [name, script] of Object.entries(scripts)) {
                    if (typeof script.setDebug !== 'function') {
                        console.log(chalk.yellow(`Warning: Script "${name}" does not support debug mode, skipping...`));
                        continue;
                    }

                    console.log(chalk.blue(`Setting debug ${mode} for script: ${name}`));
                    await script.setDebug(debugEnabled);
                    console.log(chalk.green(`✨ Successfully set debug ${mode} for ${name}`));
                }
            }
        } catch (error) {
            console.error(chalk.red('Debug command failed:'), error.message);
            process.exit(1);
        }
    });

program
    .command('logs')
    .description('Stream logs from a Shelly script')
    .argument('<scriptName>', 'Name of the script')
    .action(async (scriptName) => {
        try {
            const distPath = path.join(process.cwd(), 'dist');
            const scripts = require(path.join(distPath, 'index.js'));

            if (typeof scripts !== 'object') {
                throw new Error('dist/index.js must export an object of ShellyScript instances');
            }

            const script = scripts[scriptName];
            if (!script) {
                throw new Error(`Script "${scriptName}" not found`);
            }
            if (!script.ip) {
                throw new Error(`Script "${scriptName}" does not have an IP address configured`);
            }

            console.log(chalk.blue(`Streaming logs for script: ${scriptName}`));

            const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
            const wscat = spawn(npm, ['run', 'wscat', '--', `ws://${script.ip}/debug/log`], {
                stdio: 'inherit',
                shell: true,
            });

            wscat.on('error', (error) => {
                console.error(chalk.red('Failed to start wscat:'), error.message);
                process.exit(1);
            });
        } catch (error) {
            console.error(chalk.red('Logs command failed:'), error.message);
            process.exit(1);
        }
    });

program.parse(process.argv);
