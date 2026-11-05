import { RESOURCE_LIMITS } from '../core/runtime-profile.js';
import type { ScriptCallback, ScriptHost, ShellyRuntime } from './types.js';

interface Response { code: number; body: string; headers: [string, string][] }

export function createHttp(host: ScriptHost) {
    const endpoints = new Map<string, { callback: ScriptCallback; userdata: unknown }>();
    return {
        clear(): void { endpoints.clear(); },
        api: {
            registerEndpoint(name: string, callback: ScriptCallback, userdata?: unknown): string {
                if (typeof name !== 'string' || !name.length || /[/?#\0]/.test(name)) throw new Error('Invalid HTTP endpoint name');
                if (typeof callback !== 'function') throw new Error('HTTP endpoint callback must be a function');
                if (endpoints.has(name)) throw new Error(`HTTP endpoint already registered: ${name}`);
                if (endpoints.size >= RESOURCE_LIMITS.httpEndpoints) throw new Error(`httpEndpoints limit exceeded (${RESOURCE_LIMITS.httpEndpoints})`);
                endpoints.set(name, { callback, userdata });
                return `/script/1/${name}`;
            },
        },
        control: {
            request(endpoint, request = {}): Response {
                const entry = endpoints.get(endpoint.startsWith('/script/1/') ? endpoint.slice('/script/1/'.length) : endpoint);
                if (!entry) return { code: 404, body: 'Not found', headers: [] };
                let sent: Response | undefined;
                const response = host.toScript({ code: 200, body: '', headers: [] as [string, string][] }) as Response & { send(): boolean };
                response.send = host.wrap(() => {
                    if (sent) return false;
                    const headers: [string, string][] = [];
                    if (!Array.isArray(response.headers)) throw new Error('HTTP response headers must be an array');
                    for (let index = 0; index < response.headers.length; index++) {
                        const pair = response.headers[index];
                        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
                            throw new Error('HTTP response headers must be string pairs');
                        }
                        headers.push([pair[0], pair[1]]);
                    }
                    if (!Number.isInteger(response.code) || response.code < 100 || response.code > 599) throw new Error('Invalid HTTP response code');
                    if (typeof response.body !== 'string') throw new Error('HTTP response body must be a string');
                    sent = { code: response.code, body: response.body, headers };
                    return true;
                }) as () => boolean;
                host.invoke(entry.callback, [host.toScript({ ...request, method: request.method ?? 'GET', headers: request.headers ?? [] }), response, entry.userdata]);
                return sent ?? { code: 504, body: 'Response not sent', headers: [] };
            },
        } satisfies ShellyRuntime['http'],
    };
}
