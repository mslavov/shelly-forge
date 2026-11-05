import { describe, expect, test } from 'vitest';
import { isRecord } from '../../src/core/validation.js';

describe('isRecord', () => {
    test.each([undefined, null, false, 0, '', [], () => {}])('rejects non-record %#', value => {
        expect(isRecord(value)).toBe(false);
    });

    test.each([{}, { value: 1 }, Object.create(null)])('accepts a record %#', value => {
        expect(isRecord(value)).toBe(true);
    });
});
