const counterKey = 'example.hello.count';
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
  print(greeting, 'example/hello', count);
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
