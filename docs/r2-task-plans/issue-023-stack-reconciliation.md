# Issue 23 stacked publication reconciliation

Status: Reviewed local source prepared for a draft stacked PR; remote CI and live acceptance pending. No released capability is claimed.

## Exact sources and history

The immutable local implementation is `3ea0fbf9a2d541919b611ac1e299b069e0bbb2c2`, tree `51597572b2070e726f0ea6af54b0bea678f24ee5`, on synthetic local #22 ancestry. Its original [execution receipt](issue-023-execution.md) remains unchanged, including the 8-pass/20-fail recovery CLI limitation and the explicit aggregate failure.

This reconciliation starts from actual #22 draft [PR #97](https://github.com/trungtaottn/cf-agent-hub/pull/97), commit `b18d74cf357fed6c02b5a5300adf084991b26203`, tree `e32570f367c973f040915929be68bbf46c5b8302`. It retains the exact inherited owner-requested research instruction in `AGENTS.md`, #21/#22 stack receipts, and original #22 plan bytes. The #22 remote run was still pending at preparation; predecessor CI is not successor CI evidence.

The existing #23 branch head is `12e38918f9e79b89774102e53a9121986b7de913`, tree `fdcaa1b0e20363f1d37bfb0f93b7cb346ee50b01`. Preserve it as the second parent; the first parent is the actual #22 commit above. Publication must be fast-forward on `docs/r2-023-plan` with expected-old-ref protection, targeting `docs/r2-022-plan`. No force push, rewritten planning history, merge, deployment, credentials or Cloud Harness operation is authorized.

## Equivalence and verification

No product source, generated output, schema, test, runtime configuration, package or lock bytes differ from the reviewed local #23 snapshot. Only inherited `AGENTS.md`, predecessor receipts, exact #22 plan newline preservation and this additive reconciliation receipt differ. No new feature is implemented during reconciliation. Prior official Ajv/Vitest research and benchmark evidence remains in the execution receipt; the inherited research instruction is retained without claiming it existed before its actual introduction.

An isolated `--no-hardlinks` clone of the complete local #23 snapshot was used. The initial attempt to clone the reconstructed #22 repository could not traverse one locally absent historical parent; no remote operation occurred. Exact remote Git commit/tree objects were reconstructed from read-only GitHub metadata and verified by their hashes, using independently copied objects, not fabricated history. The original checkouts remain immutable.

Reconciliation checks and independent review are recorded in the publication manifest. Generated freshness, TypeScript and focused Node/Workers gates must pass on these exact bytes. Real nonzero runtime collection from the original implementation remains valid only because selectors and tests are byte-identical. Remote ref/PR creation waits for the controller's terminal predecessor-CI handoff, followed by exact successor-head CI and PR review. Live acceptance stays deferred until the owner's post-R4 stage, not waived.

## Predecessor handoff and focused result

The controller subsequently confirmed #22 run `40464243988` succeeded at exact head `b18d74cf357fed6c02b5a5300adf084991b26203`; its synthetic merge `e8c533d5` has the same tree. Source and dependency jobs succeeded; release evidence was skipped. PR #97 remains draft and unmerged. This clears successor publication sequencing, not #23 CI or live acceptance.

On the reconciled #23 bytes, generated freshness and all TypeScript checks passed; focused Node tests passed 28 tests across 3 files and focused Workers boundary/idempotency tests passed 20 across 2 files. Documentation and historical plan checks passed. No recovery CLI rerun or aggregate-pass claim is made in this reconciliation; the original environment limitation remains documented. Publication still requires its separate action-time permission gates.
