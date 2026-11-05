import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProject } from '../../src/build/build-project.js';
import { deployProject } from '../../src/commands/deploy.js';
import { runCli } from '../helpers/project.js';
import { fixture } from './helpers.js';

describe('deploy CLI', () => {
    it('builds by default, deploys, and returns the JSON result', async () => {
        const f = await fixture();
        const result = await runCli(['--json', 'deploy', 'home/main', '--verify-timeout', '100'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, exitCode: 0, command: 'deploy', data: { scripts: [{ id: 'home/main', action: 'created', status: 'running' }] } });
        expect(await readFile(path.join(f.project.dir, 'dist', 'home-main.js'), 'utf8')).toBe(f.device.scripts.get(1)?.code);
    });

    it('supports verified no-build artifacts and force/cache skip', async () => {
        const f = await fixture();
        await buildProject(f.ctx, f.config);
        const args = ['--json', 'deploy', '--no-build', '--verify-timeout', '100'];
        expect((await runCli(args, { cwd: f.project.dir })).exitCode).toBe(0);
        expect(JSON.parse((await runCli(args, { cwd: f.project.dir })).stdout).data.scripts[0].action).toBe('skipped');
        expect(JSON.parse((await runCli([...args, '--force'], { cwd: f.project.dir })).stdout).data.scripts[0].action).toBe('updated');
    });

    it('missing --no-build artifact fails with BUILD and makes no requests', async () => {
        const f = await fixture();
        const result = await runCli(['--json', 'deploy', '--no-build'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(3);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, exitCode: 3, error: { code: 'BUILD' } });
        expect(f.device.requests).toEqual([]);
    });

    it.each(['source', 'artifact'])('rejects stale %s before making requests', async changed => {
        const f = await fixture();
        await buildProject(f.ctx, f.config);
        await writeFile(path.join(f.project.dir, changed === 'source' ? 'src/main.ts' : 'dist/home-main.js'), 'var changed = 1;');
        const result = await runCli(['--json', 'deploy', '--no-build'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(3);
        expect(JSON.parse(result.stdout).error.code).toBe('BUILD');
        expect(f.device.requests).toEqual([]);
    });

    it('rejects a changed imported helper before making no-build deployment requests', async () => {
        const f = await fixture();
        await writeFile(path.join(f.project.dir, 'src/main.ts'), 'import { message } from "./helper"; declare function print(value: string): void; print(message);');
        await writeFile(path.join(f.project.dir, 'src/helper.ts'), 'export const message = "original";');
        await buildProject(f.ctx, f.config);
        await writeFile(path.join(f.project.dir, 'src/helper.ts'), 'export const message = "changed";');
        const result = await runCli(['--json', 'deploy', '--no-build'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(3);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, exitCode: 3, error: {
            code: 'BUILD', message: 'Input src/helper.ts for home/main has changed since the build',
        } });
        expect(f.device.requests).toEqual([]);
    });

    it('uses the command context environment to verify no-build artifacts', async () => {
        const f = await fixture();
        f.ctx.env.SHELLY_PUBLIC_LABEL = 'original';
        await buildProject(f.ctx, f.config);
        await expect(deployProject(f.ctx, undefined, { build: false, dryRun: true })).resolves.toMatchObject({
            data: { scripts: [{ action: 'created', status: 'planned' }] },
        });
        f.device.requests.length = 0;
        f.ctx.env.SHELLY_PUBLIC_LABEL = 'changed';
        await expect(deployProject(f.ctx, undefined, { build: false })).rejects.toMatchObject({
            code: 'BUILD', message: 'Public environment values for home/main have changed since the build',
        });
        expect(f.device.requests).toEqual([]);
    });

    it('validates selectors and duplicate targets before build or device requests', async () => {
        const f = await fixture();
        const raw = { src: 'missing.ts', device: f.device.host };
        await writeFile(path.join(f.project.dir, 'solutions.config.json'), JSON.stringify({
            first: { main: { ...raw, targetScriptName: 'one' } }, second: { main: { ...raw, targetScriptName: 'two' } },
        }));
        for (const selector of ['missing', 'main']) {
            const result = await runCli(['--json', 'deploy', selector], { cwd: f.project.dir });
            expect(result.exitCode).toBe(2);
            expect(JSON.parse(result.stdout).error.code).toBe('CONFIG');
        }
        await writeFile(path.join(f.project.dir, 'solutions.config.json'), JSON.stringify({ first: { main: raw }, second: { main: raw } }));
        expect((await runCli(['deploy', 'first/main'], { cwd: f.project.dir })).exitCode).toBe(2);
        expect(f.device.requests).toEqual([]);
    });

    it('deploys a selected entry when another entry has unset device variables', async () => {
        const f = await fixture();
        await writeFile(path.join(f.project.dir, 'solutions.config.json'), JSON.stringify({ home: {
            main: { src: 'src/main.ts', device: f.device.host, targetScriptName: 'controller' },
            other: { src: 'src/main.ts', device: '${UNSET_OTHER_DEVICE}' },
        } }));
        const result = await runCli(['--json', 'deploy', 'home/main', '--verify-timeout', '100'], {
            cwd: f.project.dir, env: { UNSET_OTHER_DEVICE: '' },
        });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout).data.scripts).toMatchObject([{ id: 'home/main', status: 'running' }]);
        expect(f.device.scripts.size).toBe(1);
    });

    it('reports unset selected device variables before building', async () => {
        const f = await fixture();
        await writeFile(path.join(f.project.dir, 'solutions.config.json'), JSON.stringify({ home: {
            main: { src: 'missing.ts', device: '${UNSET_SELECTED_DEVICE}' },
        } }));
        const result = await runCli(['--json', 'deploy', 'home/main'], {
            cwd: f.project.dir, env: { UNSET_SELECTED_DEVICE: '' },
        });
        expect(result.exitCode).toBe(2);
        expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: 'CONFIG', message: 'Environment variable UNSET_SELECTED_DEVICE is not set' } });
        expect(f.device.requests).toEqual([]);
    });

    it('dry-run only lists scripts and reports the proposed action', async () => {
        const f = await fixture();
        const result = await runCli(['--json', 'deploy', '--dry-run'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ data: { dryRun: true, scripts: [{ action: 'created', status: 'planned' }] } });
        expect(f.device.requests.map(r => r.method)).toEqual(['Script.List']);
    });

    it('a crash after start exits 5 and returns failure status in the envelope', async () => {
        const f = await fixture({ failures: { 'Script.Start': { type: 'crash', error_msg: 'crashed immediately' } } });
        const result = await runCli(['--json', 'deploy', '--verify-timeout', '100'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(5);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, exitCode: 5, error: { code: 'UNHEALTHY', message: expect.stringContaining('crashed immediately'), details: { scripts: [{ action: 'failed', status: 'failed' }] } } });
    });

    it('an upload failure exits 4 and explains the partial upload', async () => {
        const f = await fixture({ failures: { 'Script.PutCode': { type: 'rpc', code: 500, message: 'upload failed', times: Infinity } } });
        const result = await runCli(['deploy'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(4);
        expect(result.stderr).toContain('stopped and may be partially written');
    });

    it('honors --no-verify and --no-rollback', async () => {
        const f = await fixture({ failures: { 'Script.Start': { type: 'crash' } } });
        const result = await runCli(['--json', 'deploy', '--no-verify', '--no-rollback'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout).data.scripts[0].status).toBe('unverified');
        expect(f.device.requests.some(r => r.method === 'Script.GetStatus')).toBe(false);
    });

    it.each(['invalid', '0', '-1', '1.5', '4294967296'])('rejects verify timeout %s before building or making requests', async timeout => {
        const f = await fixture();
        await writeFile(path.join(f.project.dir, 'src/main.ts'), 'const value: string = 42;');
        const result = await runCli(['--json', 'deploy', '--verify-timeout', timeout], { cwd: f.project.dir });
        expect(result.exitCode).toBe(2);
        expect(JSON.parse(result.stdout).error.code).toBe('USAGE');
        await expect(readFile(path.join(f.project.dir, 'dist/manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(f.device.requests).toEqual([]);
    });

    it('uses SHELLY_PASSWORD for a digest-protected device without printing it', async () => {
        const f = await fixture({ password: 'test-secret' });
        const result = await runCli(['--json', 'deploy', '--verify-timeout', '100'], { cwd: f.project.dir, env: { SHELLY_PASSWORD: 'test-secret' } });
        expect(result.exitCode).toBe(0);
        expect(result.stdout + result.stderr).not.toContain('test-secret');
    });
});
