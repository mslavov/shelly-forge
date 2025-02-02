import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { SolutionsConfig } from '../solutions-config';

export default async function create(name: string, hostname: string, solution = 'default'): Promise<void> {
    try {
        const baseDir = path.join(process.cwd(), 'src');
        const scriptsDir = path.join(baseDir, solution);

        await fs.ensureDir(scriptsDir);

        const scriptPath = path.join(scriptsDir, `${name}.ts`);

        if (await fs.pathExists(scriptPath)) {
            console.error(chalk.red(`Script ${name} already exists at ${scriptPath}`));
            process.exit(1);
        }

        const scriptContent = `print("Hello World");
`;

        await fs.writeFile(scriptPath, scriptContent, 'utf8');

        const config = new SolutionsConfig();
        if (await config.exists()) {
            await config.load();
        }

        config.addScript(solution, name, {
            src: `src/${solution}/${name}.ts`,
            device: hostname,
        });

        await config.save();
        console.log(chalk.blue('Updated solutions.config.json'));

        console.log(chalk.green(`✨ Created new script at ${path.relative(process.cwd(), scriptPath)}`));
        console.log(chalk.yellow('\nTo start development:'));
        console.log(chalk.yellow(`SCRIPT_NAME=${name} npm run dev`));
    } catch (error) {
        console.error(chalk.red('Failed to create script:'), (error as Error).message);
        process.exit(1);
    }
}
