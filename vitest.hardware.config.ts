import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/hardware/**/*.test.ts'],
        testTimeout: 120000,
        hookTimeout: 120000,
    },
});
