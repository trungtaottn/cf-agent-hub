# Issue 30 stack reconciliation

Status: Source-equivalent draft preparation; remote checks and live acceptance pending. No released capability.

The immutable implementation `4ae6443fbd74cbb68c643291aeca03021a2d1a8b` is reconciled onto actual issue 29 PR104 head `f7b0255badc24c5c4cb7049317c74110615da001`. Original issue 30 planning tip `8b9ca0b026f95d8dff19530a334ab56309b6460e` remains the second parent. Existing corrected predecessor plans and contributor research guidance remain unchanged. The issue-only source patch applies without product, test, schema or lockfile changes.

Implementation and measured index amendment are documented in [execution](issue-030-execution.md) and [research](../research/r2-failure-expiry.md). Index-only migration 0010 and split bounded outbox queries preserve existing rows and SQLite ordering. Safe retry uses captured policy only; unknown outcomes and exhausted budgets remain holds. Public claim/fail/run ingress remains closed until issue 31 composes cancellation/settlement.

The original aggregate passed 813 Node, 891 Workers, 18 operator and 13 deployment-verifier tests, then failed protected recovery CLI checks. The corrected CLI consumer still reported 8 passed and 18 failed in this host. Local browser assertions were not run because pinned Chromium was unavailable. These limitations are not erased by publication. Fresh reconciliation checks and independent source-equivalence review are attached to the draft PR; exact remote CI is reported separately.

The owner permits continued MVP source work and stacked draft PR publication while live acceptance is deferred until after R4. This does not mark R1 issue 17 accepted, close issue 30, merge, deploy, provision credentials or release features.
