# Issue 31 stack reconciliation

Status: Source-equivalent draft preparation; remote checks and live acceptance pending. No released capability.

The immutable implementation `833da59ee47330cb59e5dc612361a39719679477` is reconciled onto actual issue 30 PR105 head `dafc7f716f60f774324ec5080ca9b8d2dbc575aa`. Original issue 31 planning tip `cf070b1a5ff03ef48076e5af3c49c54dc5a134a7` remains the second parent, with its issue plan preserved byte-for-byte. Corrected predecessor plans and contributor research guidance remain unchanged. The issue-only patch applies without product, test, schema or lockfile edits.

The [execution record](issue-031-execution.md) covers history-preserving cancellation and requeue, private reason storage in forward migration 0011, and independently reviewed composition of issues 29–31. Only claim, run-read, heartbeat, failure, cancellation and requeue ingress is activated. Submission/independent acceptance belongs to issue 35; artifact lifecycle belongs to issue 32. R3 approval records and approval endpoints remain unavailable; dormant approval pointers and synthetic compatibility fixtures are not live R3 decisions.

The original source checkpoint passed 813 Node, 957 Workers, 18 operator and 13 deployment-verifier tests. The aggregate was not green: protected local recovery CLI fixtures reported 8 passed and 18 failed, and browser assertions did not run because pinned Chromium was unavailable. Fresh reconciliation checks, independent source-equivalence review and exact remote CI are reported separately in the draft PR. Historical limitations are not retroactively erased by publication.

The owner permits continued MVP source work and stacked draft PR publication while live acceptance is deferred until after R4. This does not mark R1 issue 17 accepted, close issue 31, merge, deploy, provision credentials or release features.
