import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findPackageRoot(): string {
    let directory = path.dirname(fileURLToPath(import.meta.url));
    while (!existsSync(path.join(directory, 'package.json'))) {
        const parent = path.dirname(directory);
        if (parent === directory) throw new Error('Could not locate the shelly-forge package');
        directory = parent;
    }
    return directory;
}

export const PACKAGE_ROOT = findPackageRoot();
export const TEMPLATES_DIR = path.join(PACKAGE_ROOT, 'templates');
export const SKILLS_DIR = path.join(PACKAGE_ROOT, 'skills');
