import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const published = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const versions = typeof published === 'string' ? [published] : published;
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

assert.match(version, stableVersion, 'Automatic publishing requires a stable version');
assert.ok(Array.isArray(versions) && versions.every((item) => typeof item === 'string'),
    'Expected npm to return a list of published versions');

const alreadyPublished = versions.includes(version);
if (!alreadyPublished) {
    const candidate = version.split('.').map(BigInt);
    for (const previous of versions.filter((item) => stableVersion.test(item))) {
        const parts = previous.split('.').map(BigInt);
        const difference = candidate.findIndex((part, index) => part !== parts[index]);
        assert.ok(difference >= 0 && candidate[difference] > parts[difference],
            `Version ${version} must be newer than published version ${previous}`);
    }
}

process.stdout.write(`version=${version}\npublish=${!alreadyPublished}\n`);
