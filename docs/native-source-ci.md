# Native source regression in CI

Status: implemented source workflow; native conformance and live acceptance remain pending.

The `native-source` job in `.github/workflows/ci.yml` runs the existing
`npm run test:native:r2:source` command on every ordinary PR workflow. The
aggregate `npm run check` command does not include this Node test suite. A green
aggregate job alone therefore does not establish native-source test results.

The dedicated job uses the same pinned Node/npm versions, immutable checkout
and setup actions, `npm ci`, and read-only repository permissions as the other
source jobs. Its five-minute job budget includes dependency setup and the source
suite (the preceding exact local run took 46.79 seconds). It does not consume the
aggregate source job's existing thirty-minute budget or change per-test limits.
The conditional release-evidence job also waits for this source regression job;
its existing dispatch requirement and R1 evidence verifier remain unchanged.

No credential, deployment, protected-runtime ownership, filesystem ancestry or
input custody rule is relaxed. No temporary-directory relocation is configured.
Each test uses its existing platform admission checks and explicitly skips when
the environment is ineligible. Inspect actual passing/skipped counts: a skip is
not coverage, and the worker's nineteen locally blocked disk cases are not
retroactively passes merely because another CI job is green. Eligible runner
filesystem tests exercise synthetic source behavior, not authentic native CLI
or deployed acceptance. `test:native:r2` is not invoked by this job.

The workflow contract regression checks the bounded job, pinned runtime,
source-only invocation and dependency wiring. Changes to native source should
continue to carry their own focused tests and independent review.
