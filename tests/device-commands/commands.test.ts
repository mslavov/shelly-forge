import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { statusProject } from '../../src/commands/status.js';
import { rpcCommand } from '../../src/commands/rpc.js';
import { evalCommand } from '../../src/commands/eval.js';
import { debugCommand } from '../../src/commands/debug.js';
import { runCli } from '../helpers/project.js';
import { fixture } from '../deploy/helpers.js';

describe('status', () => {
    it('includes runtime metrics, target name and boot state', async () => {
        const f = await fixture({ scripts: [{ name: 'controller', running: true, enable: true, mem_used: 25, mem_peak: 50, mem_free: 1024, cpu: 5 }] });
        const result = await statusProject(f.ctx);
        expect(result.exitCode).toBe(0);
        expect(result.data?.scripts[0]).toMatchObject({ script: 'home/main', targetScriptName: 'controller', running: true, enable: true, mem_used: 25, mem_peak: 50, mem_free: 1024, cpu: 5 });
        expect(result.summary).toContain('25/50/1024');
    });

    it('a stopped script without errors is not unhealthy', async () => {
        const f = await fixture({ scripts: [{ name: 'controller', running: false }] });
        expect((await statusProject(f.ctx)).exitCode).toBe(0);
    });

    it('missing scripts return a table and exit 5', async () => {
        const f = await fixture();
        const result = await runCli(['status'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(5);
        expect(result.stdout).toContain('missing');
        expect(result.stdout).toContain('home/main');
    });

    it.each([{ errors: ['crashed'] }, { error_msg: 'stack overflow' }])('errors return exit 5 with the full status: %j', async error => {
        const f = await fixture({ scripts: [{ name: 'controller', ...error }] });
        const result = await runCli(['--json', 'status', 'home/main'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(5);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, exitCode: 5, command: 'status', data: { scripts: [error] } });
    });

    it('unreachable devices appear per script and take priority over unhealthy scripts', async () => {
        const f = await fixture();
        await writeFile(path.join(f.project.dir, 'solutions.config.json'), JSON.stringify({ home: {
            missing: { src: 'src/main.ts', device: f.device.host },
            unreachable: { src: 'src/main.ts', device: '127.0.0.1:1' },
        } }));
        const result = await statusProject(f.ctx);
        expect(result.exitCode).toBe(4);
        expect(result.data?.scripts).toHaveLength(2);
        expect(result.data?.scripts[0].missing).toBe(true);
        expect(result.data?.scripts[1].error?.code).toBe('DEVICE_UNREACHABLE');
    });

    it('reports an authentication error per script without leaking the password', async () => {
        const f = await fixture({ password: 'correct-password' });
        f.ctx.env.SHELLY_PASSWORD = 'wrong-password';
        const result = await statusProject(f.ctx);
        expect(result.exitCode).toBe(4);
        expect(result.data?.scripts[0].error?.code).toBe('DEVICE_AUTH');
        expect(JSON.stringify(result)).not.toContain('wrong-password');
    });
});

describe('rpc', () => {
    it('supports --device without a project config, JSON parameters and pretty output', async () => {
        const f = await fixture();
        const result = await runCli(['rpc', 'Script.List', '{}', '--device', f.device.host], { cwd: path.dirname(f.project.dir) });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe('{\n  "scripts": []\n}\n');
    });

    it('automatically selects the single configured device', async () => {
        const f = await fixture();
        const result = await runCli(['--json', 'rpc', 'Shelly.GetDeviceInfo'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, exitCode: 0, command: 'rpc', data: { gen: 2 } });
    });

    it('uses --script selection with multiple devices', async () => {
        const f = await fixture();
        await writeFile(path.join(f.project.dir, 'solutions.config.json'), JSON.stringify({ home: {
            main: { src: 'src/main.ts', device: f.device.host }, other: { src: 'src/main.ts', device: '127.0.0.1:1' },
        } }));
        await expect(rpcCommand(f.ctx, 'Script.List')).rejects.toMatchObject({ code: 'CONFIG' });
        expect((await rpcCommand(f.ctx, 'Script.List', undefined, { script: 'main' })).data).toEqual({ scripts: [] });
    });

    it.each(['{', '[]', 'null', '1', '"text"'])('rejects invalid parameters before requests: %s', async params => {
        const f = await fixture();
        await expect(rpcCommand(f.ctx, 'Script.List', params)).rejects.toMatchObject({ code: 'USAGE' });
        expect(f.device.requests).toEqual([]);
    });

    it('rejects mutually exclusive targets', async () => {
        const f = await fixture();
        await expect(rpcCommand(f.ctx, 'Script.List', '{}', { script: 'main', device: f.device.host })).rejects.toMatchObject({ code: 'USAGE' });
        expect(f.device.requests).toEqual([]);
    });

    it('sends parsed object parameters to the device', async () => {
        const f = await fixture({ scripts: [{ name: 'controller', running: true }] });
        expect((await rpcCommand(f.ctx, 'Script.Eval', '{"id":1,"code":"2+3"}')).data).toEqual({ result: '5' });
        expect(f.device.requests[0].params).toEqual({ id: 1, code: '2+3' });
    });

    it('prints a JSON error envelope for device RPC errors', async () => {
        const f = await fixture();
        const result = await runCli(['--json', 'rpc', 'Missing.Method'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(4);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, exitCode: 4, command: 'rpc', error: { code: 'DEVICE_RPC', details: { method: 'Missing.Method', code: 404 } } });
    });

    it('uses SHELLY_PASSWORD with an explicit device target', async () => {
        const f = await fixture({ password: 'rpc-password' });
        const result = await runCli(['--json', 'rpc', 'Script.List', '--device', f.device.host], { cwd: path.dirname(f.project.dir), env: { SHELLY_PASSWORD: 'rpc-password' } });
        expect(result.exitCode).toBe(0);
        expect(result.stdout + result.stderr).not.toContain('rpc-password');
    });
});

describe('eval', () => {
    it('finds the target name and returns Script.Eval output', async () => {
        const f = await fixture({ scripts: [{ id: 7, name: 'controller', running: true }] });
        const result = await runCli(['--json', 'eval', 'home/main', '21 * 2'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, exitCode: 0, command: 'eval', data: { result: '42' } });
        expect(f.device.requests[1].params).toEqual({ id: 7, code: '21 * 2' });
    });

    it('fails with UNHEALTHY when the target script is missing', async () => {
        const f = await fixture();
        await expect(evalCommand(f.ctx, 'main', '1')).rejects.toMatchObject({ code: 'UNHEALTHY', hint: expect.stringContaining('deploy home/main') });
    });

    it('propagates a stopped script or invalid expression error', async () => {
        const f = await fixture({ scripts: [{ name: 'controller', running: false }] });
        await expect(evalCommand(f.ctx, 'main', '1')).rejects.toMatchObject({ code: 'DEVICE_RPC' });
        f.device.scripts.get(1)!.running = true;
        await expect(evalCommand(f.ctx, 'main', 'invalid(')).rejects.toMatchObject({ code: 'DEVICE_RPC' });
    });
});

describe('debug', () => {
    it('deduplicates devices and reports changed/unchanged plus restartRequired', async () => {
        const f = await fixture({ restartRequired: true });
        await writeFile(path.join(f.project.dir, 'solutions.config.json'), JSON.stringify({ home: {
            main: { src: 'src/main.ts', device: f.device.host }, backup: { src: 'src/main.ts', device: f.device.host },
        } }));
        expect((await debugCommand(f.ctx, 'on')).data?.devices).toEqual([{ host: f.device.host, enabled: true, changed: true, restartRequired: true }]);
        expect((await debugCommand(f.ctx, 'on')).data?.devices[0]).toMatchObject({ changed: false, restartRequired: false });
        expect(f.device.requests.map(r => r.method)).toEqual(['Sys.GetConfig', 'Sys.SetConfig', 'Sys.GetConfig']);
    });

    it('supports on/off through the CLI and JSON envelopes', async () => {
        const f = await fixture();
        for (const mode of ['on', 'off']) {
            const result = await runCli(['--json', 'debug', mode, 'home/main'], { cwd: f.project.dir });
            expect(result.exitCode).toBe(0);
            expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, exitCode: 0, command: 'debug', data: { devices: [{ changed: true, enabled: mode === 'on' }] } });
        }
    });

    it('rejects invalid modes before requests', async () => {
        const f = await fixture();
        await expect(debugCommand(f.ctx, 'yes')).rejects.toMatchObject({ code: 'USAGE' });
        expect(f.device.requests).toEqual([]);
    });

    it('propagates device errors', async () => {
        const f = await fixture({ failures: { 'Sys.SetConfig': { type: 'rpc', code: 500, message: 'failed' } } });
        const result = await runCli(['--json', 'debug', 'on'], { cwd: f.project.dir });
        expect(result.exitCode).toBe(4);
        expect(JSON.parse(result.stdout).error.code).toBe('DEVICE_RPC');
    });
});
