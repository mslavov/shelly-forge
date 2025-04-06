import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';
import { CURRENT_WORKING_DIRECTORY } from './utils/cwd.js';

export interface ScriptConfig {
    src: string;
    device: string;
    enableOnBoot?: boolean;
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

    findScript(scriptName: string): { solutionName: string; scriptConfig: ScriptConfig } | undefined {
        for (const [solutionName, solutionData] of Object.entries(this.config)) {
            if (scriptName in solutionData) {
                return {
                    solutionName,
                    scriptConfig: solutionData[scriptName],
                };
            }
        }
        return undefined;
    }

    getAllScripts(): Array<{ solutionName: string; scriptName: string; scriptConfig: ScriptConfig }> {
        const scripts: Array<{ solutionName: string; scriptName: string; scriptConfig: ScriptConfig }> = [];
        for (const [solutionName, solutionData] of Object.entries(this.config)) {
            for (const [scriptName, scriptConfig] of Object.entries(solutionData)) {
                scripts.push({ solutionName, scriptName, scriptConfig });
            }
        }
        return scripts;
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
        return Object.keys(this.config.solutions || {});
    }
}
