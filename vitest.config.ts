import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/contracts/**/*.test.ts', 'test/config/**/*.test.ts'] } });
