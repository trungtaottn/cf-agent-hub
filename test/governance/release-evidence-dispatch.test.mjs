import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, chmodSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const step = workflow.slice(workflow.indexOf('      - name: Verify actual evidence without publishing'));
function dispatchScript() {
  const match = step.match(/^        run: \|\n((?:          .*\n?)+)/m);
  assert.ok(match, 'Evidence dispatch must use the checked multiline shell boundary');
  return match[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
}
function execute(round) {
  const directory = mkdtempSync(join(tmpdir(), 'cfhub-dispatch-'));
  try {
    const capture = join(directory, 'argv.json');
    const recorder = join(directory, 'record.mjs');
    writeFileSync(recorder, 'import {writeFileSync} from "node:fs"; writeFileSync(process.env.CAPTURE,JSON.stringify(process.argv.slice(2)));\n');
    const launcher = join(directory, 'node');
    // Run the current real Node executable, not PATH's recording launcher again.
    writeFileSync(launcher, '#!/bin/sh\nexec "$REAL_NODE" "$RECORDER" "$@"\n');
    chmodSync(launcher, 0o755);
    const evidence = 'validation/releases/a receipt;$(not-a-command)/evidence.json';
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', dispatchScript()], {
      encoding: 'utf8', env: {...process.env, PATH: directory + ':' + process.env.PATH,
        REAL_NODE: process.execPath, RECORDER: recorder, CAPTURE: capture,
        RELEASE_EVIDENCE_ROUND: round, RELEASE_EVIDENCE_PATH: evidence},
    });
    assert.ifError(result.error);
    return {status: result.status, stderr: result.stderr, evidence,
      args: existsSync(capture) ? JSON.parse(readFileSync(capture, 'utf8')) : null};
  } finally { rmSync(directory, {recursive: true, force: true}); }
}

test('manual selector is closed to R1/R2 and keeps R1 default', () => {
  const input = workflow.match(/^      evidence_round:\n((?:        .*\n)+)/m)?.[1];
  assert.ok(input, 'evidence_round input is required');
  assert.match(input, /^        type: choice$/m);
  assert.match(input, /^        default: R1$/m);
  assert.match(input, /^        required: true$/m);
  const options = [...input.matchAll(/^          - (.+)$/gm)].map(m => m[1]);
  assert.deepEqual(options, ['R1', 'R2']);
});

test('input values cross the environment boundary, never shell expression interpolation', () => {
  assert.match(step, /RELEASE_EVIDENCE_ROUND: \$\{\{ inputs\.evidence_round \}\}/);
  assert.match(step, /RELEASE_EVIDENCE_PATH: \$\{\{ inputs\.evidence_path \}\}/);
  assert.match(step, /^        shell: bash$/m);
  assert.doesNotMatch(dispatchScript(), /\$\{\{/);
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch' && inputs\.evidence_path != ''/);
});

for (const round of ['R1', 'R2']) test(`${round} invokes the existing verifier with literal arguments`, () => {
  const result = execute(round);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.args, ['scripts/verify-release.mjs', '--round', round, '--evidence', result.evidence]);
});

test('invalid and injection-shaped rounds fail before any verifier invocation', () => {
  for (const round of ['', 'R3', 'R4', 'r2', 'R1 R2', 'R2; echo injected', '$(echo R2)', 'R2\nR1', '--help']) {
    const result = execute(round);
    assert.equal(result.status, 2, `round ${JSON.stringify(round)}: ${result.stderr}`);
    assert.equal(result.args, null, 'rejected round must not invoke verifier');
  }
});
