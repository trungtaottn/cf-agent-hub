import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment:'node', exclude:['test/config/settings.test.ts','test/http/settings-contract.test.ts'], include: ['test/http/**/*.test.ts','test/audit/**/*.test.ts','test/contracts/**/*.test.ts','test/config/**/*.test.ts','test/auth/operator-provisioning.test.ts'] } });
