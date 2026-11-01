/** Read-only Node fixture boundary; DOM tests do not acquire Node ambient types. */
import {readFileSync} from 'node:fs';
export const factoryAppSource=readFileSync(new URL('../../src/ui/app.ts',import.meta.url),'utf8');
