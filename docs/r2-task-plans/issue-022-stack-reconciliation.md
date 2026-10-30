# Issue 22 actual predecessor reconciliation

Status: Local reconciliation completed; remote publication and exact-head CI pending. No released capability is claimed.

The original reviewed local #22 snapshot is commit `5b3982fdff3e5966b3469fb419a83e15ead1a2ce`, tree `c47859b86559198c3858566bfe504b91010e3837`, based on synthetic local #21 commit `889c945c97e98e3f3ad9559708a4ea6d4569466a`. That immutable checkout remains unchanged.

The actual published predecessor is draft [PR #96](https://github.com/trungtaottn/cf-agent-hub/pull/96), commit `a53bdfb58e524d93eea12110d5a17c5a4fc63876`, tree `b3384f2d3aa60d4b5c85c64b826bc2ad55e0704e`. This supersedes the earlier #21 head `6a0e3cc241d1b9845c3708a0fdb306b02f69078b` with the owner-requested research-before-coding line in `AGENTS.md` (blob `60ee890d5a15ba09b5dbd6f558e9df1918725eed`), retained exactly. Its product source is otherwise identical to the reviewed local #21 snapshot; its additive issue-021 stack receipt is retained. The controller reported exact-head CI success in run `40441078455`; that predecessor result is not #22 CI evidence. This issue's source/schema/tests and other reviewed content are carried forward byte-for-byte.

The existing `docs/r2-022-plan` tip is `3c400de97024885828b62f6f383f8b3fd1fea54b`, tree `5dd85c9eaf661f4bf3aba8f21c9468976f530d6a`. The original issue-022 plan blob `f861f1f599e15201c0f3476318af8ed68268bd37` is preserved exactly: the local fetched copy had acquired one extra trailing newline, removed during this reconciliation. No original plan prose changed.

The integration has the actual #21 commit as first parent and the existing #22 planning tip as second parent. Both commit objects were reconstructed from read-only GitHub metadata and accepted only after exact Git object SHA verification. The original #22 tree was reconstructed from verified blob/tree identities. Local shallow boundaries reflect unavailable historical ancestors; they do not alter actual parent identities. Synthetic local development commits are not publication parents.

Only the inherited owner-requested `AGENTS.md` line, this additive receipt, the retained #21 receipt, and removal of the accidentally appended plan newline differ from the original reviewed #22 source tree. Publication requires the controller's predecessor-CI baton, verified individual blob upload, SHA-only tree equality, fresh expected-ref comparison, and a draft PR targeting `docs/r2-021-plan`. No force push, merge, deployment, provisioning or auto-merge is authorized.

Focused contracts, generated checks, types and documentation are rerun on the reconciled checkout. Original application/source and independent-review results remain attributable to unchanged product bytes; new remote CI is required for the eventual published head. The known local recovery-CLI obstruction from the host-managed `/tmp/.git` marker remains unresolved and must not be bypassed.

The earlier local reconciliation `a12c98e4cffdcdc926549aaaccf7583e21749c39` / tree `8d36aacdf61579e98e865055a8b3a7ece8505806` remains immutable. This latest reconciliation changes only inherited `AGENTS.md` and this receipt relative to that checkout. The interrupted publication retained verified blob receipts but did not move the #22 branch; any reissued upload remains subject to its mandatory action-time gate. No prior cancellation is treated as approval.
