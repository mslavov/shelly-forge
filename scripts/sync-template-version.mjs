import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const templatePath = 'templates/default/package.json';
const template = JSON.parse(readFileSync(templatePath, 'utf8'));
template.devDependencies['shelly-forge'] = `^${version}`;
writeFileSync(templatePath, `${JSON.stringify(template, null, 2)}\n`);
