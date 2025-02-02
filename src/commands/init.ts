import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';

export default async function init(name?: string): Promise<void> {
    let projectName = name;

    if (!projectName) {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'projectName',
                message: 'What is your project name?',
                default: 'my-shelly-script',
            },
        ]);
        projectName = answers.projectName;
    }

    // Copy template files
    const templateDir = path.join(__dirname, '../../templates/default');
    const targetDir = path.join(process.cwd(), projectName);

    await fs.copy(templateDir, targetDir);

    // Rename gitignore to .gitignore
    const gitignorePath = path.join(targetDir, 'gitignore');
    const dotGitignorePath = path.join(targetDir, '.gitignore');
    if (await fs.pathExists(gitignorePath)) {
        await fs.rename(gitignorePath, dotGitignorePath);
    }

    console.log(chalk.green(`✨ Created new Shelly script project in ${projectName}`));
}
