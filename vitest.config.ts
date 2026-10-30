import {configDefaults,defineConfig} from 'vitest/config';
import {nodeInclude,nodeExclude} from './test/helpers/runtime-suites';
export default defineConfig({test:{environment:'node',include:nodeInclude,exclude:[...configDefaults.exclude,...nodeExclude]}});
