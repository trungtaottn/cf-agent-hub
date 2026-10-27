# Issue 29 local execution ledger

Status: Local implementation under verification; remote publication and live acceptance pending. No released capability.

## Authority and provenance

Live issue 29 and both comments were read on 2026-10-27. Its corrected pinned plan is commit 701500d030dbf78d24f09572f25c1d73992606c1; [historical issue plan](issue-029.md) is retained unchanged. The current [owner development amendment](owner-development-amendment-2026-10-26.md) supersedes the historical issue 17 start gate for local MVP development, not acceptance. Local predecessor is issue 28 HEAD 4677011e7332076827658063ca677af967b41572, tree c663894bf3f0b404f514de2cac082942e1818e44. Independent no-hardlinks clone has no origin and preserves predecessor history. Original issue branch reconciliation and exact remote stack/CI remain controller-owned. No remote write, merge, auto-merge, provisioning, real credential, deployment or Cloud Harness operation is authorized by this ledger.

Installed AgentKit CLI 2.19.0 and actual ak-vibe 1.4.1, plan, research, cook, code-review and docs workflows were read. Isolated intake, genuine source comparison, independent plan validation/red-team, bounded TDD and independent review precede local handoff. Remote shipping/review/CI remain paused at the controller's authority boundary, not reported complete. User delegated technical choices after evidence; no routine design question was fabricated.

## Design and source comparison

[Source research](../research/r2-claim-leases.md) compares pinned etcd revision-owned mutexes, Temporal current-run/record-version SQL checks and River database claim/rescue. Adopt durable generation and transactional conditional ownership; reject external mutex/session reuse, PostgreSQL lock translation, rescue, retry-budget expansion and additional scheduler ownership. No upstream implementation or dependency was copied.

The existing workspace transaction owns claim/WIP/task-local fence, runtime/credential/epoch binding, captured preexecution safety, task/run pointers, event/history, scheduler dirty marker and sanitized replay. The schema remains 9; migrations 0008 and 0009 are unchanged. Immediate scoped foreign keys require insert-run before attaching task pointers. Unknown classification uses the schema's all-null safety columns; a matching trusted rule captures its policy version, rule ID and evidence reference. Null is never permission to retry and later policy cannot retroactively classify an old attempt safe.

Claims and public run routes remain unavailable until issue 30's expiry/shared scheduler and issue 31's settlement/cancellation are integrated. Issue 32 owns artifacts separately. The internal getRun interface is scoped reading, not ingress activation. A dirty marker alone does not arm leases; production scheduling and successor transitions are not implemented here. Unknown/exhausted holds, cancellation, requeue, result submission/review, approvals and external execution remain outside this change.

## Plan and test-first gates

Two independent reviewers verified ten factual claims each and found the same missing run-event visibility integration. Accepted before coding: project-scoped current run-to-task visibility, complete current task-result visibility, exact event metadata binding and unknown producer rejection. CLI format validation first failed for missing phase files; actual AgentKit scaffolds were read and completed, then format passed. Semantic gates remained independent of that CLI result.

Closed unavailable scaffolds allowed meaningful tests before implementation. Claim suite: 20 collected, 19 missing-behavior failures and one approved-unavailable characterization pass. Lease suite: 30 missing-engine failures and one invalid fixture-name setup failure, not 31 behavior failures. The fixture name was corrected without weakening assertions. Real Worker entry and direct DO no-mutation characterization passed independently of the internal engine.

Initial implementation yielded 52 passes plus the one fixture-name error; all TypeScript projects passed. Independent review then found the current heartbeat reused claim/Ready eligibility and could incorrectly require tasks:claim after acquisition. A dedicated execute-only regression governs its narrow repair. Additional actual hash/fingerprint-await races produced 24 passes and two meaningful claim proof-before-resource failures, rather than attributing setup failures to security coverage.

## Verification and review status

Final exact-source checks, corrected security regression results, query measurements and independent review disposition are recorded after execution. Earlier counts above are checkpoints, not final acceptance. Known predecessor host limitations are the protected /tmp/.git recovery-output guard and unavailable exact pinned browser download; they must not be weakened or silently substituted. Schema 9 operational recovery remains owned by issues 39/43. Live acceptance is deferred by owner until after R4 and remains unperformed.

## Corrected security and least-authority checkpoint

The execute-only regression first failed with FORBIDDEN. Current execution eligibility now shares catalog, holds, policy tuple and assignment checks without borrowing Ready/claim's separate claim-capability requirement. Ready and new claims still require a coherent claim-and-execute credential. Two claim proof-order failures, one coherent-scope ordering failure and two heartbeat proof-order failures were reproduced before repair. Scope and runtime proof now precede protected resource disclosure; heartbeat cannot distinguish missing, visible and foreign-project targets using an invalid proof. A valid proof still cannot bypass current project restriction. RunRow now describes only columns actually selected; settlement must explicitly read private captured safety, not infer it from the public projection.

The corrected six-file focused run passed 86 tests. This includes actual proof hashing/fingerprint awaits, higher-epoch reconciliation, maintenance/revocation/project changes, both claim and heartbeat original-outcome replay after ended/expired attempts, heartbeat event-abort rollback and no public ingress mutation. The indexed WIP experiment uses 100 active expired attempts and 1,000 terminal attempts: threshold probes at limits 1, 10 and 100 read at most those limits, while full count does more work than the one-slot probe. Time-filtering incorrectly reports zero occupied slots. SQLite's query plan uses the existing runs_agent_status index; no migration is needed. These are source/Workers observations, not deployed performance or safe-retry evidence.

## Final local verification

Final `npm run check` exited 1 only at the unchanged host protected-output recovery CLI gate. Its preceding generated-contract, TypeScript, R1 contract, 813 Node, 818 Workers, 18 operator and 13 deployment-verifier checks passed. Recovery CLI again reported 8 passed and 18 failed under the existing /tmp/.git guard, including RECOVERY_INPUT_REJECTED/RECOVERY_OUTPUT_INVALID. No marker, test assertion, security permission or recovery boundary was changed. This is not a passing aggregate or operational schema 9 recovery receipt.

Fresh UI build and local runtime boot passed, with schema 9 and closed empty authority. Docs validator passed 111 Markdown documents, 169 JSON files, 18 schemas, 61 operations, 119 components and 101 mapped fixtures; plan validator passed 636 checks. No dependency/lock or migration changed. Exact browser tests were not run: this engine change adds no browser UI, and the predecessor's exact pinned Chromium installation remained unavailable after official invalid-ZIP download attempts. No executable substitution or new installation attempt is claimed. No live or post-R4 acceptance ran.

Two independent final source reviews report zero remaining Critical or Important findings; the implementation reviewer also reports zero remaining Minor. Reviewed core hashes and the full red/green command logs are retained in the local handoff manifest. The scoped simplifier recommended only the constant-valued WIP probe, which was adopted and checked. Original pinned issue-plan blob is exactly 356dabecbed7b5b890b6e960c03435139bc29b5d. Local patch publication remains controller-owned; no GitHub write or remote CI result is implied.

AgentKit journal creation and validation succeeded. Its YAML-frontmatter original is retained in the external local handoff journal directory rather than changing this repository's H1/status documentation convention. AgentWiki publication was skipped. The final handoff records exact HEAD, tree, base, issue-only patch, source/check hashes and unresolved publication authority separately from this in-repository ledger.
