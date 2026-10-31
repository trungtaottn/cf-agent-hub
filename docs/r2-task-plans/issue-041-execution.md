# Actual issue41 — durable local CLI groundwork

Status: Local source implementation and independent review complete; serial verification recorded below. Live acceptance and release remain pending; this is not aggregate-green or an installed CLI.

## Authority and exact scope

Read live issue41 and its latest corrected pinned plan at `1082486128e9dde328aad2d98232dcc0bf5e6bec`. The actual task is **Persist CLI mutation intent and runtime proofs before dispatch**, not an entire native-command subsystem. Local predecessor40 is `0bc60420a1142e59f51e7a497d58c315d21cf28c`, tree `acab8e7b2e030d24a254013c7467a2071cb97569`; its checkpoint verifier passed before a no-hardlink/no-remote isolated clone. Original dependency/npm/Git files were hash/inode/symlink checked. Node24.22.1/npm11.19.1, own XDG, metrics off; Workers SQL alone uses task-owned temporary storage. Default recovery fixtures/guards are untouched.

Owner delegation permits local MVP research, technical decisions, TDD, implementation and review; historical plan-only #17 pickup wording is not silently rewritten as acceptance. Integrated acceptance remains after R4, root owns GitHub publication and its tool gates, and no merge/deploy/Cloud Harness/real credential setup is authorized here. Predecessor40's blocked independent security signoff remains blocked and is not replaced by these new41 reviews.

## Decisions and source

[ADR0009](../adr/0009-r2-cli-local-durability.md) records D3/D-JOURNAL, accepted threat model, local-filesystem policy, replay limits and initial-unbound-enrollment clarification. [Research](../research/r2-cli-storage.md) records primary GitHub/SQLite/OS comparisons and the limited synthetic benchmark.

- Separate protected SQLite journal/provider stores, exclusive create/open, current ownership/mode/link/inode checks, closed schemas, DELETE+EXTRA synchronization and immediate transactional CAS.
- Immutable complete semantic request, authenticated principal/provider binding, keyless-before-generation creation, same-key attachment and first stamp before fetch. Bounded sensitive local history; uncertainty never silently settles or evicts.
- Conservative suspend-aware process clock. Actual dispatch resamples after SQLite/proof/provider work; already-dispatched restart replay is unsupported/no-send rather than guessed from wall time or boot ID.
- Exact actual-lease one-time capture with staged/active proof, protected finalizer, durable slot/generation/provenance/runtime reopen and explicit rotation. Native remains Node-free and preserves private generic-provider receipts.
- Explicit protected initial EnrollmentAttempt with null principal, durable consumed mark and store-unique key; no server replay to recover proof. DurableMutations composes ordinary JSON and enrollment intent with the existing one transport/map; no hidden enrollment/retry/new key.
- Public transport semantics, server OpenAPI, package/lock, migrations1–15, frozen V1/schema8 and current capture-only recovery contracts remain unchanged. CLI parser/distribution, real setup and raw-file upload replay remain separate issue44 work.

## Evidence and review

Actual installed AgentKit ak-vibe1.4.1, plan2.2.2, cook2.5.1 TDD, research and code-review workflows were read/used. The CLI created and validated a local two-phase plan and technical journal. No invented ak-vibecode executable, active-hook claim or AgentWiki publication is made.

Collected behavioral REDs preceded request/capture/guard/proof/coordinator implementation. Journal90 focused tests include actual child SIGKILL at durability windows, concurrent different-key winner, hot rollback recovery, real SQLITE_FULL, corrupt/schema/path/mode/link denial and bounded admission. Fsync error injection and filesystem policy branches are synthetic fault seams, not hardware failures. Provider28 focused tests include killed staged/activated capture, exact protected reopen, binding/lease/proof swaps, explicit rotation and bounded retained enrollment attempts. Native review initially reproduced unhandled asynchronous hook failures, late finalizer cleanup and a wrong-runtime-path proof; each was repaired and independently rechecked. The later one-time-proof request-ID/metadata reflection finding has its own RED/GREEN and review addendum.

The process integration tests exercise synthetic native enrollment with a durable attempt, SIGKILL/reopen, then a journaled claim through actual provider/proof/transport hooks. The lost-success cases invoke actual schema1–15 and `cleanupCompletedOutcomes`: exact24h retains outcomes, +1 permits legal removal, but a reopened unproven client sends nothing and retains intent/key/body. The receiver uses a synthetic transaction/effect record, not a claim of complete Workers ACL/domain or deployed-native acceptance.

Independent reviews inspect this new diff's journal/filesystem, native callback/dispatch, provider/coordinator boundaries separately with exact file hashes. Review-driven fixes also include unresolved error retention, tmpfs rejection, SQLite schema-prefix wildcard correction, slot-generation0 compatibility and fresh-clock validation after a real competing writer wait. Optional simplification notes do not replace correctness or security review.

## Verification status

Final serial receipts are retained in the local checkpoint logs:

| Gate | Observed result |
|---|---|
| Full Node | 1,131 passed / 46 files, including 154 added tests |
| Full Workers | 1,615 passed / 106 files |
| Operator / deployment verifier | 18 / 13 passed |
| Generated / bindings / TypeScript / R1 | All pass, including all five TypeScript projects |
| UI build / runtime boot | Pass; schema15 and empty authority closed |
| Docs / plans | 138 Markdown + 170 JSON; plans636 checks, pass |
| Aggregate `npm run check` | Exit1 at unchanged recovery CLI guard; not green |
| Recovery CLI | 8 passed / 18 failed; protected default `/tmp/.git` guard |
| Browser | 34 collected; 1 launch failure / 33 not run / 0 assertions; Chromium1248 absent |

Workerd stream-cancellation diagnostics and the browser out-of-test error remain in the logs; they are not omitted from the receipt. Initial missing Python-validator dependencies and baseline-status wording failures are retained; the final validators use independently hash/inode-verified copies of the existing pinned dependencies, not a new install. Independent final reviews cover the 31 changed code/test/config/doc paths; no remaining Critical/Important issue41 finding was established. This does not replace the blocked predecessor40 security signoff.

Inherited non-passes remain explicit: recovery CLI protected default temporary-path guard, missing exact Chromium1248 browser runtime, and fresh dependency audit policy denial (no attempt or alternate route). Historical audit attribution is not a current audit. No source test establishes actual suspend/reboot, hardware power loss, persistent host/container backing, ext-family/XFS hardware or live account conformance. There is no aggregate-green or release/acceptance claim.
