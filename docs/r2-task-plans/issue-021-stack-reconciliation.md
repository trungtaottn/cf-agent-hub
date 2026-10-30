# Issue 21 — actual predecessor and preserved branch reconciliation

Status: Reviewed contract source reconciled locally; draft publication and exact-head CI pending. No runtime or live acceptance claimed.

## Actual predecessor and original branch

The actual published #20 commit is `071ed110c0bab446ca25c20243c3234ecd71cc8f`, tree `94709bedd55c3be2ed7e7a56a020fbad7d9438ac`. This is the same source tree used by the earlier synthetic local base, not the synthetic commit itself. The published commit's exact Git bytes/hash were independently recovered from the authoritative commit object; no synthetic identity is presented as a published predecessor.

Read-only remote ref checks on 2026-10-27 confirmed #20 at that commit and the existing issue21 branch `docs/r2-021-plan` at `8f9009c8bb81fa47c3b2690b0e17d306a8ecb9bd`. The original issue21 commit and its tree `b6e4030f8a0328b0f0a3a4df4dcf443e68983db0` were reconstructed and hash-verified; its plan remains the exact published blob `c7cedf33c82be433cdfa86b88fc239866f94f13e`.

The coordinator independently confirmed successful #20 CI [run 40427807461](https://github.com/trungtaottn/cf-agent-hub/actions/runs/40427807461) before releasing the publication baton. That predecessor CI does not substitute for the eventual #21 head's own CI. #17 live acceptance is still deferred under the owner development amendment, not declared complete.

## Reconciliation evidence

A separate isolated local checkout integrated real #20 as first parent and the existing #21 branch tip as second parent. Its integration tree adds only the original issue21 plan to #20; current #20 common-authority and backup/recovery corrections are retained. Replaying the three reviewed input/import/search checkpoints produced tree `73fb32829952a2b70f5144863db6a6cb51ebd197`, byte-for-byte identical to the previously reviewed issue21 tree. This receipt is the only subsequent content addition. The original synthetic checkout and the separate issue22 snapshot are unchanged.

Local shallow boundaries only reflect unavailable older objects during isolated inspection; they do not rewrite either genuine parent commit or the remote history. Publication uses one issue-scoped integration commit with parents `071ed110c0bab446ca25c20243c3234ecd71cc8f` and `8f9009c8bb81fa47c3b2690b0e17d306a8ecb9bd`, then an expected-old-tip guarded, non-force update of the existing issue21 branch. No synthetic predecessor commit, force push or PR merge is part of that operation. The draft PR targets `docs/r2-020-plan`, not dev.

## Verification boundaries

The [contract amendment receipt](issue-021-contract-amendment.md) preserves the exact prior TDD, independent review and aggregate results, including local recovery CLI 8 passed/20 failed and aggregate exit1. Source-equivalent results can be reused for unchanged inputs, but metadata/ancestry reconciliation still receives fresh focused contract checks, docs/plan validation and independent diff review. The actual pushed head must receive its own CI/review before successor publication.

No import endpoint, database reconciliation, runtime search, padded cursor implementation, deployed authority, release or live recovery acceptance is implied. #23/#36/#37 still own the implementation activation gates recorded in the contract amendment. The user's no-merge/no-deployment constraints remain in force.
