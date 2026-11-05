import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ForgeError } from './errors.js';
import { deviceKey, parseDeviceUrl } from './hosts.js';

export const CONFIG_FILE = 'solutions.config.json';

const nameSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, 'Use only letters, numbers, underscores, and hyphens');
const scriptSchema = z.strictObject({
    src: z.string().min(1).regex(/^(?![\\/]|[A-Za-z]:)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$)).+$/, 'Source path must stay inside the project'),
    device: z.string().min(1),
    enableOnBoot: z.boolean().optional(),
    targetScriptName: z.string().min(1).optional(),
    password: z.string().optional(),
});
const solutionSchema = z.record(nameSchema, scriptSchema);
export const solutionsConfigSchema: z.ZodType = z.object({ $schema: z.string().optional() })
    .catchall(solutionSchema);

type RawScript = z.infer<typeof scriptSchema>;

export interface ScriptEntry {
    id: string;
    solution: string;
    name: string;
    artifactName: string;
    targetScriptName: string;
    src: string;
    srcPath: string;
    enableOnBoot: boolean;
    deviceRef: string;
    passwordRef?: string;
}

export interface DeviceTarget {
    host: string;
    username: string;
    password?: string;
}

function validateValue(schema: z.ZodType, value: unknown, prefix: string[] = []): void {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        const issues = parsed.error.issues.map(issue => ({ path: [...prefix, ...issue.path.map(String)].join('.'), message: issue.message }));
        throw new ForgeError('CONFIG', `Invalid ${CONFIG_FILE}: ${issues.map(issue => `${issue.path || '(root)'}: ${issue.message}`).join('; ')}`, { details: issues });
    }
}

function validateConfig(value: unknown): Record<string, unknown> {
    validateValue(solutionsConfigSchema, value);
    const config = value as Record<string, unknown>;
    const artifacts = new Map<string, string>();
    for (const [name, solution] of Object.entries(config)) {
        if (name === '$schema') continue;
        if (!nameSchema.safeParse(name).success) {
            throw new ForgeError('CONFIG', `Invalid solution name "${name}"`);
        }
        // Zod skips __proto__ record keys, so validate them separately and preserve raw own properties.
        if (name === '__proto__') validateValue(solutionSchema, solution, [name]);
        if (Object.hasOwn(solution as object, '__proto__')) {
            validateValue(scriptSchema, (solution as Record<string, unknown>).__proto__, [name, '__proto__']);
        }
        for (const script of Object.keys(solution as object)) {
            const artifact = `${name}-${script}`;
            const id = `${name}/${script}`;
            const existing = artifacts.get(artifact);
            if (existing) {
                throw new ForgeError('CONFIG', `Scripts "${existing}" and "${id}" both produce artifact "${artifact}.js"`);
            }
            artifacts.set(artifact, id);
        }
    }
    return config;
}

export function resolveEnvRefs(value: string, env: NodeJS.ProcessEnv): string {
    return value.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
        const resolved = env[name];
        if (resolved === undefined || resolved === '') {
            throw new ForgeError('CONFIG', `Environment variable ${name} is not set`, {
                hint: `Set ${name} in the project's .env file or in the environment.`,
            });
        }
        return resolved;
    });
}

export class ProjectConfig {
    readonly projectDir: string;

    private constructor(projectDir: string, private readonly config: Record<string, unknown>) {
        this.projectDir = path.resolve(projectDir);
    }

    private static async read(projectDir: string, allowMissing: boolean): Promise<ProjectConfig> {
        let content: string;
        try {
            content = await readFile(path.join(projectDir, CONFIG_FILE), 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                if (allowMissing) return new ProjectConfig(projectDir, {});
                throw new ForgeError('CONFIG', `${CONFIG_FILE} not found. Please create a project first.`, { cause: error });
            }
            throw new ForgeError('CONFIG', `Could not read ${CONFIG_FILE}`, { cause: error });
        }
        let value: unknown;
        try {
            value = JSON.parse(content);
        } catch (error) {
            throw new ForgeError('CONFIG', `Invalid JSON in ${CONFIG_FILE}`, { cause: error });
        }
        return new ProjectConfig(projectDir, validateConfig(value));
    }

    static async load(projectDir: string): Promise<ProjectConfig> {
        return ProjectConfig.read(projectDir, false);
    }

    static async loadOrCreate(projectDir: string): Promise<ProjectConfig> {
        return ProjectConfig.read(projectDir, true);
    }

    scripts(): ScriptEntry[] {
        const scripts: ScriptEntry[] = [];
        for (const [solution, value] of Object.entries(this.config)) {
            if (solution === '$schema') continue;
            for (const [name, entry] of Object.entries(value as Record<string, RawScript>)) {
                scripts.push({
                    id: `${solution}/${name}`, solution, name,
                    artifactName: `${solution}-${name}`,
                    targetScriptName: entry.targetScriptName ?? name,
                    src: entry.src, srcPath: path.resolve(this.projectDir, entry.src),
                    enableOnBoot: entry.enableOnBoot ?? true,
                    deviceRef: entry.device, passwordRef: entry.password,
                });
            }
        }
        return scripts;
    }

    select(selector?: string): ScriptEntry[] {
        const scripts = this.scripts();
        if (selector === undefined) return scripts;
        const matches = scripts.filter(script => [script.id, script.artifactName, script.name, script.targetScriptName].includes(selector));
        if (matches.length === 0) throw new ForgeError('CONFIG', `Script selector "${selector}" not found in ${CONFIG_FILE}`);
        if (matches.length > 1) {
            throw new ForgeError('CONFIG', `Script selector "${selector}" is ambiguous. Use one of: ${matches.map(script => script.id).join(', ')}`);
        }
        return matches;
    }

    resolveDevice(entry: ScriptEntry, env: NodeJS.ProcessEnv): DeviceTarget {
        const host = resolveEnvRefs(entry.deviceRef, env);
        try {
            parseDeviceUrl(host);
        } catch {
            throw new ForgeError('CONFIG', `Invalid device host for ${entry.id}. Use a hostname or IP address with an optional port.`);
        }
        const password = entry.passwordRef === undefined ? env.SHELLY_PASSWORD : resolveEnvRefs(entry.passwordRef, env);
        return { host, username: 'admin', ...(password === undefined ? {} : { password }) };
    }

    addScript(solution: string, name: string, entry: { src: string; device: string; enableOnBoot?: boolean }): void {
        if (solution === '$schema') throw new ForgeError('CONFIG', 'Invalid solution name "$schema"');
        const existing = Object.hasOwn(this.config, solution) ? this.config[solution] as Record<string, RawScript> : undefined;
        if (existing && Object.hasOwn(existing, name)) throw new ForgeError('CONFIG', `Script "${solution}/${name}" already exists`);
        const candidate = validateConfig({
            ...this.config,
            [solution]: { ...existing, [name]: { ...entry, enableOnBoot: entry.enableOnBoot ?? true } },
        });
        Object.defineProperty(this.config, solution, {
            value: candidate[solution], enumerable: true, writable: true, configurable: true,
        });
    }

    async save(): Promise<void> {
        try {
            await writeFile(path.join(this.projectDir, CONFIG_FILE), `${JSON.stringify(this.config, null, 2)}\n`, 'utf8');
        } catch (error) {
            throw new ForgeError('CONFIG', `Could not write ${CONFIG_FILE}`, { cause: error });
        }
    }
}

export function validateSelectedTargets(config: ProjectConfig, entries: readonly ScriptEntry[], env: NodeJS.ProcessEnv): ReadonlyMap<string, DeviceTarget> {
    const selected = new Map(entries.map(entry => [entry.id, entry]));
    const resolved = new Map<string, DeviceTarget>();
    const targets = new Map<string, ScriptEntry>();
    for (const entry of selected.values()) {
        const target = config.resolveDevice(entry, env);
        const key = `${deviceKey(target.host)}\0${entry.targetScriptName}`;
        const existing = targets.get(key);
        if (existing) {
            throw new ForgeError('CONFIG', `Scripts "${existing.id}" and "${entry.id}" both target on-device script "${entry.targetScriptName}" on ${target.host}`);
        }
        resolved.set(entry.id, target);
        targets.set(key, entry);
    }
    for (const entry of config.scripts()) {
        if (selected.has(entry.id)) continue;
        let target: DeviceTarget;
        try {
            target = config.resolveDevice(entry, env);
        } catch (error) {
            if (error instanceof ForgeError && error.code === 'CONFIG') continue;
            throw error;
        }
        const key = `${deviceKey(target.host)}\0${entry.targetScriptName}`;
        const existing = targets.get(key);
        if (existing) {
            throw new ForgeError('CONFIG', `Scripts "${existing.id}" and "${entry.id}" both target on-device script "${entry.targetScriptName}" on ${target.host}`);
        }
    }
    return resolved;
}
