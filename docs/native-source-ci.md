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

## Observed hosted-runtime limit

The first selected job on `88e729e` ran 529 passing tests and one failing positive
process fixture, with no skips. All nineteen previously locally blocked input
filesystem cases executed successfully. A test-only diagnostic on `50a61c2`
then recorded 533 passes and the same failure: the setup-node executable and
six ancestor levels were group/world writable under the existing custody
predicate, despite acceptable ownership. Synthetic receipt and entry directories
passed their predicates. Both failed runs remain evidence; neither is called green.

The process fixture now checks executable and ancestor ownership/mode before its
positive case. An ineligible runtime has a separate negative assertion requiring
rejection before spawn and no receipt creation, while the positive case is
explicitly skipped. Missing diagnostic metadata fails rather than skips. On an
eligible runtime the original positive execution assertions remain unchanged.
No runner permission, executable copy, temporary root or product guard is changed.
A successful source job with this skip still does not prove positive process
custody or native conformance.

## Local sandbox execution

A separate five-minute `local-sandbox` job executes
`node scripts/test-native-r2.mjs --local-sandbox` on the same pinned runtime and
locked dependencies. The reviewed local run completed in 12.55 seconds; the job
budget includes dependency installation without changing the command's existing
two-minute deadline. This runs two fresh workerd/SQLite/emulated-R2 rounds, with
real task, artifact and Done state, authorization negatives and closed cleanup.
The general source job includes the fixture helper tests; `native-source` includes
the local entry, lifecycle and report tests. The conditional release verifier
waits for all three source jobs and dependencies. No deployment is introduced.

This is local sandbox integration, not the protected native adapter, a built CLI
subprocess, network TLS or full native conformance. Positive process custody
remains separately unproven on an ineligible hosted runtime. Remote results for
each newly published head remain pending until observed; historical local passes
do not imply that the new CI job has passed.

## Browser revocation fixture ordering

The transport checkpoint `c75c98f` passed its native-source, local-sandbox and
ordinary Node/Workers gates, but its browser run recorded 60 passes and one
30-second timeout in the revocation-between-render-and-command scenario. No
trace artifact was available; the exact timed-out await was not established.
Source inspection found that visible dialog and editable reason precede the
asynchronous authority/task preparation. Revoking before Confirm becomes enabled
can test preparation invalidation instead of the intended post-preparation command.

The fixture now observes enabled Confirm before real session revocation, requires
an actual cancel POST authentication denial, and checks both access status and
cleared textarea value. Fixed phase names identify a future stalled boundary
without logging credentials or reason content. No production behavior, force
click, retry or timeout change is introduced. The revised browser result remains
pending until exact-head remote CI completes; this source ordering correction is
not proof of the original timeout's exact cause.

## Observer service local integration — 2026-10-29

The existing five-minute local-sandbox job runs the observer-local command after
the original sandbox command, serially on the same pinned runtime. The new command
exercises seven restricted real workerd reader profiles, signed original delivery
and owned cleanup; pure native-source tests alone do not select this integration.
The job cap, per-operation limits, read-only workflow permissions and custody guards
remain unchanged. Actual CI execution must be checked before claiming coverage.
This remains synthetic local source assurance, not installed/native acceptance.
