import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ForgeError } from '../core/errors.js';
import { SKILLS_DIR } from '../core/paths.js';
import { VERSION } from '../version.js';

const VERSION_FILE = '.shelly-forge-version';

export interface InstallSkillsResult {
    installed: string[];
    skipped: { name: string; reason: string }[];
}

export interface SkillInfo {
    name: string;
    bundledVersion: string;
    installedVersion?: string;
    managed: boolean;
}

async function bundledSkills(sourceDir: string): Promise<string[]> {
    let names: string[];
    try {
        names = (await readdir(sourceDir, { withFileTypes: true }))
            .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
            .map(entry => entry.name).sort();
    } catch (error) {
        throw new ForgeError('CONFIG', `Could not read bundled skills at ${sourceDir}`, {
            cause: error, hint: 'Reinstall shelly-forge with its bundled skills directory.',
        });
    }
    if (names.length === 0) {
        throw new ForgeError('CONFIG', `No bundled skills found at ${sourceDir}`, {
            hint: 'Reinstall shelly-forge with its bundled skills directory.',
        });
    }
    return names;
}

async function installedSkill(directory: string): Promise<{ exists: boolean; version?: string; target?: string }> {
    let target: string | undefined;
    try {
        const entry = await lstat(directory);
        if (entry.isSymbolicLink()) target = path.resolve(path.dirname(directory), await readlink(directory));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false };
        throw error;
    }
    try {
        return { exists: true, target, version: (await readFile(path.join(directory, VERSION_FILE), 'utf8')).trim() };
    } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return { exists: true, target };
        throw error;
    }
}

export async function installSkills(options: {
    projectDir: string;
    sourceDir?: string;
    names?: string[];
    force?: boolean;
}): Promise<InstallSkillsResult> {
    const sourceDir = options.sourceDir ?? SKILLS_DIR;
    const available = await bundledSkills(sourceDir);
    const names = options.names?.length ? [...new Set(options.names)] : available;
    const unknown = names.filter(name => !available.includes(name));
    if (unknown.length) {
        throw new ForgeError('USAGE', `Unknown skill names: ${unknown.join(', ')}. Available skills: ${available.join(', ')}`);
    }

    const result: InstallSkillsResult = { installed: [], skipped: [] };
    for (const name of names) {
        const directory = path.resolve(options.projectDir, '.agents', 'skills', name);
        const alias = path.resolve(options.projectDir, '.claude', 'skills', name);
        try {
            const installed = await installedSkill(directory);
            const linked = await installedSkill(alias);
            const userOwned = installed.exists && installed.version === undefined ? directory
                : linked.exists && linked.version === undefined && linked.target !== directory ? alias : undefined;
            if (userOwned && !options.force) {
                result.skipped.push({ name, reason: `User-owned skill at ${userOwned} has no ${VERSION_FILE} stamp` });
                continue;
            }
            if (installed.version === VERSION && !options.force) {
                result.skipped.push({ name, reason: `Already installed at version ${VERSION}` });
                continue;
            }

            await mkdir(path.dirname(directory), { recursive: true });
            await mkdir(path.dirname(alias), { recursive: true });
            const staging = await mkdtemp(path.join(path.dirname(directory), `.${name}-`));
            const replacement = path.join(staging, 'replacement');
            const previous = path.join(staging, 'previous');
            let previousMoved = false;
            let replacementMoved = false;
            try {
                await cp(path.join(sourceDir, name), replacement, { recursive: true });
                await writeFile(path.join(replacement, VERSION_FILE), `${VERSION}\n`, 'utf8');
                if (installed.exists) {
                    await rename(directory, previous);
                    previousMoved = true;
                }
                await rename(replacement, directory);
                replacementMoved = true;
            } finally {
                if (previousMoved && !replacementMoved) await rename(previous, directory);
                await rm(staging, { recursive: true, force: true });
            }
            await rm(alias, { recursive: true, force: true });
            try {
                await symlink(path.relative(path.dirname(alias), directory), alias, 'dir');
            } catch {
                await cp(directory, alias, { recursive: true, force: false, errorOnExist: true });
            }
            result.installed.push(name);
        } catch (error) {
            throw new ForgeError('CONFIG', `Could not install skill "${name}"`, { cause: error });
        }
    }
    return result;
}

export async function listSkills(options: { projectDir: string; sourceDir?: string }): Promise<SkillInfo[]> {
    const names = await bundledSkills(options.sourceDir ?? SKILLS_DIR);
    return Promise.all(names.map(async name => {
        try {
            const { version } = await installedSkill(path.join(options.projectDir, '.agents', 'skills', name));
            return { name, bundledVersion: VERSION, installedVersion: version, managed: version !== undefined };
        } catch (error) {
            throw new ForgeError('CONFIG', `Could not inspect skill "${name}"`, { cause: error });
        }
    }));
}
