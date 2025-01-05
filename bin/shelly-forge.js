#!/usr/bin/env node

const { program } = require("commander");
const inquirer = require("inquirer");
const fs = require("fs-extra");
const path = require("path");
const chalk = require("chalk");

program.version("1.0.0");

program
  .command("init")
  .description("Initialize a new Shelly script project")
  .action(async () => {
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "projectName",
        message: "What is your project name?",
        default: "my-shelly-script",
      },
    ]);

    // Copy template files
    const templateDir = path.join(__dirname, "../templates/default");
    const targetDir = path.join(process.cwd(), answers.projectName);

    await fs.copy(templateDir, targetDir);
    console.log(
      chalk.green(
        `✨ Created new Shelly script project in ${answers.projectName}`
      )
    );
  });

program
  .command("dev")
  .description("Start development server with hot reload")
  .action(async () => {
    require("../lib/dev")();
  });

program
  .command("build")
  .description("Build the script for production")
  .action(async () => {
    require("../lib/build")();
  });

program
  .command("deploy")
  .description("Deploy the script to Shelly device")
  .action(async () => {
    require("../lib/deploy")();
  });

program.parse(process.argv);
