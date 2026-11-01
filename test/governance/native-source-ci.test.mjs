import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
const pkg=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
function job(name){const match=workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|$(?![\\s\\S]))`,'m'));assert.ok(match,`missing ${name} job`);return match[1];}
test('native source regression has an independent bounded pinned-runtime job',()=>{const body=job('native-source');assert.match(body,/runs-on: ubuntu-24\.04/);assert.match(body,/timeout-minutes: 5/);assert.match(body,/persist-credentials: false/);assert.match(body,/node-version: '24\.22\.1'/);assert.match(body,/npm --version/);assert.match(body,/11\.19\.1/);assert.match(body,/run: npm ci/);assert.match(body,/run: node --test test\/governance\/native-source-ci\.test\.mjs/);assert.match(body,/run: npm run test:native:r2:source/);assert.doesNotMatch(body,/continue-on-error|if:|TMPDIR|chown|chmod|rm -rf|test:native:r2 --|verify:release/);assert.equal(pkg.scripts['test:native:r2:source'],'node --test test/native-r2/*.test.mjs');});
test('source regression participates in workflow result and release dependency without deployment',()=>{assert.match(job('release-evidence'),/needs: \[source, dependencies, native-source, local-sandbox, native-build, native-service\]/);assert.match(job('source'),/^    timeout-minutes: 45$/m);assert.match(workflow,/permissions:\n  contents: read/);assert.match(workflow,/pull_request:/);assert.doesNotMatch(job('native-source'),/permissions:|secrets|environment:|deploy/);});

test('local sandbox executes the real bounded command without native acceptance or guard changes',()=>{const body=job('local-sandbox');assert.match(body,/runs-on: ubuntu-24\.04/);assert.match(body,/timeout-minutes: 5/);assert.match(body,/persist-credentials: false/);assert.match(body,/node-version: '24\.22\.1'/);assert.match(body,/11\.19\.1/);assert.match(body,/run: npm ci/);assert.match(body,/run: node scripts\/test-native-r2\.mjs --local-sandbox/);assert.doesNotMatch(body,/continue-on-error|if:|TMPDIR|chown|chmod|permissions:|secrets|environment:|deploy|--config/);});

test('real observer composition runs serially in bounded local sandbox',()=>{const body=job('local-sandbox');const first=body.indexOf('run: node scripts/test-native-r2.mjs --local-sandbox');const observer=body.indexOf('run: npm run test:native:r2:observer-local');assert.ok(first>=0&&observer>first);assert.equal(pkg.scripts['test:native:r2:observer-local'],'node scripts/test-native-r2-observer-local.mjs');});

test('fixed host artifact is reproducibly built and imported in a separate bounded job',()=>{
 const body=job('native-build');
 assert.match(body,/timeout-minutes: 5/);
 assert.match(body,/node-version: '24\.22\.1'/);
 assert.match(body,/11\.19\.1/);
 assert.match(body,/persist-credentials: false/);
 assert.match(body,/run: npm ci/);
 assert.match(body,/run: npm run check:native-host/);
 assert.doesNotMatch(body,/continue-on-error|if:|permissions:|secrets|environment:|deploy|--config|chmod|chown/);
 assert.equal(pkg.scripts['check:native-host'],'node scripts/check-native-host.mjs');
 assert.equal(pkg.scripts['build:native-host'],'node scripts/build-native-host.mjs');
 assert.match(job('release-evidence'),/needs: \[source, dependencies, native-source, local-sandbox, native-build, native-service\]/);
});

test('fixed service source exercises exact serial local fixtures and dedicated types',()=>{
 const body=job('native-service');
 assert.match(body,/timeout-minutes: 5/);
 assert.match(body,/node-version: '24\.22\.1'/);
 assert.match(body,/11\.19\.1/);
 assert.match(body,/persist-credentials: false/);
 assert.match(body,/run: npm ci/);
 assert.match(body,/run: npx --no-install tsc -p tsconfig\.native-service\.json/);
 assert.match(body,/run: npm run test:native:r2:service-source/);
 assert.doesNotMatch(body,/continue-on-error|if:|permissions:|secrets|environment:|deploy|--config|chmod|chown/);
 assert.equal(pkg.scripts['test:native:r2:service-source'],'node --test --test-concurrency=1 test/native-fixture/complete-owned-key.test.mjs test/native-fixture/complete-service-worker-import.test.mjs test/native-fixture/complete-service-worker-entry.test.mjs test/native-fixture/complete-service-ingress.test.mjs test/native-fixture/native-complete-service.test.mjs test/native-fixture/native-complete-service-schedule.test.mjs');
 assert.match(job('release-evidence'),/needs: \[source, dependencies, native-source, local-sandbox, native-build, native-service\]/);
});

test('service job includes both dedicated finite Worker regression configs serially',()=>{
 const body=job('native-service');
 const first=body.indexOf('run: npm run test:native:r2:required-controller');
 const second=body.indexOf('run: npm run test:native:r2:service-sources');
 assert.ok(first>body.indexOf('run: npm run test:native:r2:service-source')&&second>first);
 assert.equal(pkg.scripts['test:native:r2:required-controller'],'vitest run --config vitest.required-controller.config.ts');
 assert.equal(pkg.scripts['test:native:r2:service-sources'],'vitest run --config vitest.service-sources.config.ts');
 for(const [file,selected] of [['vitest.required-controller.config.ts','native-required-controller.test.ts'],['vitest.service-sources.config.ts','native-service-sources.test.ts']]){
  const config=readFileSync(new URL('../../'+file,import.meta.url),'utf8');
  assert.equal(config.match(/include:\s*\[([^\]]+)\]/)?.[1], "'test/native-fixture/"+selected+"'");
  assert.match(config,/fileParallelism:\s*false/);
  assert.doesNotMatch(config,/test\/native-fixture\/\*|test\/\*\*/);
 }
});


test('source budget covers serial gates without changing safety limits or required checks',()=>{
 const body=job('source');
 assert.deepEqual([...body.matchAll(/^    timeout-minutes: (.+)$/gm)].map(m=>m[1]),['45']);
 const gates=['npm ci','npm run build:ui','npm run check','npm run check:runtime','npx --no-install playwright install --with-deps chromium','npm run test:ui -- --reporter=line'];
 let previous=-1;
 for(const gate of gates){const index=body.indexOf('      - run: '+gate+'\n');assert.ok(index>previous,`missing or reordered gate: ${gate}`);previous=index;}
 assert.ok(body.indexOf('      - name: Documentation contracts\n')>previous);
 for(const command of ['python -B scripts/validate_docs.py','python -B scripts/validate_plans.py','python -B -m unittest discover -s test/governance -p test_r2_source_status.py -v','python -B -m unittest discover -s test/docs -p test_validate_plans.py -v'])assert.ok(body.includes(command));
 assert.doesNotMatch(body,/continue-on-error|^\s+if:|^\s+permissions:|--grep|--shard|--timeout/m);
 assert.match(workflow,/permissions:\n  contents: read\n/);
 assert.match(workflow,/concurrency:\n  group: r1-checks-\$\{\{ github.workflow \}\}-\$\{\{ github.ref \}\}\n  cancel-in-progress: true/);
 assert.deepEqual([...workflow.slice(workflow.indexOf('jobs:\n')).matchAll(/^  ([a-z][a-z-]*):$/gm)].map(m=>m[1]),['source','native-source','local-sandbox','native-build','native-service','dependencies','release-evidence']);
 assert.equal(pkg.scripts['test:ui'],'playwright test');
 assert.equal((body.match(/--reporter=line/g)??[]).length,1);
 const browser=readFileSync(new URL('../../playwright.config.ts',import.meta.url),'utf8');
 assert.match(browser,/timeout:30_000,workers:1,fullyParallel:false/);
 assert.match(browser,/timeout:60_000,reuseExistingServer:false,gracefulShutdown:\{signal:'SIGTERM',timeout:10_000\}/);
 const workers=readFileSync(new URL('../../vitest.workers.config.ts',import.meta.url),'utf8');
 assert.match(workers,/fileParallelism:false/);
});
