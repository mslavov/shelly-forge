import path from 'node:path';
import { vi } from 'vitest';
import { createContext } from '../../src/core/command.js';
import { ProjectConfig, type ScriptEntry } from '../../src/core/config.js';
import { createTempProject } from '../helpers/project.js';

export const tsconfig = JSON.stringify({
    compilerOptions: { target: 'es2022', strict: true, noEmit: true, types: [], skipLibCheck: true },
    include: ['src/**/*.ts'],
});

export async function project(source = 'print("fixture");', extra: Record<string, string> = {}) {
    const fixture = await createTempProject({
        'solutions.config.json': JSON.stringify({ climate: { publish: { src: 'src/publish.ts', device: '${BUILD_TEST_UNSET_DEVICE}' } } }),
        'tsconfig.json': tsconfig,
        'src/globals.d.ts': 'declare function print(...values: unknown[]): void; declare var process: { env: Record<string, string | undefined> };',
        'src/publish.ts': source,
        ...extra,
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() };
    const ctx = createContext({}, { projectDir: fixture.dir, env: {}, logger });
    const config = await ProjectConfig.load(fixture.dir);
    return { ...fixture, ctx, config, logger };
}

export function entry(projectDir = '/fixture'): ScriptEntry {
    return {
        id: 'climate/publish', solution: 'climate', name: 'publish', artifactName: 'climate-publish',
        targetScriptName: 'publish', src: 'src/publish.ts', srcPath: path.join(projectDir, 'src/publish.ts'),
        enableOnBoot: true, deviceRef: '${BUILD_TEST_UNSET_DEVICE}',
    };
}
