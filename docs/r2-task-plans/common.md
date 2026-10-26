# R2 Common Agent Pickup Contract

Status: Implementation pending; no runtime task is ready to cook.

## Authority and base

These are plan-only branches authorized by the owner, one per existing issue19–50. Candidate baseline: 4c8e487eee7b8a3d4f76562ecca2369819aa0a9a (PR93); dev at analysis: fcbe6139c65f9baafee9804a5c50867a1fcc0968. They do not contain accepted predecessor implementations. Before execution create/reconcile a work branch from then-current accepted dev and integrate all hard predecessors; do not implement directly against stale planning code. Read AGENTS and live issue state. No labels/body edits, automatic PR, merge, deployment or release are authorized by plan publication.

#17 Verified R1 is a HARD start gate for runtime and #20–23 contract implementation. #19 is owner-directed planning only. #11 embedded tooling findings and #10/#14–18 live gates remain unresolved. Source CI, a plan branch, review or merge is not acceptance.

## Canonical design and invariants

Read docs/superpowers/plans/2026-10-23-r2-durable-work.md and owning OpenAPI/security/task/recovery docs. Preserve historical approvals. One workspace DO, one synchronous SQL transaction for domain/event/outbox/sanitized replay; no async hook or second authority engine. Current session/credential/proof and maintenance generation rechecked after every await. 60-second lease, 20-second suggested renewal, 90-second presence; presence is not lease. Submit is Review; independent current-authority acceptance is Done. Unknown/exhausted holds never auto-retry. R3 approval routes remain unavailable. Raw secrets never persist in normal replay/log/export.

## Shared proposed decisions


| ID | Decision | Recommendation, not approval | Blocking consumers |
| --- | --- | --- | --- |
| D1 | Higher-epoch handling of human-managed credentials absent static bundle | Add credential provenance in the one registry; retain dynamic metadata but revoke dynamic credentials/proofs on epoch advance and restore; fresh human issuance required. Preserve static current-ledger behavior; advance retained active agent epoch without resurrecting archived state or granting scopes, then test fresh issuance/runtime succeeds while old authority fails. Review security/UX impact explicitly. | #20/#22 freeze; #24–26/#43 |
| D2 | Trusted product artifact/recovery binding map | Distinct product ARTIFACT_BUCKET and existing RECOVERY_BUCKET; RecoveryWorkspace exposes trusted artifactBucket, server-side copy under existing protocol; absent binding fails closed. No provisioning implied. | #22/#32/#39/#43/#46 |
| D3 | Protected CLI secret backend and supported OS matrix | Select the supported OS/threat model first: phase04 proposes a narrow POSIX owner-only-file pilot (access control, not encryption/keychain) or an OS credential-vault adapter for stronger/cross-platform guarantees. Neither is approved; never silently fall back after secure storage failure. | #41/#44/#48 |
| D-HISTORY | Full historical result read seam | Current Task.result/getRun/events do not expose previous result details after requeue. #20/#23 must freeze a public operation/schema before #27/#35 query/projection and #42 full history. Show unavailable honestly; do not narrow completion criteria or invent private routes. | #42/#49 full acceptance |
| D-JOURNAL | CLI journal storage cap/retention | Select explicit reviewed values; unresolved operations never silently evict, block new admission at limit. Local retention does not extend server replay guarantees; expired/unknown windows require no-send reconciliation. | #41/#44 |
| D4 | Final planning-branch base | Publication is now authorized as32 separate docs/r2-NNN-plan branches and corresponding issue comments, not32 PRs. Pin one base and reconcile accepted dev before runtime pickup. | Source-drift review; no additional publication approval needed |

These are not invented approvals or a request to redesign already-fixed constants. Detailed canonical policy limits, catalog semantics, import bounds and search rules are retained. D1/D2 are gaps revealed by current code; they cannot be silently settled by a coding agent.


## Whole-system issue/dependency index

Hard blocks start; interface must be frozen before consumption; evidence blocks acceptance. Interface review can occur before successor implementation. No epic edge creates a cycle.

| Issue | Hard | Interface | Evidence |
| --- | --- | --- | --- |
| #19 | #7 | #9 | — |
| #20 | #17, #19 | — | — |
| #21 | #17, #19 | — | — |
| #22 | #17, #19 | — | — |
| #23 | #17 | #20, #21, #22 | — |
| #24 | #23, #19 | — | — |
| #25 | #24 | #20 | — |
| #26 | #25 | #24 | — |
| #27 | #26 | #20, #24 | — |
| #28 | #27, #25 | #20 | — |
| #29 | #26, #28 | #27 | — |
| #30 | #29 | #20 | — |
| #31 | #30 | #27 | — |
| #32 | #31 | #26, #24 | — |
| #33 | #32 | #30 | — |
| #34 | #32 | #27, #25 | — |
| #35 | #33, #31 | #32, #29 | — |
| #36 | #35, #34 | #21 | — |
| #37 | #27, #31 | #21, #36 | — |
| #38 | #37, #34 | #23 | — |
| #39 | #37, #33 | #22, #24 | — |
| #40 | #36, #37, #38, #34 | — | — |
| #41 | #38 | #26 | — |
| #42 | #38, #35 | #36 | — |
| #43 | #39 | #31, #26 | — |
| #44 | #41, #38 | #34 | — |
| #45 | #42 | #38, #35 | — |
| #46 | #43 | #39, #19 | — |
| #47 | #17, #19 | #22, #38 | — |
| #48 | #44 | — | #40 |
| #49 | #46, #47 | — | #17, #40, #48, #45 |
| #50 | #49 | — | — |

## Shared-file ownership

#23 integrates canonical OpenAPI/generators/auth/event/cursor/router/test discovery after #20–22 review. #24 alone owns next-unused migration (0008 only if still7), schema-version and complete table registry. #25 lifecycle follows that sole registry. #30 extends the existing scheduler/alarm; no competing scheduler. #32 owns product artifact binding after #22 freeze. #38 owns common client transport. #39 then #43 own recovery capture/restore; #46 consumes same operator lane. One writer per shared file; parallel agents use isolated worktrees and send shared patches to integrator.

## Verification and review

Every implementation task begins with its named failing assertions under the correct runtime, then minimal green change, focused nonzero collection and aggregate regression. No --passWithNoTests. #23's explicit matrix separates Node contracts/CLI/release-evidence, Workers domains/isolation/durable-work/catalog, operator tests and dedicated live native conformance. Record exact source/tree/lock SHA, command, runtime, exit/count/assertions and reviewer. Source/local fixtures are not live acceptance. Stop after one or two bounded subtasks for independent review.

## Handoff

Report current base/HEAD, live issue gates, unresolved decisions and exact files before edits. If blocked, return blocker evidence without implementing. When authorized and eligible, implement only the selected issue. Return scoped commit, focused/full checks, review findings and remaining evidence gates.

## Approved review corrections — 2026-10-26

The owner approved complete immutable CLI request/principal binding, conservative retention-aware replay, historical-effect reconciliation/cutover before explicit shared-gate resume followed by fresh work, and immutable historical evidence links. Only these plan corrections are approved, not D1/D2/D3/D-HISTORY/D-JOURNAL, runtime implementation or release. Reviewed dev 7ab5cbf90ace18bbdce87db6804da14da1f92b9e has the same tree as candidate4c8e487. Typed dependencies and hard #17 remain. Post-fix independent review is pending; original receipts are historical, not approval of changed bytes.

## AgentKit workflow alignment (W1)

Repository AGENTS.md and the current issue remain authority. Inspect actual installed AgentKit CLI/version/help and available skill files; read the applicable ak-plan red-team/validate workflow before planning. CLI plan parse/validate checks format, not semantic review or owner approval. Record exact plan/source hashes, source-evidenced findings, user decisions and a whole-plan consistency sweep; preserve unresolved blockers. Only after explicit implementation authorization and all gates clear, read the actual installed ak-cook workflow and follow its applicable bounded task/TDD steps. Use installed ak-code-review for independent review and ak-debug for diagnosed failures when available; if unavailable, report the gap rather than invent commands. Never enable automatic execution flags, emulate unsupported ak-team, assume hooks are active, or create another transaction/workflow authority. Existing one-or-two-subtask handoffs, nonzero test collection and truthful evidence requirements still apply. W1 records the owner's requested workflow synchronization, not a newly discovered defect or implementation permission.
