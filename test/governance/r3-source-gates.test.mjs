import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
const section=name=>workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:|(?![\\s\\S]))`,'m'))?.[1];

test('R3 source additions execute without replacing existing source or browser gates',()=>{
 const source=section('source');assert.ok(source);
 for(const command of [
  'npm run check',
  'node scripts/generate-native-schema19.mjs --check',
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

const producerCommand='env -i PATH=/usr/bin:/bin "$(command -v node)" scripts/r3-source-producer.mjs';
function assertPristineProducer(source){
 assert.ok(source);
 const exact=`      - run: ${producerCommand}\n`;
 assert.equal(source.split(exact).length-1,1,'one unconditional fixed producer command');
 const position=source.indexOf(exact);
 for(const dependency of ['      - run: npm ci\n','      - run: npm ci --prefix packages/mcp-stdio --ignore-scripts\n'])assert.ok(source.indexOf(dependency)>=0&&source.indexOf(dependency)<position,'dependencies precede producer');
 for(const later of ['      - run: node --test','      - run: npm run build:ui\n','      - run: npm run check\n'])assert.ok(source.indexOf(later)>position,'producer precedes tests and generated outputs');
 assert.doesNotMatch(source,/continue-on-error|\bif:/);
}
test('the fixed J1 exporter executes against the pristine checkout before output-producing gates',()=>assertPristineProducer(section('source')));
test('producer governance rejects omission, conditional execution, duplication, and late execution',()=>{
 const source=section('source'),line=`      - run: ${producerCommand}\n`;
 assert.ok(source?.includes(line));
 for(const changed of [source.replace(line,''),source.replace(line,line+line),source.replace(line,`      - if: false\n        run: ${producerCommand}\n`),source.replace(line,'').replace('      - run: npm run check\n',`      - run: npm run check\n${line}`)])assert.throws(()=>assertPristineProducer(changed));
});

test('all six exporter source suites are literal required Node entries',()=>{
 const registry=readFileSync(new URL('../helpers/runtime-suites.ts',import.meta.url),'utf8');
 const node=registry.split('export const nodeInclude=[')[1]?.split('];')[0];assert.ok(node);
 for(const name of ['producer','producer-io','reporter','atomic','context','failure'])assert.equal(node.split(`'test/acceptance/r3-source-${name}.test.ts'`).length-1,1,name);
});
