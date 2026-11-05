import { vi, onTestFinished } from 'vitest';
import { createContext } from '../../src/core/command.js';
import { ProjectConfig } from '../../src/core/config.js';
import { sha256 } from '../../src/core/hash.js';
import { startFakeDevice, type FakeDeviceOptions } from '../helpers/fake-device.js';
import { createTempProject } from '../helpers/project.js';

export function verificationClock() {
    let time = 0;
    return {
        now: () => time,
        sleep: vi.fn(async (ms: number) => { time += ms; }),
        advance: (ms: number) => { time += ms; },
    };
}

export async function fixture(options: FakeDeviceOptions = {}, extra: Record<string, unknown> = {}) {
    const device = await startFakeDevice(options);
    onTestFinished(() => device.close());
    const project = await createTempProject({
        'solutions.config.json': JSON.stringify({ home: {
            main: { src: 'src/main.ts', device: device.host, targetScriptName: 'controller', ...extra },
        } }),
        'src/main.ts': 'declare function print(value: string): void; print("hello");',
    });
    const config = await ProjectConfig.load(project.dir);
    const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };
    const ctx = createContext({}, { projectDir: project.dir, env: {}, logger });
    const entry = config.scripts()[0];
    const built = (code = 'print("hello");') => ({ entry, code, sha256: sha256(code), sizeBytes: Buffer.byteLength(code) });
    return { device, project, config, ctx, built, logger };
}
