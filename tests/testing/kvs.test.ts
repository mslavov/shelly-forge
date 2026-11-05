import { expect, test } from 'vitest';
import { KVS_LIMITS } from '../../src/core/runtime-profile.js';
import { createShellyRuntime, type ShellyRuntime } from '../../src/testing/index.js';

function call(runtime: ShellyRuntime, method: string, params: unknown): { result: Record<string, unknown> | null; code: number; message: string } {
    runtime.load(`Shelly.call(${JSON.stringify(method)}, ${JSON.stringify(params)}, function (result, code, message) { print(JSON.stringify({result: result, code: code, message: message})); });`);
    runtime.flush();
    return JSON.parse(runtime.logs.at(-1)!);
}

test('KVS sets, gets, lists, matches, paginates and deletes JSON values', () => {
    const runtime = createShellyRuntime({ kvs: { 'room.a': 'seed', 'Room.b': 'second', outside: 'other' } });
    const set = call(runtime, 'KVS.Set', { key: 'room.c', value: { on: true, levels: [1, 2] } });
    expect(set).toMatchObject({ code: 0, result: { rev: 4 } });
    expect(typeof set.result?.etag).toBe('string');
    expect(call(runtime, 'KVS.Get', { key: 'room.c' }).result).toEqual({ value: { on: true, levels: [1, 2] }, etag: set.result?.etag });
    expect(runtime.kvs.get('room.a')).toBe('seed');
    expect(runtime.kvs.get('room.c')).toBe('{"on":true,"levels":[1,2]}');
    expect(runtime.kvs.get('absent')).toBeUndefined();
    const list = call(runtime, 'KVS.List', { match: 'ROOM.?,not-present' });
    expect(Object.keys(list.result?.keys as object)).toEqual(['room.a', 'Room.b', 'room.c']);
    const many = call(runtime, 'KVS.GetMany', { match: 'ROOM.*', offset: 1 });
    expect(many.result).toMatchObject({ total: 3, offset: 1 });
    expect(Object.keys(many.result?.items as object)).toEqual(['Room.b', 'room.c']);
    expect(call(runtime, 'KVS.Delete', { key: 'room.a' })).toMatchObject({ code: 0, result: { rev: 5 } });
    expect(call(runtime, 'KVS.Get', { key: 'room.a' })).toMatchObject({ code: -105, result: null });
    expect(runtime.kvs.entries()).toEqual({ 'Room.b': 'second', outside: 'other', 'room.c': '{"on":true,"levels":[1,2]}' });
});

test('KVS etags reject stale updates and deletes', () => {
    const runtime = createShellyRuntime({ kvs: { key: 'before' } });
    const initial = call(runtime, 'KVS.Get', { key: 'key' }).result!;
    expect(call(runtime, 'KVS.Set', { key: 'key', value: 'after', etag: initial.etag }).code).toBe(0);
    expect(call(runtime, 'KVS.Set', { key: 'key', value: 'lost', etag: initial.etag }).code).toBe(-109);
    expect(call(runtime, 'KVS.Delete', { key: 'key', etag: initial.etag }).code).toBe(-109);
    expect(runtime.kvs.get('key')).toBe('after');
    expect(call(runtime, 'KVS.Delete', { key: 'missing' }).code).toBe(-105);
    expect(call(runtime, 'KVS.Set', { key: 'missing', value: 1, etag: initial.etag }).code).toBe(-105);
});

test('KVS key and value limits reject RPCs without throwing and allow exact boundaries', () => {
    const runtime = createShellyRuntime();
    const key = 'k'.repeat(KVS_LIMITS.maxKeyLength);
    expect(call(runtime, 'KVS.Set', { key, value: 'v'.repeat(KVS_LIMITS.maxValueLength) }).code).toBe(0);
    expect(call(runtime, 'KVS.Set', { key: `${key}x`, value: 'x' })).toMatchObject({ code: -103, result: null, message: expect.stringContaining('maxKeyLength') });
    expect(call(runtime, 'KVS.Set', { key: 'large', value: 'v'.repeat(KVS_LIMITS.maxValueLength + 1) })).toMatchObject({ code: -103, result: null, message: expect.stringContaining('maxValueLength') });
    expect(call(runtime, 'KVS.Set', { key: 'multibyte', value: 'é'.repeat(127) }).code).toBe(-103);
    expect(call(runtime, 'KVS.Set', { key: 'é'.repeat(22), value: 'x' }).code).toBe(-103);
    expect(runtime.kvs.entries()).toEqual({ [key]: 'v'.repeat(KVS_LIMITS.maxValueLength) });
});

test('KVS maxKeys allows updates at capacity and frees deleted slots', () => {
    const seed = Object.fromEntries(Array.from({ length: KVS_LIMITS.maxKeys }, (_, index) => [`key${index}`, 'value']));
    const runtime = createShellyRuntime({ kvs: seed });
    expect(call(runtime, 'KVS.Set', { key: 'new', value: 'x' })).toMatchObject({ code: -108, message: expect.stringContaining('maxKeys') });
    expect(call(runtime, 'KVS.Set', { key: 'key0', value: 'updated' }).code).toBe(0);
    expect(call(runtime, 'KVS.Delete', { key: 'key1' }).code).toBe(0);
    expect(call(runtime, 'KVS.Set', { key: 'new', value: 'x' }).code).toBe(0);
    expect(Object.keys(runtime.kvs.entries())).toHaveLength(KVS_LIMITS.maxKeys);
});

test('KVS validates required arguments and treats prototype names as ordinary keys', () => {
    const runtime = createShellyRuntime();
    expect(call(runtime, 'KVS.Set', { key: '', value: 'x' }).code).toBe(-103);
    expect(call(runtime, 'KVS.Set', { key: 'missing' }).code).toBe(-103);
    expect(call(runtime, 'KVS.GetMany', { offset: -1 }).code).toBe(-103);
    expect(call(runtime, 'KVS.List', { match: 1 }).code).toBe(-103);
    expect(call(runtime, 'KVS.Set', { key: '__proto__', value: 'safe' }).code).toBe(0);
    expect(runtime.kvs.entries()).toEqual(JSON.parse('{"__proto__":"safe"}'));
    expect(Object.getPrototypeOf(runtime.kvs.entries())).toBe(Object.prototype);
});
