import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment:'node', include: ['test/contracts/**/*.test.ts','test/config/**/*.test.ts','test/auth/operator-provisioning.test.ts'] } });
