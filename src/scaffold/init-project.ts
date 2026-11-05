import { cp, lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ForgeError } from '../core/errors.js';
import { TEMPLATES_DIR } from '../core/paths.js';
import { installSkills, listSkills, type InstallSkillsResult } from './skills.js';

export interface InitProjectResult {
    name: string;
    projectDir: string;
    skills?: InstallSkillsResult;
    nextSteps: string[];
}

export async function initProject(options: {
    projectDir: string;
    name: string;
    skills?: boolean;
    sourceDir?: string;
}): Promise<InitProjectResult> {
    const { name } = options;
    if (name.length > 214 || !/^[a-z0-9-][a-z0-9._-]*$/.test(name) || ['node_modules', 'favicon.ico'].includes(name)) {
        throw new ForgeError('USAGE', `Invalid project name "${name}"`, {
            hint: 'Use up to 214 lowercase letters, digits, hyphens, underscores, or dots. Do not start with a dot or underscore.',
        });
    }
    const projectDir = path.resolve(options.projectDir, name);
    try {
        const target = await lstat(projectDir);
        if (!target.isDirectory() || (await readdir(projectDir)).length > 0) {
            throw new ForgeError('USAGE', `Project directory ${projectDir} already exists and is not an empty directory`);
        }
    } catch (error) {
        if (error instanceof ForgeError) throw error;
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new ForgeError('CONFIG', `Could not inspect project directory ${projectDir}`, { cause: error });
        }
    }

    const templateDir = path.join(TEMPLATES_DIR, 'default');
    let packageJson: Record<string, unknown>;
    try {
        const parsed: unknown = JSON.parse(await readFile(path.join(templateDir, 'package.json'), 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a package.json object');
        packageJson = { ...parsed, name };
    } catch (error) {
        throw new ForgeError('CONFIG', 'Could not read the default project template package.json', { cause: error });
    }
    if (options.skills !== false) await listSkills({ projectDir, sourceDir: options.sourceDir });

    try {
        await mkdir(projectDir, { recursive: true });
        for (const entry of await readdir(templateDir)) {
            await cp(path.join(templateDir, entry), path.join(projectDir, entry), { recursive: true, force: false, errorOnExist: true });
        }
        try {
            await rename(path.join(projectDir, 'gitignore'), path.join(projectDir, '.gitignore'));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await writeFile(path.join(projectDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
    } catch (error) {
        throw new ForgeError('CONFIG', `Could not create project at ${projectDir}`, { cause: error });
    }
    const skills = options.skills === false ? undefined : await installSkills({ projectDir, sourceDir: options.sourceDir });
    return {
        name,
        projectDir,
        skills,
        nextSteps: [
            `cd ${name}`,
            'npm install',
            'cp .env.example .env',
            'npx shelly-forge create <solution> <script>',
        ],
    };
}
