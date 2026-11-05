import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectConfig, validateSelectedTargets } from '../../src/core/config.js';
import { SCRIPT_MAX_BYTES } from '../../src/core/runtime-profile.js';
import { DeviceScripts } from '../../src/device/scripts.js';
import { readDeployCache, readLastGood, recordDeployment } from '../../src/deploy/deploy-cache.js';
import { deployScripts } from '../../src/deploy/deployer.js';
import { fixture, verificationClock } from './helpers.js';

function verificationOptions() {
    return { verifyTimeoutMs: 100, ...verificationClock() };
}

afterEach(() => vi.restoreAllMocks());

describe('deployScripts', () => {
    it('creates by target name, uploads UTF-8 chunks, starts, verifies, and records last-good code', async () => {
        const f = await fixture();
        const script = f.built(`print("${'é'.repeat(1025)}");`);
        const result = await deployScripts(f.ctx, f.config, [script], verificationOptions());
        expect(result.scripts[0]).toMatchObject({ id: 'home/main', targetScriptName: 'controller', action: 'created', status: 'running', sizeBytes: script.sizeBytes });
        expect(f.device.scripts.get(1)).toMatchObject({ name: 'controller', code: script.code, enable: true, running: true });
        expect(f.device.requests.filter(r => r.method !== 'Script.GetCode').map(r => r.method)).toEqual(['Script.List', 'Script.Create', 'Script.Stop', 'Script.PutCode', 'Script.PutCode', 'Script.SetConfig', 'Script.Start', 'Script.GetStatus']);
        expect(f.device.requests.filter(r => r.method === 'Script.PutCode').map(r => r.params.append)).toEqual([false, true]);
        expect(await readLastGood(f.project.dir, f.device.host, 'controller')).toBe(script.code);
        expect(f.logger.info.mock.calls.map(call => call[0])).toEqual([`home/main: uploading ${script.sizeBytes} bytes`, 'home/main: verifying', 'home/main: done']);
    });

    it('updates an existing script without touching unselected scripts and applies boot config', async () => {
        const f = await fixture({ scripts: [{ id: 7, name: 'controller', running: true, code: 'old' }, { id: 9, name: 'backup', running: true, code: 'untouched' }] }, { enableOnBoot: false });
        const result = await deployScripts(f.ctx, f.config, [f.built()], verificationOptions());
        expect(result.scripts[0]).toMatchObject({ action: 'updated', scriptId: 7 });
        expect(f.device.scripts.get(7)).toMatchObject({ code: f.built().code, enable: false, running: true });
        expect(f.device.scripts.get(9)).toMatchObject({ code: 'untouched', running: true });
        expect(f.device.requests.some(r => r.method === 'Script.Create')).toBe(false);
    });

    it('skips a cached artifact only while the device still has that script', async () => {
        const f = await fixture();
        await deployScripts(f.ctx, f.config, [f.built()], verificationOptions());
        f.device.requests.length = 0;
        expect((await deployScripts(f.ctx, f.config, [f.built()])).scripts[0].action).toBe('skipped');
        expect(f.device.requests.map(r => r.method)).toEqual(['Script.List']);
        f.device.scripts.clear();
        expect((await deployScripts(f.ctx, f.config, [f.built()], verificationOptions())).scripts[0].action).toBe('created');
    });

    it('does not skip a replacement device script with a different id', async () => {
        const f = await fixture({ scripts: [{ id: 2, name: 'controller', code: 'unknown' }] });
        await recordDeployment(f.project.dir, f.device.host, 'controller', 1, f.built().code);
        expect((await deployScripts(f.ctx, f.config, [f.built()], verificationOptions())).scripts[0].action).toBe('updated');
    });

    it('uploads and starts a cached script that is no longer running', async () => {
        const f = await fixture({ scripts: [{ id: 1, name: 'controller', enable: true, running: false }] });
        await recordDeployment(f.project.dir, f.device.host, 'controller', 1, f.built().code);
        expect((await deployScripts(f.ctx, f.config, [f.built()], verificationOptions())).scripts[0].action).toBe('updated');
        expect(f.device.requests.some(request => request.method === 'Script.PutCode')).toBe(true);
        expect(f.device.scripts.get(1)?.running).toBe(true);
    });

    it('force uploads an unchanged artifact', async () => {
        const f = await fixture();
        await deployScripts(f.ctx, f.config, [f.built()], verificationOptions());
        f.device.requests.length = 0;
        expect((await deployScripts(f.ctx, f.config, [f.built()], { ...verificationOptions(), force: true })).scripts[0].action).toBe('updated');
        expect(f.device.requests.some(r => r.method === 'Script.PutCode')).toBe(true);
    });

    it('applies boot-setting changes even when the artifact hash is unchanged', async () => {
        const f = await fixture();
        await deployScripts(f.ctx, f.config, [f.built()], verificationOptions());
        const script = f.built();
        script.entry.enableOnBoot = false;
        const result = await deployScripts(f.ctx, f.config, [script], verificationOptions());
        expect(result.scripts[0].action).toBe('updated');
        expect(f.device.scripts.get(1)?.enable).toBe(false);
    });

    it('rejects duplicate targets before any requests, even for a selected script', async () => {
        const f = await fixture();
        await writeFile(path.join(f.project.dir, 'solutions.config.json'), JSON.stringify({ home: {
            first: { src: 'src/main.ts', device: f.device.host, targetScriptName: 'same' },
            second: { src: 'src/main.ts', device: f.device.host, targetScriptName: 'same' },
        } }));
        const config = await ProjectConfig.load(f.project.dir);
        await expect(deployScripts(f.ctx, config, [{ ...f.built(), entry: config.scripts()[0] }])).rejects.toMatchObject({ code: 'CONFIG' });
        expect(f.device.requests).toEqual([]);
    });

    it('ignores unresolved unselected devices and passwords', async () => {
        const f = await fixture();
        await writeFile(path.join(f.project.dir, 'solutions.config.json'), JSON.stringify({ home: {
            main: { src: 'src/main.ts', device: f.device.host, targetScriptName: 'controller' },
            missingHost: { src: 'src/main.ts', device: '${UNSET_HOST}', targetScriptName: 'controller' },
            missingPassword: { src: 'src/main.ts', device: f.device.host, password: '${UNSET_PASSWORD}', targetScriptName: 'controller' },
        } }));
        const config = await ProjectConfig.load(f.project.dir);
        const script = { ...f.built(), entry: config.select('home/main')[0] };
        expect((await deployScripts(f.ctx, config, [script], verificationOptions())).scripts[0].status).toBe('running');
        for (const selector of ['home/missingHost', 'home/missingPassword']) {
            expect(() => validateSelectedTargets(config, config.select(selector), f.ctx.env)).toThrow('is not set');
        }
    });

    it('ignores collisions between unselected targets', async () => {
        const f = await fixture();
        await writeFile(path.join(f.project.dir, 'solutions.config.json'), JSON.stringify({ home: {
            main: { src: 'src/main.ts', device: f.device.host, targetScriptName: 'controller' },
            first: { src: 'src/main.ts', device: f.device.host, targetScriptName: 'other' },
            second: { src: 'src/main.ts', device: f.device.host, targetScriptName: 'other' },
        } }));
        const config = await ProjectConfig.load(f.project.dir);
        expect((await deployScripts(f.ctx, config, [{ ...f.built(), entry: config.select('home/main')[0] }], verificationOptions())).scripts[0].status).toBe('running');
    });

    it.each(['', 'x'.repeat(SCRIPT_MAX_BYTES + 1), 'é'.repeat(32768)])('rejects invalid artifact size before any requests: case %#', async code => {
        const f = await fixture();
        await expect(deployScripts(f.ctx, f.config, [f.built(code)])).rejects.toMatchObject({ code: 'BUILD' });
        expect(f.device.requests).toEqual([]);
    });

    it('checks every artifact before making any requests', async () => {
        const f = await fixture();
        await expect(deployScripts(f.ctx, f.config, [f.built(), { ...f.built(), sha256: 'wrong' }])).rejects.toMatchObject({ code: 'BUILD' });
        expect(f.device.requests).toEqual([]);
    });

    it('dry-run lists create/update/skip plans without mutating the device or cache', async () => {
        const f = await fixture();
        expect((await deployScripts(f.ctx, f.config, [f.built()], { dryRun: true })).scripts[0]).toMatchObject({ action: 'created', status: 'planned' });
        expect(await readDeployCache(f.project.dir)).toEqual({});
        f.device.scripts.set(1, { id: 1, name: 'controller', code: 'old', running: false, enable: true });
        expect((await deployScripts(f.ctx, f.config, [f.built()], { dryRun: true })).scripts[0].action).toBe('updated');
        await recordDeployment(f.project.dir, f.device.host, 'controller', 1, f.built().code);
        expect((await deployScripts(f.ctx, f.config, [f.built()], { dryRun: true })).scripts[0].action).toBe('updated');
        f.device.scripts.get(1)!.running = true;
        expect((await deployScripts(f.ctx, f.config, [f.built()], { dryRun: true })).scripts[0].action).toBe('skipped');
        expect(f.device.requests.map(r => r.method)).toEqual(['Script.List', 'Script.List', 'Script.List', 'Script.List']);
    });

    it('restores the previous verified artifact after a crash and still fails with UNHEALTHY', async () => {
        const f = await fixture();
        await deployScripts(f.ctx, f.config, [f.built('old();')], verificationOptions());
        f.device.setFailure('Script.Start', { type: 'crash', errors: ['syntax_error'], error_msg: 'Unexpected token' });
        await expect(deployScripts(f.ctx, f.config, [f.built('newCode();')], verificationOptions())).rejects.toMatchObject({
            code: 'UNHEALTHY', exitCode: 5, message: expect.stringMatching(/syntax_error.*Unexpected token.*previous version was restored/),
            details: { failure: { restored: true, failure: { errors: ['syntax_error'], error_msg: 'Unexpected token' } } },
        });
        expect(f.device.scripts.get(1)).toMatchObject({ code: 'old();', running: true });
        expect(Object.values(await readDeployCache(f.project.dir))[0].sha256).toBe(f.built('old();').sha256);
    });

    it('reports rollback failure and does not cache the crashed artifact', async () => {
        const f = await fixture();
        await deployScripts(f.ctx, f.config, [f.built('old();')], verificationOptions());
        f.device.setFailure('Script.Start', { type: 'crash', times: Infinity });
        await expect(deployScripts(f.ctx, f.config, [f.built('newCode();')], verificationOptions())).rejects.toMatchObject({ code: 'UNHEALTHY', message: expect.stringContaining('Rollback failed') });
        expect(await readDeployCache(f.project.dir)).toEqual({});
        expect(await readLastGood(f.project.dir, f.device.host, 'controller')).toBe('old();');
    });

    it('restores the previous artifact when Script.Start rejects the new code', async () => {
        const f = await fixture();
        await deployScripts(f.ctx, f.config, [f.built('old();')], verificationOptions());
        f.device.setFailure('Script.Start', { type: 'rpc', code: -1, message: 'Syntax error' });
        await expect(deployScripts(f.ctx, f.config, [f.built('broken();')], verificationOptions())).rejects.toMatchObject({ code: 'UNHEALTHY', message: expect.stringContaining('previous version was restored') });
        expect(f.device.scripts.get(1)).toMatchObject({ code: 'old();', running: true });
    });

    it('honors no-rollback after a crash', async () => {
        const f = await fixture();
        await deployScripts(f.ctx, f.config, [f.built('old();')], verificationOptions());
        f.device.requests.length = 0;
        f.device.setFailure('Script.Start', { type: 'crash' });
        await expect(deployScripts(f.ctx, f.config, [f.built('newCode();')], { ...verificationOptions(), rollback: false })).rejects.toMatchObject({ code: 'UNHEALTHY' });
        expect(f.device.requests.filter(r => r.method === 'Script.PutCode')).toHaveLength(1);
        expect(await readDeployCache(f.project.dir)).toEqual({});
    });

    it('fails without rollback when no last-good copy exists', async () => {
        const f = await fixture({ failures: { 'Script.Start': { type: 'crash' } } });
        await expect(deployScripts(f.ctx, f.config, [f.built()], verificationOptions())).rejects.toMatchObject({ code: 'UNHEALTHY' });
        expect(await readLastGood(f.project.dir, f.device.host, 'controller')).toBeUndefined();
    });

    it('fails immediately when a poll reports that the script is not running', async () => {
        const f = await fixture();
        const clock = verificationClock();
        const status = vi.spyOn(DeviceScripts.prototype, 'getStatus').mockResolvedValue({ id: 1, running: false });
        await expect(deployScripts(f.ctx, f.config, [f.built()], { ...clock, verifyTimeoutMs: 1050 })).rejects.toMatchObject({
            code: 'UNHEALTHY', message: expect.stringContaining('not running'), details: { failure: { failure: { running: false } } },
        });
        expect(status).toHaveBeenCalledTimes(1);
        expect(clock.sleep).not.toHaveBeenCalled();
    });

    it.each([
        { timeout: 1, polls: [0], waits: [1] },
        { timeout: 1050, polls: [0, 500, 1000], waits: [500, 500, 50] },
        { timeout: undefined, polls: [0, 500, 1000, 1500, 2000, 2500], waits: [500, 500, 500, 500, 500, 500] },
    ])('observes the whole verification window with timeout $timeout', async ({ timeout, polls, waits }) => {
        const f = await fixture();
        const clock = verificationClock();
        const observed: number[] = [];
        vi.spyOn(DeviceScripts.prototype, 'getStatus').mockImplementation(async id => {
            expect(f.device.requests.some(request => request.method === 'Script.Start')).toBe(true);
            observed.push(clock.now());
            return { id, running: true };
        });
        await deployScripts(f.ctx, f.config, [f.built()], { ...clock, verifyTimeoutMs: timeout });
        expect(observed).toEqual(polls);
        expect(clock.sleep.mock.calls.map(([ms]) => ms)).toEqual(waits);
        expect(clock.now()).toBe(timeout ?? 3000);
        expect(await readLastGood(f.project.dir, f.device.host, 'controller')).toBe(f.built().code);
    });

    it('rolls back when the script crashes after the first healthy poll', async () => {
        const f = await fixture({ scripts: [{ id: 1, name: 'controller', running: true, code: 'old();' }] });
        await recordDeployment(f.project.dir, f.device.host, 'controller', 1, 'old();');
        const clock = verificationClock();
        const status = vi.spyOn(DeviceScripts.prototype, 'getStatus')
            .mockResolvedValueOnce({ id: 1, running: true })
            .mockResolvedValueOnce({ id: 1, running: false, errors: ['crashed'], error_msg: 'Timer callback failed' });
        await expect(deployScripts(f.ctx, f.config, [f.built()], { ...clock, verifyTimeoutMs: 1050 })).rejects.toMatchObject({
            code: 'UNHEALTHY', message: expect.stringMatching(/crashed.*Timer callback failed.*previous version was restored/),
            details: { failure: { restored: true, failure: { running: false, errors: ['crashed'], error_msg: 'Timer callback failed' } } },
        });
        expect(status).toHaveBeenCalledTimes(5);
        expect(clock.now()).toBe(1550);
        expect(f.device.scripts.get(1)).toMatchObject({ code: 'old();', running: true });
        expect(Object.values(await readDeployCache(f.project.dir))[0].sha256).toBe(f.built('old();').sha256);
    });

    it('aborts an in-flight status request at the verification deadline', async () => {
        const f = await fixture();
        const deadline = new AbortController();
        const timeout = AbortSignal.timeout.bind(AbortSignal);
        vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 100 ? deadline.signal : timeout(ms));
        const fetch = globalThis.fetch;
        let requested!: (signal: AbortSignal) => void;
        const request = new Promise<AbortSignal>(resolve => { requested = resolve; });
        vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
            const frame = JSON.parse(String(init?.body)) as { method: string };
            if (frame.method !== 'Script.GetStatus') return fetch(input, init);
            const signal = init!.signal!;
            requested(signal);
            return new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
        });
        const deployment = expect(deployScripts(f.ctx, f.config, [f.built()], verificationOptions())).rejects.toMatchObject({
            code: 'UNHEALTHY', message: expect.stringContaining('did not pass verification within 100 ms'),
        });
        const signal = await request;
        expect(signal.aborted).toBe(false);
        deadline.abort();
        await deployment;
        expect(signal.aborted).toBe(true);
        expect(await readDeployCache(f.project.dir)).toEqual({});
    });

    it('rejects a successful response that arrives after the deadline', async () => {
        const f = await fixture();
        const clock = verificationClock();
        vi.spyOn(DeviceScripts.prototype, 'getStatus').mockImplementation(async () => {
            clock.advance(51);
            return { id: 1, running: true };
        });
        await expect(deployScripts(f.ctx, f.config, [f.built()], { ...clock, verifyTimeoutMs: 50 })).rejects.toMatchObject({ code: 'UNHEALTHY' });
        expect(clock.sleep).not.toHaveBeenCalled();
        expect(await readDeployCache(f.project.dir)).toEqual({});
    });

    it('accepts a late healthy poll after an earlier healthy poll completed', async () => {
        const f = await fixture();
        const clock = verificationClock();
        const status = vi.spyOn(DeviceScripts.prototype, 'getStatus')
            .mockResolvedValueOnce({ id: 1, running: true })
            .mockImplementation(async () => {
                clock.advance(551);
                return { id: 1, running: true };
            });
        const result = await deployScripts(f.ctx, f.config, [f.built()], { ...clock, verifyTimeoutMs: 1050 });
        expect(result.scripts[0].status).toBe('running');
        expect(status).toHaveBeenCalledTimes(2);
        expect(await readLastGood(f.project.dir, f.device.host, 'controller')).toBe(f.built().code);
    });

    it('accepts a deadline-aborted poll after an earlier healthy poll completed', async () => {
        const f = await fixture();
        const clock = verificationClock();
        const deadline = new AbortController();
        const timeout = AbortSignal.timeout.bind(AbortSignal);
        vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 1050 ? deadline.signal : timeout(ms));
        const fetch = globalThis.fetch;
        let polls = 0;
        let requested!: (signal: AbortSignal) => void;
        const request = new Promise<AbortSignal>(resolve => { requested = resolve; });
        vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
            const frame = JSON.parse(String(init?.body)) as { method: string };
            if (frame.method !== 'Script.GetStatus' || ++polls === 1) return fetch(input, init);
            const signal = init!.signal!;
            requested(signal);
            return new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
        });
        const deployment = deployScripts(f.ctx, f.config, [f.built()], { ...clock, verifyTimeoutMs: 1050 });
        const signal = await request;
        expect(signal.aborted).toBe(false);
        deadline.abort();
        expect((await deployment).scripts[0].status).toBe('running');
        expect(polls).toBe(2);
        expect(await readLastGood(f.project.dir, f.device.host, 'controller')).toBe(f.built().code);
    });

    it.each([
        { id: 1, running: false },
        { id: 1, running: true, errors: ['crashed'] },
        { id: 1, running: true, error_msg: 'Timer callback failed' },
    ])('rejects an unhealthy late poll after a healthy poll: %j', async unhealthy => {
        const f = await fixture();
        const clock = verificationClock();
        const status = vi.spyOn(DeviceScripts.prototype, 'getStatus')
            .mockResolvedValueOnce({ id: 1, running: true })
            .mockImplementation(async () => {
                clock.advance(551);
                return unhealthy;
            });
        await expect(deployScripts(f.ctx, f.config, [f.built()], { ...clock, verifyTimeoutMs: 1050 }))
            .rejects.toMatchObject({ code: 'UNHEALTHY', details: { failure: { failure: unhealthy } } });
        expect(status).toHaveBeenCalledTimes(2);
        expect(await readDeployCache(f.project.dir)).toEqual({});
    });

    it('bounds rollback verification and never caches a late rollback response', async () => {
        const f = await fixture();
        await deployScripts(f.ctx, f.config, [f.built('old();')], verificationOptions());
        const clock = verificationClock();
        vi.spyOn(DeviceScripts.prototype, 'getStatus').mockImplementation(async () => {
            clock.advance(101);
            return { id: 1, running: true };
        }).mockResolvedValueOnce({ id: 1, running: false });
        await expect(deployScripts(f.ctx, f.config, [f.built('newCode();')], { ...clock, verifyTimeoutMs: 100 })).rejects.toMatchObject({ code: 'UNHEALTHY', message: expect.stringContaining('Rollback failed') });
        expect(clock.sleep).not.toHaveBeenCalled();
        expect(await readDeployCache(f.project.dir)).toEqual({});
    });

    it('treats error_msg alone as unhealthy', async () => {
        const f = await fixture();
        vi.spyOn(DeviceScripts.prototype, 'getStatus').mockResolvedValue({ id: 1, running: true, error_msg: 'failed' });
        await expect(deployScripts(f.ctx, f.config, [f.built()], verificationOptions())).rejects.toMatchObject({ code: 'UNHEALTHY', message: expect.stringContaining('failed') });
    });

    it('does not record unverified code or reuse the previous cache entry', async () => {
        const f = await fixture();
        await deployScripts(f.ctx, f.config, [f.built('old();')], verificationOptions());
        f.device.requests.length = 0;
        expect((await deployScripts(f.ctx, f.config, [f.built('newCode();')], { verify: false })).scripts[0].status).toBe('unverified');
        expect(f.device.requests.some(r => r.method === 'Script.GetStatus')).toBe(false);
        expect(await readDeployCache(f.project.dir)).toEqual({});
        expect(await readLastGood(f.project.dir, f.device.host, 'controller')).toBe('old();');
        expect((await deployScripts(f.ctx, f.config, [f.built('old();')], verificationOptions())).scripts[0].action).toBe('updated');
    });

    it('reports partial uploads with exit 4 and invalidates the old hash', async () => {
        const f = await fixture();
        await deployScripts(f.ctx, f.config, [f.built('old();')], verificationOptions());
        f.device.setFailure('Script.PutCode', [{ type: 'delay', ms: 1 }, { type: 'rpc', code: -1, message: 'write failed', times: Infinity }]);
        await expect(deployScripts(f.ctx, f.config, [f.built('x'.repeat(1025))])).rejects.toMatchObject({ code: 'DEPLOY', exitCode: 4, hint: expect.stringContaining('stopped and may be partially written') });
        expect(f.device.scripts.get(1)).toMatchObject({ running: false, code: 'x'.repeat(1024) });
        expect(await readDeployCache(f.project.dir)).toEqual({});
        expect(await readLastGood(f.project.dir, f.device.host, 'controller')).toBe('old();');
    });

    it('authenticates using SHELLY_PASSWORD without logging it', async () => {
        const f = await fixture({ password: 'fixture-secret' });
        f.ctx.env.SHELLY_PASSWORD = 'fixture-secret';
        await deployScripts(f.ctx, f.config, [f.built()], verificationOptions());
        expect(Object.values(f.logger).flatMap(log => log.mock.calls).flat().join('\n')).not.toContain('fixture-secret');
        expect(f.device.scripts.get(1)?.running).toBe(true);
    });

    it('reuses one authenticated client for every script, verification, and rollback on a host', async () => {
        const f = await fixture({ password: 'fixture-secret', scripts: [
            { id: 1, name: 'controller', running: true },
            { id: 2, name: 'second', running: true, code: 'old();' },
        ] });
        f.ctx.env.SHELLY_PASSWORD = 'fixture-secret';
        await writeFile(path.join(f.project.dir, 'solutions.config.json'), JSON.stringify({ home: {
            main: { src: 'src/main.ts', device: f.device.host, targetScriptName: 'controller' },
            second: { src: 'src/main.ts', device: f.device.host },
        } }));
        const config = await ProjectConfig.load(f.project.dir);
        await recordDeployment(f.project.dir, f.device.host, 'second', 2, 'old();');
        f.device.setFailure('Script.Start', { type: 'crash', scriptId: 2 });
        await expect(deployScripts(f.ctx, config, config.scripts().map(entry => ({ ...f.built(), entry })), verificationOptions())).rejects.toMatchObject({
            code: 'UNHEALTHY', message: expect.stringContaining('previous version was restored'),
        });
        expect(f.device.requests.filter(request => request.auth === undefined).map(request => request.method)).toEqual(['Script.List']);
        expect(f.device.scripts.get(1)?.running).toBe(true);
        expect(f.device.scripts.get(2)).toMatchObject({ running: true, code: 'old();' });
    });

    it('rejects incorrect credentials before changing scripts', async () => {
        const f = await fixture({ password: 'correct-password' });
        f.ctx.env.SHELLY_PASSWORD = 'wrong-password';
        await expect(deployScripts(f.ctx, f.config, [f.built()])).rejects.toMatchObject({ code: 'DEVICE_AUTH', exitCode: 4 });
        expect(f.device.scripts.size).toBe(0);
        expect(Object.values(f.logger).flatMap(log => log.mock.calls).flat().join('\n')).not.toContain('wrong-password');
    });

    it('does not reuse credentials for another script on the same host', async () => {
        const f = await fixture({ password: 'correct-password' });
        await writeFile(path.join(f.project.dir, 'solutions.config.json'), JSON.stringify({ home: {
            main: { src: 'src/main.ts', device: f.device.host, password: 'correct-password', targetScriptName: 'controller' },
            second: { src: 'src/main.ts', device: f.device.host, password: 'wrong-password' },
        } }));
        const config = await ProjectConfig.load(f.project.dir);
        await expect(deployScripts(f.ctx, config, config.scripts().map(entry => ({ ...f.built(), entry })), verificationOptions()))
            .rejects.toMatchObject({ code: 'DEVICE_AUTH', exitCode: 4 });
        expect([...f.device.scripts.values()]).toMatchObject([{ name: 'controller', running: true }]);
        expect(f.device.requests.filter(request => request.auth === undefined).map(request => request.method)).toEqual(['Script.List', 'Script.List']);
        expect(Object.values(f.logger).flatMap(log => log.mock.calls).flat().join('\n')).not.toMatch(/correct-password|wrong-password/);
    });

    it.each([0, -1, NaN, 1.5, Infinity])('rejects invalid verify timeout %s before requests', async verifyTimeoutMs => {
        const f = await fixture();
        await expect(deployScripts(f.ctx, f.config, [f.built()], { verifyTimeoutMs })).rejects.toMatchObject({ code: 'USAGE' });
        expect(f.device.requests).toEqual([]);
    });

    it('does not make requests after cancellation', async () => {
        const f = await fixture();
        f.ctx.signal = AbortSignal.abort();
        await expect(deployScripts(f.ctx, f.config, [f.built()])).rejects.toMatchObject({ code: 'DEPLOY' });
        expect(f.device.requests).toEqual([]);
    });

    it.each([true, false])('finishes configuring and starting after cancellation during upload, verify=%s', async verify => {
        const f = await fixture();
        const controller = new AbortController();
        f.ctx.signal = controller.signal;
        const upload = DeviceScripts.prototype.putCode;
        vi.spyOn(DeviceScripts.prototype, 'putCode').mockImplementation(async function (this: DeviceScripts, id, code, options) {
            await upload.call(this, id, code, { ...options, onProgress: () => controller.abort() });
        });
        const code = `print("${'x'.repeat(1025)}");`;
        await expect(deployScripts(f.ctx, f.config, [f.built(code)], { verify })).rejects.toMatchObject({ code: 'DEPLOY', message: 'Deployment interrupted' });
        expect(f.device.requests.filter(r => r.method === 'Script.PutCode')).toHaveLength(2);
        expect(f.device.requests.filter(r => r.method === 'Script.SetConfig' || r.method === 'Script.Start').map(r => r.method)).toEqual(['Script.SetConfig', 'Script.Start']);
        expect(f.device.requests.some(r => r.method === 'Script.GetStatus')).toBe(false);
        expect(f.device.scripts.get(1)).toMatchObject({ code, running: true });
        expect(await readDeployCache(f.project.dir)).toEqual({});
    });

    it.each(['stop', 'setConfig'] as const)('finishes starting after cancellation during %s', async method => {
        const f = await fixture();
        const controller = new AbortController();
        f.ctx.signal = controller.signal;
        const original = DeviceScripts.prototype[method];
        vi.spyOn(DeviceScripts.prototype, method).mockImplementation(async function (this: DeviceScripts, id, config) {
            await original.call(this, id, config!);
            controller.abort();
        });
        await expect(deployScripts(f.ctx, f.config, [f.built()], { verify: false })).rejects.toMatchObject({ code: 'DEPLOY', message: 'Deployment interrupted' });
        expect(f.device.scripts.get(1)).toMatchObject({ code: f.built().code, running: true });
    });

    it('finishes restarting the previous version after cancellation during rollback upload', async () => {
        const f = await fixture({ scripts: [{ id: 1, name: 'controller', running: true, code: 'old();' }] });
        await recordDeployment(f.project.dir, f.device.host, 'controller', 1, 'old();');
        const controller = new AbortController();
        f.ctx.signal = controller.signal;
        f.device.setFailure('Script.Start', { type: 'crash' });
        const upload = DeviceScripts.prototype.putCode;
        vi.spyOn(DeviceScripts.prototype, 'putCode').mockImplementation(async function (this: DeviceScripts, id, code, options) {
            await upload.call(this, id, code, options);
            if (code === 'old();') controller.abort();
        });
        await expect(deployScripts(f.ctx, f.config, [f.built()], verificationOptions())).rejects.toMatchObject({ code: 'DEPLOY', message: 'Deployment interrupted' });
        expect(f.device.scripts.get(1)).toMatchObject({ code: 'old();', running: true });
        expect(await readDeployCache(f.project.dir)).toEqual({});
    });

    it('does not accept a successful status after cancellation', async () => {
        const f = await fixture();
        const controller = new AbortController();
        f.ctx.signal = controller.signal;
        vi.spyOn(DeviceScripts.prototype, 'getStatus').mockImplementation(async () => {
            controller.abort();
            return { id: 1, running: true };
        });
        await expect(deployScripts(f.ctx, f.config, [f.built()], verificationOptions())).rejects.toMatchObject({ code: 'DEPLOY', message: 'Deployment interrupted' });
        expect(await readDeployCache(f.project.dir)).toEqual({});
    });
});
