import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { Script } from 'node:vm';
import type { DeviceScriptInfo, DeviceScriptStatus } from '../../src/device/scripts.js';
import type { DigestAuth } from '../../src/device/digest-auth.js';

export interface FakeDeviceScript extends DeviceScriptInfo, DeviceScriptStatus {
    code: string;
}

export type FakeDeviceScriptInput = Pick<FakeDeviceScript, 'name'> & Partial<Omit<FakeDeviceScript, 'name'>>;

export type FakeDeviceFailure = { times?: number; scriptId?: number } & (
    | { type: 'drop' }
    | { type: 'apply-then-drop' }
    | { type: 'delay'; ms: number }
    | { type: 'rpc'; code: number; message: string }
    | { type: 'crash'; errors?: string[]; error_msg?: string }
    | { type: 'auth' }
);

export interface FakeDeviceRequest {
    id: number;
    src: string;
    method: string;
    params: Record<string, unknown>;
    auth?: DigestAuth;
}

export interface FakeDeviceOptions {
    password?: string;
    /** Digest ha2 input: 'http' hashes "POST:/rpc" (current firmware), 'legacy' hashes "dummy_method:dummy_uri". */
    authMode?: 'http' | 'legacy';
    scripts?: FakeDeviceScriptInput[];
    failures?: Record<string, FakeDeviceFailure | FakeDeviceFailure[]>;
    debugWebsocket?: boolean;
    restartRequired?: boolean;
    deviceInfo?: Record<string, unknown>;
}

export interface FakeDevice {
    host: string;
    requests: FakeDeviceRequest[];
    scripts: Map<number, FakeDeviceScript>;
    setFailure(method: string, failure: FakeDeviceFailure | FakeDeviceFailure[] | undefined): void;
    close(): Promise<void>;
}

class RpcFailure extends Error {
    constructor(readonly code: number, message: string) {
        super(message);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function startFakeDevice(options: FakeDeviceOptions = {}): Promise<FakeDevice> {
    const scripts = new Map<number, FakeDeviceScript>();
    for (const input of options.scripts ?? []) {
        const id = input.id ?? Math.max(0, ...scripts.keys()) + 1;
        scripts.set(id, { code: '', enable: false, running: false, ...input, id });
    }
    const requests: FakeDeviceRequest[] = [];
    const failures = new Map<string, FakeDeviceFailure[]>();
    const delays = new Map<NodeJS.Timeout, () => void>();
    const nonces = new Map<string, number>();
    const realm = 'shelly-fake-device';
    let debugWebsocket = options.debugWebsocket ?? false;
    let closed = false;

    function setFailure(method: string, failure: FakeDeviceFailure | FakeDeviceFailure[] | undefined): void {
        if (failure === undefined) {
            failures.delete(method);
        } else {
            failures.set(method, (Array.isArray(failure) ? failure : [failure]).map(entry => ({ ...entry, times: entry.times ?? 1 })));
        }
    }
    for (const [method, failure] of Object.entries(options.failures ?? {})) setFailure(method, failure);

    function takeFailure(frame: FakeDeviceRequest): FakeDeviceFailure | undefined {
        const entries = failures.get(frame.method);
        const index = entries?.findIndex(entry => (entry.times ?? 1) > 0 && (entry.scriptId === undefined || entry.scriptId === frame.params.id)) ?? -1;
        if (!entries || index < 0) return undefined;
        const failure = entries[index];
        failure.times = (failure.times ?? 1) - 1;
        if (failure.times === 0) entries.splice(index, 1);
        return failure;
    }

    function challenge(response: ServerResponse): void {
        const nonce = randomBytes(18).toString('base64');
        nonces.set(nonce, 0);
        response.writeHead(401, {
            'WWW-Authenticate': `Digest qop="auth", realm="${realm}", nonce="${nonce}", algorithm=SHA-256`,
        });
        response.end();
    }

    function authenticated(auth: DigestAuth | undefined): boolean {
        if (options.password === undefined) return true;
        if (!auth || auth.username !== 'admin' || auth.realm !== realm || auth.algorithm !== 'SHA-256'
            || typeof auth.nonce !== 'string' || !nonces.has(auth.nonce) || !/^[\da-f]{8}$/.test(auth.nc)
            || !Number.isSafeInteger(auth.cnonce) || typeof auth.response !== 'string' || !/^[\da-f]{64}$/.test(auth.response)) return false;
        const count = Number.parseInt(auth.nc, 16);
        if (count <= nonces.get(auth.nonce)!) return false;
        const hash = (value: string) => createHash('sha256').update(value).digest('hex');
        const ha1 = hash(`admin:${realm}:${options.password}`);
        const ha2 = hash(options.authMode === 'legacy' ? 'dummy_method:dummy_uri' : 'POST:/rpc');
        const expected = hash(`${ha1}:${auth.nonce}:${auth.nc}:${auth.cnonce}:auth:${ha2}`);
        if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(auth.response, 'hex'))) return false;
        nonces.set(auth.nonce, count);
        return true;
    }

    function scriptFor(params: Record<string, unknown>): FakeDeviceScript {
        const script = scripts.get(params.id as number);
        if (!script) throw new RpcFailure(404, 'Script not found');
        return script;
    }

    function dispatch(frame: FakeDeviceRequest, failure: FakeDeviceFailure | undefined): unknown {
        const { method, params } = frame;
        switch (method) {
            case 'Script.List':
                return { scripts: [...scripts.values()].map(({ id, name, enable, running }) => ({ id, name, enable, running })) };
            case 'Script.Create': {
                if (typeof params.name !== 'string') throw new RpcFailure(-103, 'Name is required');
                const id = Math.max(0, ...scripts.keys()) + 1;
                scripts.set(id, { id, name: params.name, code: '', enable: false, running: false });
                return { id };
            }
            case 'Script.SetConfig': {
                const script = scriptFor(params);
                if (!isRecord(params.config)) throw new RpcFailure(-103, 'Config is required');
                if (typeof params.config.name === 'string') script.name = params.config.name;
                if (typeof params.config.enable === 'boolean') script.enable = params.config.enable;
                return { restart_required: false };
            }
            case 'Script.Start': {
                const script = scriptFor(params);
                const was_running = script.running;
                script.running = true;
                delete script.errors;
                delete script.error_msg;
                if (failure?.type === 'crash') {
                    script.running = false;
                    script.errors = failure.errors ?? ['crashed'];
                    script.error_msg = failure.error_msg ?? 'Script crashed';
                }
                return { was_running };
            }
            case 'Script.Stop': {
                const script = scriptFor(params);
                if (!script.running) throw new RpcFailure(-114, 'Script is not running');
                script.running = false;
                return { was_running: true };
            }
            case 'Script.PutCode': {
                const script = scriptFor(params);
                if (typeof params.code !== 'string' || params.code.length === 0) throw new RpcFailure(-103, 'Code is required');
                if (script.running) throw new RpcFailure(-114, 'Script is running');
                script.code = params.append === true ? script.code + params.code : params.code;
                return { len: Buffer.byteLength(script.code) };
            }
            case 'Script.GetCode': {
                const script = scriptFor(params);
                const offset = typeof params.offset === 'number' ? params.offset : 0;
                const len = typeof params.len === 'number' ? params.len : 1024;
                const bytes = Buffer.from(script.code);
                let end = Math.min(offset + len, bytes.length);
                while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
                if (end === offset && end < bytes.length) {
                    end++;
                    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end++;
                }
                return { data: bytes.subarray(offset, end).toString(), left: bytes.length - end };
            }
            case 'Script.GetStatus': {
                const { code: _code, name: _name, enable: _enable, ...status } = scriptFor(params);
                return { mem_used: 128, mem_peak: 256, mem_free: 4096, cpu: 0, ...status };
            }
            case 'Script.Eval': {
                if (!scriptFor(params).running) throw new RpcFailure(-114, 'Script is not running');
                if (typeof params.code !== 'string') throw new RpcFailure(-103, 'Code is required');
                try {
                    const result: unknown = new Script(params.code).runInNewContext(Object.create(null), {
                        timeout: 50, contextCodeGeneration: { strings: false, wasm: false },
                    });
                    return { result: String(result) };
                } catch {
                    throw new RpcFailure(-103, 'Evaluation failed');
                }
            }
            case 'Sys.GetConfig':
                return { debug: { websocket: { enable: debugWebsocket } } };
            case 'Sys.SetConfig': {
                const config = params.config;
                if (!isRecord(config) || !isRecord(config.debug) || !isRecord(config.debug.websocket)
                    || typeof config.debug.websocket.enable !== 'boolean') throw new RpcFailure(-103, 'Invalid debug config');
                debugWebsocket = config.debug.websocket.enable;
                return { restart_required: options.restartRequired ?? false };
            }
            case 'Shelly.GetDeviceInfo':
                return { id: realm, model: 'SNSW-001X16EU', gen: 2, app: 'Plus1', ver: '1.6.2', ...options.deviceInfo };
            default:
                throw new RpcFailure(404, 'Method not found');
        }
    }

    function delay(ms: number): Promise<void> {
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                delays.delete(timer);
                resolve();
            }, ms);
            delays.set(timer, resolve);
        });
    }

    const server = createServer((request, response) => {
        void (async () => {
            if (request.method !== 'POST' || request.url !== '/rpc') {
                response.writeHead(404).end();
                return;
            }
            const parts: Buffer[] = [];
            for await (const part of request) parts.push(Buffer.from(part));
            const frame: unknown = JSON.parse(Buffer.concat(parts).toString());
            if (!isRecord(frame) || typeof frame.id !== 'number' || typeof frame.method !== 'string'
                || typeof frame.src !== 'string' || !isRecord(frame.params)) {
                response.writeHead(400).end();
                return;
            }
            const rpc = frame as unknown as FakeDeviceRequest;
            requests.push(rpc);
            if (!authenticated(rpc.auth)) {
                challenge(response);
                return;
            }
            const failure = takeFailure(rpc);
            if (failure?.type === 'drop') {
                request.socket.destroy();
                return;
            }
            if (failure?.type === 'auth') {
                nonces.clear();
                challenge(response);
                return;
            }
            if (failure?.type === 'delay') await delay(failure.ms);
            if (closed || response.destroyed) return;
            let payload: Record<string, unknown>;
            try {
                if (failure?.type === 'rpc') throw new RpcFailure(failure.code, failure.message);
                payload = { result: dispatch(rpc, failure) };
            } catch (error) {
                payload = { error: {
                    code: error instanceof RpcFailure ? error.code : -32603,
                    message: error instanceof RpcFailure ? error.message : 'Internal fake device error',
                } };
            }
            if (failure?.type === 'apply-then-drop') {
                request.socket.destroy();
                return;
            }
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ id: rpc.id, src: realm, dst: rpc.src, ...payload }));
        })().catch(() => {
            if (!response.destroyed) response.writeHead(400).end();
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fake device did not bind a TCP port');
    return {
        host: `127.0.0.1:${address.port}`, requests, scripts, setFailure,
        async close() {
            if (closed) return;
            closed = true;
            for (const [timer, resolve] of delays) {
                clearTimeout(timer);
                resolve();
            }
            delays.clear();
            await new Promise<void>((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
                server.closeAllConnections();
            });
        },
    };
}
