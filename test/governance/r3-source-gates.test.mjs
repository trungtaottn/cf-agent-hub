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

const contextCommand='env -i PATH=/usr/bin:/bin "$(command -v node)" scripts/r3-source-context-producer.mjs';
function assertPristineContext(source){
 assert.ok(source);
 const line=`      - run: ${contextCommand}\n`,v1=`      - run: ${producerCommand}\n`;
 assert.equal(source.split(line).length-1,1,'one unconditional fixed context producer');
 const position=source.indexOf(line);
 for(const earlier of ['      - run: npm ci\n','      - run: npm ci --prefix packages/mcp-stdio --ignore-scripts\n',v1])assert.ok(source.indexOf(earlier)>=0&&source.indexOf(earlier)<position,'dependencies and preserved v1 precede v2');
 for(const later of ['      - run: node --test','      - run: npm run build:ui\n','      - run: npm run check\n'])assert.ok(source.indexOf(later)>position,'context precedes generated outputs');
 assert.doesNotMatch(source,/continue-on-error|\bif:/);
}
test('context producer is mandatory and pristine, with omission/conditional/duplicate/late negatives',()=>{
 const source=section('source'),line=`      - run: ${contextCommand}\n`;
 assertPristineContext(source);
 for(const changed of [source.replace(line,''),source.replace(line,line+line),source.replace(line,`      - if: false\n        run: ${contextCommand}\n`),source.replace(line,'').replace('      - run: npm run check\n',`      - run: npm run check\n${line}`)])assert.throws(()=>assertPristineContext(changed));
});
test('all context source suites have explicit runtime owners without removing prior suites',()=>{
 const registry=readFileSync(new URL('../helpers/runtime-suites.ts',import.meta.url),'utf8');
 const node=registry.split('export const nodeInclude=[')[1]?.split('];')[0],workers=registry.split('export const workersInclude=[')[1]?.split('];')[0];assert.ok(node&&workers);
 for(const file of ['r3-precommand-context',...['io','join','measure','packet','reporter','run','validator'].map(x=>`r3-source-context-${x}`)]){
  const path=`'test/acceptance/${file}.test.ts'`;assert.equal(node.split(path).length-1,1,path);assert.ok(!workers.includes(path));
 }
 const chronology="'test/acceptance/r3-precommand-chronology.test.ts'";assert.equal(workers.split(chronology).length-1,1);assert.ok(!node.includes(chronology));
 for(const path of ["'test/acceptance/r3.test.ts'","'test/acceptance/r3-request-journey.test.ts'"])assert.equal(workers.split(path).length-1,1);
});

function assertClaimLookupOwners(registry){
 const part=name=>registry.split(`export const ${name}=[`)[1]?.split('];')[0];
 const node=part('nodeInclude'),workers=part('workersInclude'),nodeExclude=part('nodeExclude'),workersExclude=part('workersExclude');
 for(const value of [node,workers,nodeExclude,workersExclude])assert.notEqual(value,undefined);
 const nodePaths=['test/client/native-claim-outcome.test.ts','test/cli/mcp-claim-outcome.test.ts','test/mcp/claim-outcome-worker-parity.test.ts'];
 const workerPaths=['test/tasks/claim-outcome.test.ts','test/http/claim-outcome-routes.test.ts'];
 for(const path of nodePaths){const token=`'${path}'`;assert.equal(node.split(token).length-1,1,path);assert.ok(!workers.includes(token));assert.ok(!nodeExclude.includes(token));}
 for(const path of workerPaths){const token=`'${path}'`;assert.equal(workers.split(token).length-1,1,path);assert.ok(!node.includes(token));assert.ok(!workersExclude.includes(token));}
 // The existing HTTP Node glob must not also execute the actual Workerd route suite.
 assert.equal(nodeExclude.split("'test/http/claim-outcome-routes.test.ts'").length-1,1);
}
test('claim lookup source, custody and actual Worker suites have explicit runtime owners',()=>{
 const registry=readFileSync(new URL('../helpers/runtime-suites.ts',import.meta.url),'utf8');
 assertClaimLookupOwners(registry);
 for(const path of ['test/client/native-claim-outcome.test.ts','test/cli/mcp-claim-outcome.test.ts','test/mcp/claim-outcome-worker-parity.test.ts','test/tasks/claim-outcome.test.ts','test/http/claim-outcome-routes.test.ts']){
  assert.throws(()=>assertClaimLookupOwners(registry.replace(`'${path}',`,'')),path);
 }
 assert.throws(()=>assertClaimLookupOwners(registry.replace("export const nodeExclude=['test/http/claim-outcome-routes.test.ts',","export const nodeExclude=[")));
});
