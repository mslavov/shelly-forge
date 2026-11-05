import { RESOURCE_LIMITS } from '../core/runtime-profile.js';
import type { ScriptCallback, ScriptHost, ShellyRuntime } from './types.js';

function topicParts(topic: string, filter: boolean): string[] {
    if (typeof topic !== 'string' || !topic.length || topic.includes('\0')) throw new Error('MQTT topic must be a non-empty string without NUL');
    const parts = topic.split('/');
    for (let index = 0; index < parts.length; index++) {
        const part = parts[index];
        if (part.includes('#') && (!filter || part !== '#' || index !== parts.length - 1)) throw new Error('Invalid MQTT # wildcard');
        if (part.includes('+') && (!filter || part !== '+')) throw new Error('Invalid MQTT + wildcard');
    }
    return parts;
}

function matches(filter: string, topic: string): boolean {
    if (topic.startsWith('$') && !filter.startsWith('$')) return false;
    const expected = filter.split('/');
    const actual = topic.split('/');
    for (let index = 0; index < expected.length; index++) {
        if (expected[index] === '#') return true;
        if (index >= actual.length) return false;
        if (expected[index] !== '+' && expected[index] !== actual[index]) return false;
    }
    return expected.length === actual.length;
}

export function createMqtt(host: ScriptHost, initiallyConnected: boolean) {
    let connected = initiallyConnected;
    const subscriptions = new Map<string, { callback: ScriptCallback; userdata: unknown }>();
    const published: Array<ShellyRuntime['mqtt']['published'][number]> = [];
    let onConnect: { callback: ScriptCallback; userdata: unknown } | undefined;
    let onDisconnect: { callback: ScriptCallback; userdata: unknown } | undefined;
    const handler = (callback: ScriptCallback, userdata: unknown) => {
        if (typeof callback !== 'function') throw new Error('MQTT handler must be a function');
        return { callback, userdata };
    };
    return {
        clear(): void {
            subscriptions.clear();
            onConnect = undefined;
            onDisconnect = undefined;
        },
        api: {
            isConnected: () => connected,
            subscribe(topic: string, callback: ScriptCallback, userdata?: unknown): void {
                topicParts(topic, true);
                const entry = handler(callback, userdata);
                if (!subscriptions.has(topic) && subscriptions.size >= RESOURCE_LIMITS.mqttSubscriptions) {
                    throw new Error(`mqttSubscriptions limit exceeded (${RESOURCE_LIMITS.mqttSubscriptions})`);
                }
                subscriptions.set(topic, entry);
            },
            unsubscribe: (topic: string): boolean => subscriptions.delete(topic),
            publish(topic: string, message: string, qos = 0, retain = false): boolean {
                topicParts(topic, false);
                if (typeof message !== 'string') throw new Error('MQTT message must be a string');
                if (qos !== 0 && qos !== 1 && qos !== 2) throw new Error('MQTT qos must be 0, 1 or 2');
                if (typeof retain !== 'boolean') throw new Error('MQTT retain must be a boolean');
                if (!connected) return false;
                published.push({ topic, message, qos, retain });
                return true;
            },
            setConnectHandler: (callback: ScriptCallback, userdata?: unknown): void => { onConnect = handler(callback, userdata); },
            setDisconnectHandler: (callback: ScriptCallback, userdata?: unknown): void => { onDisconnect = handler(callback, userdata); },
        },
        control: {
            receive(topic: string, message: string): void {
                topicParts(topic, false);
                if (typeof message !== 'string') throw new Error('MQTT message must be a string');
                if (!connected) return;
                for (const [filter, entry] of Array.from(subscriptions)) {
                    if (subscriptions.get(filter) === entry && matches(filter, topic)) host.invoke(entry.callback, [topic, message, entry.userdata]);
                }
            },
            setConnected(value: boolean): void {
                if (connected === value) return;
                connected = value;
                const entry = connected ? onConnect : onDisconnect;
                if (entry) host.invoke(entry.callback, [entry.userdata]);
            },
            published,
        } satisfies ShellyRuntime['mqtt'],
    };
}
