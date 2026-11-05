import { ForgeError } from '../core/errors.js';
import { isRecord } from '../core/validation.js';
import type { RpcClient } from './rpc-client.js';

export interface DeviceScriptInfo {
    id: number;
    name: string;
    enable: boolean;
    running: boolean;
}

export interface DeviceScriptStatus {
    id: number;
    running: boolean;
    mem_used?: number;
    mem_peak?: number;
    mem_free?: number;
    cpu?: number;
    errors?: string[];
    error_msg?: string;
}

function invalidResult(method: string): ForgeError {
    return new ForgeError('DEVICE_RPC', `Invalid result for ${method}`, { details: { method } });
}

export class DeviceScripts {
    constructor(private readonly rpc: RpcClient) {}

    async list(): Promise<DeviceScriptInfo[]> {
        const result = await this.rpc.call('Script.List');
        if (!isRecord(result) || !Array.isArray(result.scripts) || !result.scripts.every(script =>
            isRecord(script) && Number.isInteger(script.id) && typeof script.name === 'string'
            && typeof script.enable === 'boolean' && typeof script.running === 'boolean')) {
            throw invalidResult('Script.List');
        }
        return result.scripts as DeviceScriptInfo[];
    }

    async findByName(name: string): Promise<DeviceScriptInfo | undefined> {
        return (await this.list()).find(script => script.name === name);
    }

    async create(name: string): Promise<number> {
        const result = await this.rpc.call('Script.Create', { name });
        if (!isRecord(result) || !Number.isInteger(result.id) || (result.id as number) < 0) throw invalidResult('Script.Create');
        return result.id as number;
    }

    async setConfig(id: number, config: { name?: string; enable?: boolean }): Promise<void> {
        await this.rpc.call('Script.SetConfig', { id, config });
    }

    async start(id: number): Promise<void> {
        await this.rpc.call('Script.Start', { id });
    }

    async stop(id: number): Promise<void> {
        try {
            await this.rpc.call('Script.Stop', { id });
        } catch (error) {
            if (!(error instanceof ForgeError) || error.code !== 'DEVICE_RPC'
                || !isRecord(error.details) || typeof error.details.message !== 'string'
                || !/\bnot running\b/i.test(error.details.message)) throw error;
        }
    }

    async putCode(id: number, code: string, options: {
        chunkSize?: number;
        onProgress?: (sentBytes: number, totalBytes: number) => void;
    } = {}): Promise<void> {
        const chunkSize = options.chunkSize ?? 1024;
        if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new ForgeError('USAGE', 'Chunk size must be a positive integer');
        if (code.length === 0) throw new ForgeError('USAGE', 'Script code must not be empty');
        const totalBytes = Buffer.byteLength(code);
        let sentBytes = 0;
        let restarts = 0;
        let offset = 0;
        let uploadResult: unknown;
        while (offset < code.length) {
            let end = Math.min(offset + chunkSize, code.length);
            const last = code.charCodeAt(end - 1);
            const next = code.charCodeAt(end);
            if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
                end += end - offset === 1 ? 1 : -1;
            }
            const chunk = code.slice(offset, end);
            try {
                uploadResult = await this.rpc.call('Script.PutCode', { id, code: chunk, append: offset !== 0 }, { retries: 0 });
            } catch (error) {
                const ambiguous = error instanceof ForgeError && error.code === 'DEVICE_UNREACHABLE';
                if (!ambiguous || restarts++ >= 2) throw error;
                // A missing response can mean the append succeeded. Replace before sending it again.
                offset = 0;
                sentBytes = 0;
                continue;
            }
            sentBytes += Buffer.byteLength(chunk);
            options.onProgress?.(sentBytes, totalBytes);
            offset = end;
        }
        let storedBytes: number;
        let lengthMethod = 'Script.PutCode';
        if (isRecord(uploadResult) && Object.hasOwn(uploadResult, 'len')) {
            if (!Number.isSafeInteger(uploadResult.len) || (uploadResult.len as number) < 0) throw invalidResult('Script.PutCode');
            storedBytes = uploadResult.len as number;
        } else {
            lengthMethod = 'Script.GetCode';
            const result = await this.rpc.call('Script.GetCode', { id, offset: 0, len: 1 });
            if (!isRecord(result) || typeof result.data !== 'string' || !Number.isSafeInteger(result.left)
                || (result.left as number) < 0) throw invalidResult('Script.GetCode');
            const firstBytes = result.data === '' ? 0 : result.data === '\uFFFD' ? 1 : Buffer.byteLength(result.data);
            storedBytes = firstBytes + (result.left as number);
        }
        if (storedBytes !== totalBytes) {
            throw new ForgeError('DEVICE_RPC', `Uploaded script length mismatch: expected ${totalBytes} bytes, device stored ${storedBytes} bytes`, {
                details: { method: lengthMethod, id, expectedBytes: totalBytes, storedBytes },
            });
        }
    }

    async getCode(id: number): Promise<string> {
        let code = '';
        let offset = 0;
        let previousLeft = Infinity;
        for (;;) {
            const result = await this.rpc.call('Script.GetCode', { id, offset, len: 1024 });
            if (!isRecord(result) || typeof result.data !== 'string' || !Number.isSafeInteger(result.left)
                || (result.left as number) < 0 || (result.left as number) >= previousLeft
                || (result.data.length === 0 && result.left !== 0)) throw invalidResult('Script.GetCode');
            code += result.data;
            offset += Buffer.byteLength(result.data);
            if (result.left === 0) return code;
            previousLeft = result.left as number;
        }
    }

    async getStatus(id: number): Promise<DeviceScriptStatus> {
        const result = await this.rpc.call('Script.GetStatus', { id });
        if (!isRecord(result) || result.id !== id || typeof result.running !== 'boolean'
            || (result.errors !== undefined && (!Array.isArray(result.errors) || !result.errors.every(error => typeof error === 'string')))
            || (result.error_msg !== undefined && typeof result.error_msg !== 'string')
            || ['mem_used', 'mem_peak', 'mem_free', 'cpu'].some(key => result[key] !== undefined && typeof result[key] !== 'number')) {
            throw invalidResult('Script.GetStatus');
        }
        return result as unknown as DeviceScriptStatus;
    }

    async eval(id: number, code: string): Promise<unknown> {
        return this.rpc.call('Script.Eval', { id, code });
    }
}

export async function setDebugWebsocket(rpc: RpcClient, enable: boolean): Promise<{ changed: boolean; restartRequired: boolean }> {
    const config = await rpc.call('Sys.GetConfig');
    if (!isRecord(config)) throw invalidResult('Sys.GetConfig');
    const websocket = isRecord(config.debug) && isRecord(config.debug.websocket) ? config.debug.websocket : undefined;
    if ((websocket?.enable === true) === enable) return { changed: false, restartRequired: false };
    const result = await rpc.call('Sys.SetConfig', { config: { debug: { websocket: { enable } } } });
    if (!isRecord(result) || typeof result.restart_required !== 'boolean') throw invalidResult('Sys.SetConfig');
    return { changed: true, restartRequired: result.restart_required };
}

export async function getDeviceInfo(rpc: RpcClient): Promise<Record<string, unknown>> {
    const result = await rpc.call('Shelly.GetDeviceInfo');
    if (!isRecord(result)) throw invalidResult('Shelly.GetDeviceInfo');
    return result;
}
