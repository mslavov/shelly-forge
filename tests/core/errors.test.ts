import { expect, test } from 'vitest';
import { EXIT_CODES, ForgeError, toForgeError, type ErrorCode } from '../../src/core/errors.js';

test.each(Object.entries(EXIT_CODES) as [ErrorCode, number][])('%s has exit code %i and preserves metadata', (code, exitCode) => {
    const cause = new Error('cause');
    const error = new ForgeError(code, 'message', { hint: 'hint', details: { value: 1 }, cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.exitCode).toBe(exitCode);
    expect(error).toMatchObject({ name: 'ForgeError', message: 'message', hint: 'hint', details: { value: 1 }, cause });
    expect(toForgeError(error)).toBe(error);
});

test('wraps Error and non-Error values as INTERNAL without losing the cause', () => {
    const cause = new Error('failed');
    expect(toForgeError(cause)).toMatchObject({ code: 'INTERNAL', message: 'failed', cause });
    expect(toForgeError('failed')).toMatchObject({ code: 'INTERNAL', message: 'failed', cause: 'failed' });
});
