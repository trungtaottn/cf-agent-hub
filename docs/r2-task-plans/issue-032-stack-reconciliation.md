# Issue 32 stack reconciliation

Status: Source-equivalent draft preparation; remote checks and live acceptance pending. No released capability.

The immutable implementation `46f53258936a3a954bb82097625a13296da3e25a` is reconciled onto actual issue 31 PR106 head `1825ba118a7d0fb1cecdb1a26c49c94acab356b1`. Original issue 32 planning tip `bfa9d861373f890709922b3aec068df8d955aa0f` remains the second parent. Its plan content is retained with only the already-reviewed redundant EOF blank normalization recorded in the [execution record](issue-032-execution.md). Corrected predecessor plans and contributor research guidance remain unchanged. The issue-only patch applies without product, test, schema or lockfile edits.

The implementation owns immutable artifact stage/reservation/upload/commit, authorized committed metadata/list/download and the shared committed-reference visibility helper. Forward migration 0012 adds the reviewed admission identity columns and indexes. Public artifact ingress remains closed until issue 33 independently reviews cleanup and scheduler composition; current-schema generation-aware recovery remains unavailable until its owning later tasks. No product bucket, credentials or deployment is provisioned by publication.

The original source checkpoint passed 814 Node, 1025 Workers, 18 operator and 13 deployment-verifier tests. The original aggregate was not green: protected recovery CLI fixtures reported 8 passed and 18 failed, and no browser assertions ran because pinned Chromium was unavailable. Fresh reconciliation checks, independent source-equivalence review and exact remote CI are reported separately in the draft PR. The original dependency audit applies only to its unchanged snapshot; no fresh audit is claimed.

The owner permits continued MVP source work and stacked draft PR publication while live acceptance is deferred until after R4. This does not mark R1 issue 17 accepted, close issue 32, merge, deploy, release a capability or enable unfinished routes.
