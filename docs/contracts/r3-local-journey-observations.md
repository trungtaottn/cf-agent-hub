# R3 local command-source journey observations

Status: Partial source-test coverage using local synthetic fixtures; acceptance pending, no released artifact. Not deployment verification or a supported product action.

[`test/acceptance/r3-request-journey.test.ts`](../../test/acceptance/r3-request-journey.test.ts) exercises six fixed cases through the existing domain commands and recovery implementation:

- request, original-run pause, exact replay, changed-intent conflict, and paused-owner denial;
- synthetic human approval, three-version rejection, replay, and revoked-session denial;
- synthetic human rejection, replay, and changed-reason conflict;
- capture and restore of command-created pending decision history;
- capture and restore of command-created rejected decision history;
- exact recovery-chunk retransmission, changed-byte denial, and continuation of the same restore job after eviction.

Initial task/runtime setup uses existing test helpers. Decision, approval, and lifecycle history is created by commands rather than inserted as claimed successful history. The fixture descriptor is private to test composition; the production action registry remains empty. These cases do not execute an approved fresh claim or a complete two-agent, independent-human journey.

## What an observation means

The closed test-only observation records measured SQL changes, event and outcome correlation, immutable decision identity, and streamed artifact byte hashes. Its classification is always `local-workers-synthetic-fixture`, with `acceptance_eligible: false`. Synthetic sessions, local SQLite, and emulated object storage do not establish real human identity, independent deployed actors, or provider provenance.

Request and human-decision steps correspond to individual domain command attempts. Capture and restore steps summarize multiple real recovery operations; their correlation identifies the last actual persisted operator operation. They are not single HTTP requests or atomic transactions. Digest equality checks content integrity, not the authenticity or origin of a submitted observation. Git/build identity and independently retained execution receipts are not provided by this test artifact.

Private no-write checks compare bounded complete authority/domain rows in memory, including same-count mutations. Raw rows, credentials, session material, and input payloads are not exported or included in assertion diffs. Row and raw-byte limits fail closed before full private-row materialization. Artifact measurement uses a bounded stream, not whole-body accumulation.

## Recovery boundary

Restored targets remain in the restored maintenance state. The cases assert retained decision/history and artifact bytes, stored runtime/session invalidation, and actual rejection of old identities at that admission barrier. They do **not** prove post-resume authentication behavior or execute retirement, probe, cutover, or resume. A changed chunk is rejected without manufacturing a failed-job state; existing job/chunk history is retained and the same job continues.

The [decision contract](r3-decisions.md), [capability matrix](../feature-matrix.md), and release evidence remain separate authorities. Passing these source tests does not close the complete integrated journey, establish full R3 verifier coverage, satisfy formal acceptance, or authorize release.
