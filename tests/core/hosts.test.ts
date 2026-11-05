import { describe, expect, test } from 'vitest';
import { deviceKey, parseDeviceUrl } from '../../src/core/hosts.js';

describe('device hosts', () => {
    test.each([
        ['DEVICE.local', 'device.local'],
        ['DEVICE.local:80', 'device.local'],
        ['DEVICE.local:8080', 'device.local:8080'],
        ['127.0.0.1:8080', '127.0.0.1:8080'],
        ['[::1]:80', '[::1]'],
        ['[2001:0db8::1]:8080', '[2001:db8::1]:8080'],
    ])('normalizes %s to %s', (host, expected) => {
        expect(deviceKey(host)).toBe(expected);
    });

    test.each(['', 'http://localhost', 'localhost/path', 'user@localhost', 'localhost?query=1',
        'localhost#fragment', 'localhost\\path', 'bad host', 'localhost:65536', '::1'])('rejects %s', host => {
        expect(() => parseDeviceUrl(host)).toThrow();
    });

    test('appends an endpoint without changing the host or port', () => {
        expect(parseDeviceUrl('DEVICE.local:8080', '/rpc').href).toBe('http://device.local:8080/rpc');
        expect(parseDeviceUrl('[::1]:8080', '/debug/log').href).toBe('http://[::1]:8080/debug/log');
    });
});
