import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';
import { CURRENT_WORKING_DIRECTORY } from './utils/cwd.js';

export interface ScriptConfig {
    src: string;
    device: string;
    enableOnBoot?: boolean;
    targetScriptName?: string;
}

export interface ConfiguredScript {
    solutionName: string;
    scriptName: string;
    scriptConfig: ScriptConfig;
    scriptId: string;
    artifactName: string;
    targetScriptName: string;
}

export interface SolutionConfig {
    [scriptName: string]: ScriptConfig;
}

export interface Config {
    [solutionName: string]: SolutionConfig;
}

export class SolutionsConfig {
    private config: Config;
    private rawConfig: Config;
    private readonly configPath: string;

    constructor(configPath: string = 'solutions.config.json') {
        this.configPath = path.join(CURRENT_WORKING_DIRECTORY, configPath);
        this.config = {};
        this.rawConfig = {};
        // Load environment variables from .env file
        dotenv.config();
    }

    private resolveEnvVar(value: string): string {
        // Check if the value matches ${ENV_VAR} pattern
        const envVarMatch = value.match(/^\${([^}]+)}$/);
        if (envVarMatch) {
            const envVarName = envVarMatch[1];
            const envValue = process.env[envVarName];
            if (!envValue) {
                throw new Error(`Environment variable ${envVarName} is not set`);
            }
            return envValue;
        }
        return value;
    }

    private resolveConfigValues(config: Config): Config {
        const resolvedConfig: Config = {};
        for (const [solutionName, solution] of Object.entries(config)) {
            resolvedConfig[solutionName] = {};
            for (const [scriptName, scriptConfig] of Object.entries(solution)) {
                resolvedConfig[solutionName][scriptName] = {
                    ...scriptConfig,
                    device: scriptConfig.device ? this.resolveEnvVar(scriptConfig.device) : scriptConfig.device,
                };
            }
        }
        return resolvedConfig;
    }

    async load(): Promise<void> {
        if (!(await fs.pathExists(this.configPath))) {
            throw new Error('solutions.config.json not found. Please create a project first.');
        }
        this.rawConfig = await fs.readJson(this.configPath);
        this.config = this.resolveConfigValues(this.rawConfig);
    }

    async save(): Promise<void> {
        // Save the raw config to preserve environment variables
        await fs.writeJson(this.configPath, this.rawConfig, { spaces: 2 });
    }

    private toConfiguredScript(solutionName: string, scriptName: string, scriptConfig: ScriptConfig): ConfiguredScript {
        return {
            solutionName,
            scriptName,
            scriptConfig,
            scriptId: `${solutionName}/${scriptName}`,
            artifactName: `${solutionName}-${scriptName}`,
            targetScriptName: scriptConfig.targetScriptName || scriptName,
        };
    }

    private matchesScriptSelector(script: ConfiguredScript, selector: string): boolean {
        return selector === script.scriptId ||
            selector === script.artifactName ||
            selector === script.scriptName ||
            selector === script.targetScriptName;
    }

    findScript(selector: string): ConfiguredScript | undefined {
        const matches = this.getAllScripts().filter((script) => this.matchesScriptSelector(script, selector));

        if (matches.length > 1) {
            throw new Error(
                `Script selector "${selector}" is ambiguous. Use one of: ${matches.map((script) => script.scriptId).join(', ')}`
            );
        }

        return matches[0];
    }

    getScripts(selector?: string): ConfiguredScript[] {
        if (!selector) {
            return this.getAllScripts();
        }

        const script = this.findScript(selector);
        if (!script) {
            throw new Error(`Script selector "${selector}" not found in solutions.config.json`);
        }

        return [script];
    }

    getAllScripts(): ConfiguredScript[] {
        const scripts: ConfiguredScript[] = [];
        for (const [solutionName, solutionData] of Object.entries(this.config)) {
            for (const [scriptName, scriptConfig] of Object.entries(solutionData)) {
                scripts.push(this.toConfiguredScript(solutionName, scriptName, scriptConfig));
            }
        }
        return scripts;
    }

    validateUniqueDeviceTargets(): void {
        const targets = new Map<string, ConfiguredScript>();

        for (const script of this.getAllScripts()) {
            const key = `${script.scriptConfig.device}\0${script.targetScriptName}`;
            const existing = targets.get(key);

            if (existing) {
                throw new Error(
                    `Scripts "${existing.scriptId}" and "${script.scriptId}" both target on-device script "${script.targetScriptName}" on ${script.scriptConfig.device}`
                );
            }

            targets.set(key, script);
        }
    }

    addScript(solutionName: string, scriptName: string, scriptConfig: ScriptConfig): void {
        // Initialize solution if it doesn't exist in both configs
        this.rawConfig[solutionName] = this.rawConfig[solutionName] || {};
        this.config[solutionName] = this.config[solutionName] || {};

        // Store the original config in rawConfig
        this.rawConfig[solutionName][scriptName] = {
            ...scriptConfig,
            enableOnBoot: scriptConfig.enableOnBoot ?? true,
        };

        // Store the resolved config in config
        this.config[solutionName][scriptName] = {
            ...scriptConfig,
            device: scriptConfig.device ? this.resolveEnvVar(scriptConfig.device) : scriptConfig.device,
            enableOnBoot: scriptConfig.enableOnBoot ?? true,
        };
    }

    getDevicesForSolution(solutionName: string): string[] {
        if (!this.config[solutionName]) {
            return [];
        }
        const devices = new Set(
            Object.values(this.config[solutionName])
                .map((scriptConfig) => scriptConfig.device)
                .filter(Boolean)
        );
        return Array.from(devices);
    }

    exists(): Promise<boolean> {
        return fs.pathExists(this.configPath);
    }

    getSolutions(): string[] {
        return Object.keys(this.config);
    }
}
