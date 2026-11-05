import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { bundleScript } from '../../src/build/bundler.js';
import { createShellyRuntime } from '../../src/testing/index.js';
import { createTempProject } from '../helpers/project.js';

const automation = `
    import { topic } from './topic';
    const device: string = process.env.SHELLY_PUBLIC_NAME || 'default';
    MQTT.subscribe(topic, (_topic: string, message: string) => {
        Timer.set(10, false, () => {
            Shelly.call('KVS.Set', { key: 'last', value: message }, (_result: unknown, code: number) => {
                if (code === 0) { MQTT.publish('result/' + device, message); print('stored', message); }
            });
        });
    });
`;

test('loadScript bundles a TypeScript automation with timer, KVS and MQTT', async () => {
    const { dir } = await createTempProject({ 'src/main.ts': automation, 'src/topic.ts': `export const topic = 'test/+';` });
    const runtime = createShellyRuntime();
    await runtime.loadScript('src/main.ts', { projectDir: dir, env: { SHELLY_PUBLIC_NAME: 'unit' } });
    runtime.mqtt.receive('test/value', '42');
    runtime.advance(9);
    expect(runtime.kvs.get('last')).toBeUndefined();
    runtime.advance(1);
    expect(runtime.calls).toEqual([{ method: 'KVS.Set', params: { key: 'last', value: '42' } }]);
    expect(runtime.kvs.entries()).toEqual({ last: '42' });
    expect(runtime.mqtt.published).toEqual([{ topic: 'result/unit', message: '42', qos: 0, retain: false }]);
    expect(runtime.logs).toEqual(['stored 42']);
});

test('built public entry runs the minified deployed artifact as a consumer', async () => {
    const { dir } = await createTempProject({ 'src/main.ts': automation, 'src/topic.ts': `export const topic = 'test/#';` });
    const bundle = await bundleScript({ projectDir: dir, entry: 'src/main.ts', minify: true, env: { SHELLY_PUBLIC_NAME: 'packed' } });
    const artifact = path.join(dir, 'automation.js');
    await writeFile(artifact, bundle.code);
    const moduleUrl = new URL('../../dist/testing/index.js', import.meta.url).href;
    const { createShellyRuntime: createBuiltRuntime } = await import(moduleUrl) as typeof import('../../src/testing/index.js');
    const runtime = createBuiltRuntime();
    await runtime.loadArtifact(artifact);
    runtime.mqtt.receive('test', 'minified');
    runtime.advance(10);
    expect(runtime.calls).toEqual([{ method: 'KVS.Set', params: { key: 'last', value: 'minified' } }]);
    expect(runtime.logs).toEqual(['stored minified']);
    expect(runtime.kvs.get('last')).toBe('minified');
    expect(runtime.mqtt.published).toEqual([{ topic: 'result/packed', message: 'minified', qos: 0, retain: false }]);
});
