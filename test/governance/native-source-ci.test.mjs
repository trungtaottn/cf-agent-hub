import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
const pkg=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
function job(name){const match=workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|$(?![\\s\\S]))`,'m'));assert.ok(match,`missing ${name} job`);return match[1];}
test('native source regression has an independent bounded pinned-runtime job',()=>{const body=job('native-source');assert.match(body,/runs-on: ubuntu-24\.04/);assert.match(body,/timeout-minutes: 5/);assert.match(body,/persist-credentials: false/);assert.match(body,/node-version: '24\.22\.1'/);assert.match(body,/npm --version/);assert.match(body,/11\.19\.1/);assert.match(body,/run: npm ci/);assert.match(body,/run: node --test test\/governance\/native-source-ci\.test\.mjs/);assert.match(body,/run: npm run test:native:r2:source/);assert.doesNotMatch(body,/continue-on-error|if:|TMPDIR|chown|chmod|rm -rf|test:native:r2 --|verify:release/);assert.equal(pkg.scripts['test:native:r2:source'],'node --test test/native-r2/*.test.mjs');});
test('source regression participates in workflow result and release dependency without deployment',()=>{assert.match(job('release-evidence'),/needs: \[source, dependencies, native-source, local-sandbox, native-build, native-service\]/);assert.match(job('source'),/timeout-minutes: 30/);assert.match(workflow,/permissions:\n  contents: read/);assert.match(workflow,/pull_request:/);assert.doesNotMatch(job('native-source'),/permissions:|secrets|environment:|deploy/);});

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
