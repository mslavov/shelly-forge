import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createShellyRuntime } from 'shelly-forge/testing';

const scriptPath = fileURLToPath(new URL('./hello.ts', import.meta.url));

test('example/hello persists a counter and prints the default greeting', async () => {
  const runtime = createShellyRuntime();
  await runtime.loadScript(scriptPath, { env: { SHELLY_PUBLIC_GREETING: '' } });

  runtime.advance(59999);
  expect(runtime.kvs.get('example.hello.count')).toBeUndefined();
  expect(runtime.logs).toEqual([]);

  runtime.advance(1);
  expect(runtime.kvs.get('example.hello.count')).toBe('1');
  expect(runtime.logs).toEqual(['Hello example/hello 1']);

  runtime.advance(60000);
  expect(runtime.kvs.get('example.hello.count')).toBe('2');
  expect(runtime.logs).toEqual(['Hello example/hello 1', 'Hello example/hello 2']);
});

test('example/hello resumes a saved counter with a configured greeting', async () => {
  const runtime = createShellyRuntime({ kvs: { 'example.hello.count': '7' } });
  await runtime.loadScript(scriptPath, { env: { SHELLY_PUBLIC_GREETING: 'Welcome' } });

  runtime.advance(60000);
  expect(runtime.kvs.get('example.hello.count')).toBe('8');
  expect(runtime.logs).toEqual(['Welcome example/hello 8']);
});
