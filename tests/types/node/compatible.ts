import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';

const directory: string = process.cwd();
const nodeTimer: NodeJS.Timeout = setTimeout(function () {}, 1);
const promise: Promise<string> = Promise.resolve(directory);
const bytes: Buffer = readFileSync('package.json');
const character: string | undefined = 'abc'.at(0);
console.log(nodeTimer, promise, bytes, character);
clearTimeout(nodeTimer);

Shelly.call('Switch.Set', { id: 0, on: true }, function (result) {
  if (result) {
    const wasOn: boolean = result.was_on;
    console.log(wasOn);
  }
});
Timer.set(1000, false, function () {});
Script.storage.setItem('test', 'value');
HTTPServer.registerEndpoint('test', function (_request, response) { response.send(); });
