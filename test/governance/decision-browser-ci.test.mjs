import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const commands = [
  'npm ci',
  'npm ci --prefix packages/mcp-stdio --ignore-scripts',
  'node --test test/governance/decision-browser-ci.test.mjs',
  'npm run build:ui',
  'node scripts/start-decision-ui-test-server.mjs --self-check',
  'npx --no-install playwright install --with-deps chromium',
  'npx --no-install playwright test --config=playwright.decisions.config.ts --reporter=line',
];
function validate(text) {
  const section = name => text.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:|(?![\\s\\S]))`, 'm'))?.[1];
  const job = section('decision-browser');
  assert.ok(job, 'dedicated mandatory job exists');
  assert.match(job, /^    runs-on: ubuntu-24\.04$/m);
  assert.match(job, /^    timeout-minutes: 15$/m);
  assert.doesNotMatch(job, /\bif:|continue-on-error|\benv:|\bsecrets\b|download-artifact|workflow_run|\bneeds:|^\s+(?:ref|repository|working-directory):/m);
  assert.match(text, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(job, /^\s+permissions:/m);
  assert.match(job, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(job, /persist-credentials: false/);
  assert.match(job, /actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1/);
  assert.match(job, /node-version: '24\.22\.1'/);
  assert.match(job, /test "\$\(npm --version\)" = '11\.19\.1'/);
  const actual = [...job.matchAll(/^      - run: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(actual, commands, 'fixed source build and browser commands, no artifact entry');
  assert.deepEqual([...job.matchAll(/^      - uses: ([^ ]+)/gm)].map(match => match[1]), [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1',
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  ]);
  const upload = job.slice(job.indexOf('      - uses: actions/upload-artifact@'));
  assert.match(upload, /name: decision-browser-visual-\$\{\{ github.sha \}\}/);
  assert.match(upload, /retention-days: 3\n/);
  assert.match(upload, /if-no-files-found: error\n/);
  assert.match(upload, /include-hidden-files: false\n/);
  assert.match(upload, /path: \|\n            factory-decision-visual\/desktop-confirmation\.png\n            factory-decision-visual\/mobile-confirmation\.png\n$/);
  assert.match(section('source'), /- run: npm run check\n/);
  assert.match(section('source'), /- run: npm run test:ui -- --reporter=line\n/);
  assert.match(section('release-evidence'), /needs: \[source, dependencies, native-source, local-sandbox, native-build, native-service, decision-browser\]/);
}

test('private decision browser job is mandatory, pinned, and separate from normal production checks', () => validate(workflow));
test('governance rejects skipped, permissive, untrusted-entry, and disconnected browser gates', () => {
  validate(workflow);
  for (const changed of [
    workflow.replace('  decision-browser:\n', '  decision-browser:\n    if: false\n'),
    workflow.replace('  decision-browser:\n', '  decision-browser:\n    continue-on-error: true\n'),
    workflow.replace('  decision-browser:\n', '  decision-browser:\n    env:\n      TOKEN: fake\n'),
    workflow.replace('  decision-browser:\n', '  decision-browser:\n    permissions:\n      contents: write\n'),
    workflow.replace('timeout-minutes: 15', 'timeout-minutes: 150'),
    workflow.replace('retention-days: 3', 'retention-days: 90'),
    workflow.replace('if-no-files-found: error', 'if-no-files-found: ignore'),
    workflow.replace('include-hidden-files: false', 'include-hidden-files: true'),
    workflow.replace('factory-decision-visual/desktop-confirmation.png', '**/*'),
    workflow.replace('  decision-browser:\n', '  decision-browser:\n    working-directory: untrusted\n'),
    workflow.replace('node scripts/start-decision-ui-test-server.mjs --self-check', 'node downloaded-artifact.mjs'),
    workflow.replace('native-service, decision-browser]', 'native-service]'),
    workflow.replace('playwright test --config=playwright.decisions.config.ts --reporter=line', 'playwright test --config=playwright.decisions.config.ts --reporter=line || true'),
  ]) assert.throws(() => validate(changed));
});
