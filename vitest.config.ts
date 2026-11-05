import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        exclude: ['tests/hardware/**'],
        testTimeout: 15000,
        hookTimeout: 15000,
    },
});
