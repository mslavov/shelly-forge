import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { ForgeError } from './errors.js';

export function resolveProjectDir(cwdOption?: string, env: NodeJS.ProcessEnv = process.env): string {
    return path.resolve(cwdOption ?? env.CURRENT_WORKING_DIRECTORY ?? process.cwd());
}

export function loadProjectEnv(projectDir: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    let content: string;
    try {
        content = readFileSync(path.join(projectDir, '.env'), 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return env;
        throw new ForgeError('CONFIG', 'Could not read the project .env file', { cause: error });
    }
    for (const [key, value] of Object.entries(parseEnv(content))) {
        if (env[key] === undefined) env[key] = value;
    }
    return env;
}
