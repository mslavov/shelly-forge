import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, onTestFinished, vi } from 'vitest';
import { dev, type DevOptions } from '../../src/commands/dev.js';
import { createContext } from '../../src/core/command.js';
import type { WatchFactory } from '../../src/dev/watch-project.js';
import { TYPES_DIR } from '../core/package-paths.js';
import { startFakeDevice, type FakeDeviceOptions } from '../helpers/fake-device.js';
import { createTempProject } from '../helpers/project.js';

export const source = (message: string) => `const message: string = ${JSON.stringify(message)}; print(message);`;

export function controlledWatcher() {
    const changes: Array<Parameters<WatchFactory>[2]> = [];
    const handles: Array<EventEmitter & { close: ReturnType<typeof vi.fn> }> = [];
    const watch: WatchFactory = (_directory, _options, change) => {
        changes.push(change);
        const handle = Object.assign(new EventEmitter(), { close: vi.fn() });
        handles.push(handle);
        return handle;
    };
    return { watch, handles, change: () => changes[1]('change', 'lights/room.ts') };
}

export async function fixture(options: FakeDeviceOptions = {}, files: Record<string, string> = {}) {
    const device = await startFakeDevice(options);
    onTestFinished(() => device.close());
    const project = await createTempProject({
        'solutions.config.json': JSON.stringify({ lights: { room: {
            src: 'src/lights/room.ts', device: device.host, targetScriptName: 'controller',
        } } }),
        'tsconfig.json': JSON.stringify({
            compilerOptions: { target: 'es5', noLib: true, strict: true, noEmit: true, types: [], skipLibCheck: true },
            files: [path.join(TYPES_DIR, 'lib.shelly.d.ts'), path.join(TYPES_DIR, 'shelly.d.ts')],
            include: ['src/**/*.ts'], exclude: ['src/**/*.test.ts'],
        }),
        'src/lights/room.ts': source('first'),
        ...files,
    });
    const controller = new AbortController();
    const events: Record<string, unknown>[] = [];
    const text: string[] = [];
    const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };
    const ctx = createContext({}, {
        projectDir: project.dir, env: options.password === undefined ? {} : { SHELLY_PASSWORD: options.password },
        logger, signal: controller.signal,
        emit(event, line) { events.push(event); text.push(line); },
    });
    const watcher = controlledWatcher();
    let pending: ReturnType<typeof dev> | undefined;
    function start(devOptions: DevOptions = { logs: false }, realWatch = false) {
        pending = dev(ctx, 'lights/room', { verifyTimeout: 100, ...devOptions }, { debounceMs: 20, watch: realWatch ? undefined : watcher.watch, inheritedEnv: options.password === undefined ? {} : { SHELLY_PASSWORD: options.password } });
        return pending;
    }
    onTestFinished(async () => {
        controller.abort();
        await pending;
    });
    async function waitForCycles(count: number) {
        await vi.waitFor(() => expect(events.filter(event => event.type === 'dev-cycle').length).toBeGreaterThanOrEqual(count), { timeout: 7000, interval: 10 });
        return events.filter(event => event.type === 'dev-cycle');
    }
    const cycles = () => events.filter(event => event.type === 'dev-cycle');
    async function waitForCycle(predicate: (event: Record<string, unknown>) => boolean, after = 0) {
        await vi.waitFor(() => expect(cycles().slice(after).some(predicate)).toBe(true), { timeout: 7000, interval: 10 });
        return cycles().slice(after).find(predicate)!;
    }
    async function edit(content: string) {
        await writeFile(path.join(project.dir, 'src/lights/room.ts'), content);
        watcher.change();
    }
    return { device, project, controller, ctx, events, text, logger, watcher, start, cycles, waitForCycles, waitForCycle, edit };
}
