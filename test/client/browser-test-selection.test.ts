import {describe,it,expect} from 'vitest';
import {globSync} from 'node:fs';
import path from 'node:path';
import config from '../../playwright.config';
import {nodeInclude,workersInclude} from '../helpers/runtime-suites';

describe('browser and Node composition suite ownership',()=>{
 it('explicitly collects browser specs rather than Playwright default mixed test suffixes',()=>{
  expect(config.testDir).toBe('./test/ui');
  expect(config.testMatch).toBe('**/*.spec.ts');
  const selected=globSync(config.testMatch as string,{cwd:path.resolve(config.testDir!)}).sort();
  expect(selected).toContain('compose-storage.spec.ts');
  expect(selected).toEqual(globSync('**/*.spec.ts',{cwd:path.resolve('test/ui')}).sort());
  expect(selected).not.toContain('draft-store.test.ts');
  expect(selected).not.toContain('submit-intent.test.ts');
 });
 it('keeps both composition unit suites in Node and outside Workers',()=>{
  for(const p of ['test/ui/draft-store.test.ts','test/ui/submit-intent.test.ts'])expect(nodeInclude).toContain(p);
  expect(workersInclude.some(p=>p.startsWith('test/ui/'))).toBe(false);
 });
});
