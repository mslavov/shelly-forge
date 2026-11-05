import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { buildProject } from '../../src/build/build-project.js';
import { publicEnvSha256, readManifest, verifyArtifact } from '../../src/build/manifest.js';
import { createContext } from '../../src/core/command.js';
import { ProjectConfig } from '../../src/core/config.js';
import { sha256 } from '../../src/core/hash.js';
import { createTempProject } from '../helpers/project.js';
import { project, tsconfig } from './helpers.js';

test('returns undefined for absent manifest and BUILD for absent artifact metadata', async () => {
    const { dir, config } = await project();
    expect(await readManifest(dir)).toBeUndefined();
    await expect(verifyArtifact(dir, config.scripts()[0])).rejects.toMatchObject({ code: 'BUILD', hint: expect.stringContaining('build climate/publish') });
});

test('verifies artifact and entry source hashes, not timestamps', async () => {
    const { dir, ctx, config } = await project();
    const { scripts: [script] } = await buildProject(ctx, config);
    expect(await verifyArtifact(dir, script.entry)).toEqual({ code: script.code, sha256: script.sha256, sizeBytes: script.sizeBytes });
    await writeFile(script.entry.srcPath, 'print("changed");');
    await expect(verifyArtifact(dir, script.entry)).rejects.toMatchObject({ code: 'BUILD', message: expect.stringContaining('changed since the build') });
});

test('rejects modified and missing artifacts', async () => {
    const { dir, ctx, config } = await project();
    const { scripts: [script] } = await buildProject(ctx, config);
    await writeFile(script.artifactPath, `${script.code} `);
    await expect(verifyArtifact(dir, script.entry)).rejects.toMatchObject({ code: 'BUILD', message: expect.stringContaining('differs') });
    await rm(script.artifactPath);
    await expect(verifyArtifact(dir, script.entry)).rejects.toMatchObject({ code: 'BUILD', message: expect.stringContaining('Could not read') });
});

test('reads old schemaVersion 1 manifests without findings', async () => {
    const { dir, ctx, config } = await project();
    await buildProject(ctx, config);
    const manifest = JSON.parse(await readFile(path.join(dir, 'dist/manifest.json'), 'utf8'));
    delete manifest.scripts[0].findings;
    await writeFile(path.join(dir, 'dist/manifest.json'), JSON.stringify(manifest));
    expect((await readManifest(dir))?.scripts[0].findings).toEqual([]);
    await expect(verifyArtifact(dir, config.scripts()[0])).resolves.toMatchObject({ code: expect.any(String) });
});

test('reads legacy manifests but requires rebuilding before verification without input hashes', async () => {
    const { dir, ctx, config } = await project();
    await buildProject(ctx, config);
    const manifest = (await readManifest(dir))!;
    delete manifest.scripts[0].inputs;
    delete manifest.scripts[0].publicEnvSha256;
    await writeFile(path.join(dir, 'dist/manifest.json'), JSON.stringify(manifest));
    expect((await readManifest(dir))?.schemaVersion).toBe(1);
    await expect(verifyArtifact(dir, config.scripts()[0], ctx.env)).rejects.toMatchObject({ code: 'BUILD', message: expect.stringContaining('lacks input or public environment hashes'), hint: expect.stringContaining('build climate/publish') });
});

test('records entry and transitive helper input hashes and rejects a changed helper by name', async () => {
    const helper = 'export { value } from "./nested.js";';
    const nested = 'export const value = 1;';
    const { dir, ctx, config } = await project('import { value } from "./helper.js"; print(value);', {
        'src/helper.ts': helper,
        'src/nested.ts': nested,
    });
    await buildProject(ctx, config);
    expect((await readManifest(dir))!.scripts[0].inputs).toEqual([
        { path: 'src/helper.ts', sha256: sha256(helper) },
        { path: 'src/nested.ts', sha256: sha256(nested) },
        { path: 'src/publish.ts', sha256: sha256(await readFile(path.join(dir, 'src/publish.ts'))) },
    ]);
    await expect(verifyArtifact(dir, config.scripts()[0], ctx.env)).resolves.toMatchObject({ code: expect.any(String) });
    await writeFile(path.join(dir, 'src/nested.ts'), 'export const value = 2;');
    await expect(verifyArtifact(dir, config.scripts()[0], ctx.env)).rejects.toMatchObject({ code: 'BUILD', message: expect.stringContaining('Input src/nested.ts') });
    await rm(path.join(dir, 'src/helper.ts'));
    await expect(verifyArtifact(dir, config.scripts()[0], ctx.env)).rejects.toMatchObject({ code: 'BUILD', message: expect.stringContaining('Could not read input src/helper.ts') });
});

test('builds imports outside the project and detects changes to their input hashes', async () => {
    const helper = 'export const value = 1;';
    const { dir: root } = await createTempProject({
        'project/solutions.config.json': JSON.stringify({ climate: { publish: { src: 'src/publish.ts', device: 'fixture' } } }),
        'project/tsconfig.json': tsconfig,
        'project/src/globals.d.ts': 'declare function print(...values: unknown[]): void;',
        'project/src/publish.ts': 'import { value } from "../../shared/helper.js"; print(value);',
        'shared/helper.ts': helper,
    });
    const dir = path.join(root, 'project');
    const config = await ProjectConfig.load(dir);
    const ctx = createContext({}, { projectDir: dir, env: {} });
    await buildProject(ctx, config);
    expect((await readManifest(dir))!.scripts[0].inputs).toContainEqual({ path: '../shared/helper.ts', sha256: sha256(helper) });
    await expect(verifyArtifact(dir, config.scripts()[0], ctx.env)).resolves.toMatchObject({ code: expect.any(String) });
    await writeFile(path.join(root, 'shared/helper.ts'), 'export const value = 2;');
    await expect(verifyArtifact(dir, config.scripts()[0], ctx.env)).rejects.toMatchObject({
        code: 'BUILD', message: 'Input ../shared/helper.ts for climate/publish has changed since the build',
    });
});

test('checks the public environment hash without storing values or depending on key order', async () => {
    const { dir, ctx, config } = await project('print(process.env.SHELLY_PUBLIC_A, process.env.SHELLY_PUBLIC_B);');
    ctx.env = { SHELLY_PUBLIC_B: 'public-b-value', SHELLY_PUBLIC_A: 'public-a-value', PRIVATE: 'private-value' };
    await buildProject(ctx, config);
    const manifest = await readFile(path.join(dir, 'dist/manifest.json'), 'utf8');
    expect(manifest).not.toContain('public-a-value');
    expect(manifest).not.toContain('public-b-value');
    expect(manifest).not.toContain('private-value');
    expect(JSON.parse(manifest).scripts[0].publicEnvSha256).toBe(publicEnvSha256(ctx.env));
    await expect(verifyArtifact(dir, config.scripts()[0], { SHELLY_PUBLIC_A: 'public-a-value', SHELLY_PUBLIC_B: 'public-b-value', PRIVATE: 'changed' })).resolves.toMatchObject({ code: expect.any(String) });
    for (const env of [
        { ...ctx.env, SHELLY_PUBLIC_A: 'changed' },
        { ...ctx.env, SHELLY_PUBLIC_A: undefined },
        { ...ctx.env, SHELLY_PUBLIC_C: 'added' },
    ]) {
        await expect(verifyArtifact(dir, config.scripts()[0], env)).rejects.toMatchObject({ code: 'BUILD', message: expect.stringContaining('Public environment values'), hint: expect.stringContaining('build climate/publish') });
    }
});

test('public environment hash distinguishes embedded newlines from separate pairs', () => {
    expect(publicEnvSha256({ SHELLY_PUBLIC_A: 'a\nSHELLY_PUBLIC_B=b' }))
        .not.toBe(publicEnvSha256({ SHELLY_PUBLIC_A: 'a', SHELLY_PUBLIC_B: 'b' }));
});

test('a full rebuild replaces an invalid manifest', async () => {
    const { dir, ctx, config } = await project();
    await buildProject(ctx, config);
    await writeFile(path.join(dir, 'dist/manifest.json'), 'invalid');
    await buildProject(ctx, config);
    await expect(verifyArtifact(dir, config.scripts()[0], ctx.env)).resolves.toMatchObject({ code: expect.any(String) });
});

test.each(['/tmp/outside.ts', 'C:/outside.ts', 'src\\outside.ts', 'src/\0outside.ts'])('rejects untrusted manifest input path %s', async inputPath => {
    const { dir, ctx, config } = await project();
    await buildProject(ctx, config);
    const manifest = (await readManifest(dir))!;
    manifest.scripts[0].inputs![0].path = inputPath;
    await writeFile(path.join(dir, 'dist/manifest.json'), JSON.stringify(manifest));
    await expect(verifyArtifact(dir, config.scripts()[0], ctx.env)).rejects.toMatchObject({ code: 'BUILD', message: 'Invalid dist/manifest.json' });
});

test.each(['../outside.ts', '/tmp/outside.ts', 'C:/outside.ts', 'src\\outside.ts', 'src/\0outside.ts'])('keeps manifest source paths inside the project: %s', async sourcePath => {
    const { dir, ctx, config } = await project();
    await buildProject(ctx, config);
    const manifest = (await readManifest(dir))!;
    manifest.scripts[0].sourcePath = sourcePath;
    await writeFile(path.join(dir, 'dist/manifest.json'), JSON.stringify(manifest));
    await expect(readManifest(dir)).rejects.toMatchObject({ code: 'BUILD', message: 'Invalid dist/manifest.json' });
});

test.each(['broken JSON', '{"schemaVersion":2}', '{"schemaVersion":1}'])('rejects invalid manifest %s', async content => {
    const { dir, ctx, config } = await project();
    await buildProject(ctx, config);
    await writeFile(path.join(dir, 'dist/manifest.json'), content);
    await expect(readManifest(dir)).rejects.toMatchObject({ code: 'BUILD', message: 'Invalid dist/manifest.json' });
});

test.each(['../outside.js', '/tmp/outside.js', 'C:/outside.js', 'dist\\outside.js', 'dist/\0outside.js', 'dist/other.js'])('rejects untrusted manifest artifact path %s', async artifactPath => {
    const { dir, ctx, config } = await project();
    await buildProject(ctx, config);
    const manifest = await readManifest(dir);
    manifest!.scripts[0].artifactPath = artifactPath;
    await writeFile(path.join(dir, 'dist/manifest.json'), JSON.stringify(manifest));
    await expect(verifyArtifact(dir, config.scripts()[0])).rejects.toMatchObject({ code: 'BUILD' });
});

test('rejects stale source paths and duplicate manifest ids', async () => {
    const { dir, ctx, config } = await project();
    await buildProject(ctx, config);
    const manifest = (await readManifest(dir))!;
    manifest.scripts[0].sourcePath = 'src/other.ts';
    await writeFile(path.join(dir, 'dist/manifest.json'), JSON.stringify(manifest));
    await expect(verifyArtifact(dir, config.scripts()[0])).rejects.toMatchObject({ code: 'BUILD', message: expect.stringContaining('paths do not match') });
    manifest.scripts.push(manifest.scripts[0]);
    await writeFile(path.join(dir, 'dist/manifest.json'), JSON.stringify(manifest));
    await expect(readManifest(dir)).rejects.toMatchObject({ code: 'BUILD', message: 'Invalid dist/manifest.json' });
});
