import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
const section=name=>workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:|(?![\\s\\S]))`,'m'))?.[1];

test('R3 source additions execute without replacing existing source or browser gates',()=>{
 const source=section('source');assert.ok(source);
 for(const command of [
  'npm run check',
  'node scripts/check-observation-adapter.mjs',
  'npm ci --prefix packages/mcp-stdio --ignore-scripts',
  'node packages/mcp-stdio/scripts/check.mjs',
  'node --test test/acceptance/r3-prerequisites.test.mjs',
  'node --test test/governance/r3-source-gates.test.mjs',
  'npm run test:ui -- --reporter=line'
 ])assert.ok(source.includes(`- run: ${command}\n`),command);
 assert.ok(source.indexOf('- run: npm ci --prefix packages/mcp-stdio --ignore-scripts')<source.indexOf('- run: npm run check'),'MCP dependencies exist before the root typecheck includes MCP tests');
 assert.doesNotMatch(source,/continue-on-error|\bif:/);
 assert.match(source,/timeout-minutes: 45/);
});

test('the separate MCP installed dependency graph is audited without omitting development packages',()=>{
 const dependencies=section('dependencies');assert.ok(dependencies);
 assert.ok(dependencies.includes('- run: npm ci\n'));
 assert.ok(dependencies.includes('run: npm audit --audit-level=low\n'));
 assert.ok(dependencies.includes('- run: npm ci --prefix packages/mcp-stdio --ignore-scripts\n'));
 assert.ok(dependencies.includes('- run: npm audit --prefix packages/mcp-stdio --audit-level=low\n'));
 assert.doesNotMatch(dependencies,/continue-on-error|\bif:|--omit|--force/);
});
