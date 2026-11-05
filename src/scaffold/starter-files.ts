import { createHash } from 'node:crypto';

function counterKey(solution: string, script: string): string {
    const key = `${solution}.${script}.count`;
    return key.length <= 42 ? key : `count.${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

export function starterScript(solution: string, script: string): string {
    return `const counterKey = '${counterKey(solution, script)}';
const greeting = process.env.SHELLY_PUBLIC_GREETING || 'Hello';

function onCounterSaved(
  _result: ShellyRpcMethods['KVS.Set']['result'] | undefined,
  errorCode: number,
  errorMessage: string,
  count: number,
): void {
  if (errorCode !== 0) {
    print('Counter write failed:', errorMessage);
    return;
  }
  print(greeting, '${solution}/${script}', count);
}

function onCounterLoaded(result: ShellyKvsItem | undefined, errorCode: number, errorMessage: string): void {
  if (errorCode !== 0 && errorCode !== -105) {
    print('Counter read failed:', errorMessage);
    return;
  }
  let previous = result && result.value;
  if (errorCode === -105) previous = 0;
  if (typeof previous === 'string') previous = Number(previous);
  if (typeof previous !== 'number' || !isFinite(previous) || previous < 0 || Math.floor(previous) !== previous) {
    print('Counter value is not a number:', counterKey);
    return;
  }
  const count = previous + 1;
  Shelly.call('KVS.Set', { key: counterKey, value: count }, onCounterSaved, count);
}

function incrementCounter(): void {
  Shelly.call('KVS.Get', { key: counterKey }, onCounterLoaded);
}

Timer.set(60000, true, incrementCounter);
`;
}

export function starterTest(solution: string, script: string): string {
    const key = `'${counterKey(solution, script)}'`;
    const id = `${solution}/${script}`;
    return `import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createShellyRuntime } from 'shelly-forge/testing';

const scriptPath = fileURLToPath(new URL('./${script}.ts', import.meta.url));

test('${id} persists a counter and prints the default greeting', async () => {
  const runtime = createShellyRuntime();
  await runtime.loadScript(scriptPath, { env: { SHELLY_PUBLIC_GREETING: '' } });

  runtime.advance(59999);
  expect(runtime.kvs.get(${key})).toBeUndefined();
  expect(runtime.logs).toEqual([]);

  runtime.advance(1);
  expect(runtime.kvs.get(${key})).toBe('1');
  expect(runtime.logs).toEqual(['Hello ${id} 1']);

  runtime.advance(60000);
  expect(runtime.kvs.get(${key})).toBe('2');
  expect(runtime.logs).toEqual(['Hello ${id} 1', 'Hello ${id} 2']);
});

test('${id} resumes a saved counter with a configured greeting', async () => {
  const runtime = createShellyRuntime({ kvs: { ${key}: '7' } });
  await runtime.loadScript(scriptPath, { env: { SHELLY_PUBLIC_GREETING: 'Welcome' } });

  runtime.advance(60000);
  expect(runtime.kvs.get(${key})).toBe('8');
  expect(runtime.logs).toEqual(['Welcome ${id} 8']);
});
`;
}
