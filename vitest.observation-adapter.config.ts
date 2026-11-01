import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['test/observation-adapter/**/*.test.ts']}});
