import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { solutionsConfigSchema } from '../../src/core/config.js';
import { SCHEMA_PATH } from './package-paths.js';

test('the committed JSON schema matches the zod config schema', async () => {
    expect(await readFile(SCHEMA_PATH, 'utf8')).toBe(`${JSON.stringify(z.toJSONSchema(solutionsConfigSchema), null, 2)}\n`);
});
