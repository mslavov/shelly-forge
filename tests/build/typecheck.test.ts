import { expect, test } from 'vitest';
import { typecheckProject } from '../../src/build/typecheck.js';
import { createTempProject } from '../helpers/project.js';
import { project, tsconfig } from './helpers.js';

test('reports missing tsconfig as a warning', async () => {
    const { dir } = await createTempProject();
    expect(typecheckProject(dir)).toEqual([expect.objectContaining({ rule: 'missing-tsconfig', severity: 'warning', file: 'tsconfig.json' })]);
});

test('returns no findings for valid TypeScript', async () => {
    const { dir } = await project('const value: number = 1; print(value);');
    expect(typecheckProject(dir)).toEqual([]);
});

test('reports compiler errors with project-relative file, line and column', async () => {
    const { dir } = await project('\nconst value: number = "wrong"; print(value);');
    expect(typecheckProject(dir)).toEqual([expect.objectContaining({ rule: 'typescript', severity: 'error', file: 'src/publish.ts', line: 2, column: 7, message: expect.stringContaining('TS2322') })]);
});

test('loads tsconfig extends and include rules', async () => {
    const { dir } = await createTempProject({
        'base.json': tsconfig,
        'tsconfig.json': JSON.stringify({ extends: './base.json', exclude: ['src/excluded.ts'] }),
        'src/good.ts': 'const value: number = 1;',
        'src/excluded.ts': 'const broken: number = "wrong";',
    });
    expect(typecheckProject(dir)).toEqual([]);
});

test.each(['{"compilerOptions": {"target": "wrong"}}', '{"compilerOptions":', '{"include": ["absent/**/*.ts"]}'])('reports invalid compiler configuration %s', async content => {
    const { dir } = await project('', { 'tsconfig.json': content });
    expect(typecheckProject(dir)).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'typescript', severity: 'error' })]));
});

test('preserves diagnostics without a source file', async () => {
    const { dir } = await project('', { 'tsconfig.json': '{"compilerOptions": {"target": "wrong"}}' });
    expect(typecheckProject(dir).find(finding => finding.message.includes('TS6046'))).not.toHaveProperty('file');
});
