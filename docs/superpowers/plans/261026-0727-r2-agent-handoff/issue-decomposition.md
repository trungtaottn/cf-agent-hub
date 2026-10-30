# R2 Issue Decomposition

Status: Planning pending review; all runtime implementation remains blocked.

## Existing issue system, not duplicate tickets

Epic #4 owns32 child issues (#19–50), mapping all12 original R2 tasks. Each is already independently rejectable/reviewable. This bundle deepens agent execution contracts rather than creating superficial microtasks. Retain issue numbers, titles and labels; stale source claims are explained additively in task plans/comments. No issue body or label changes are implied.

A task may contain several red/green checkpoints when one invariant needs them (for example credential issuance plus replay-safe secret handling). Those checkpoints are subtasks of the same issue, not new readiness gates or independent branches.

## Complete inventory and typed dependencies

| Issue | Independently reviewable deliverable | Detailed contract | Predecessors | Current pickup |
| --- | --- | --- | --- | --- |
| #19 | Amend the R2 implementation plan against the published R1 interfaces | [Phase 1](phase-01-start.md) | hard: #7; interface: #9 | Planning authorized; review pending |
| #20 | Amend execution policy, catalog lifecycle and R2 scope contracts | [Phase 2](phase-02-identity-storage.md) | hard: #17; hard: #19 | BLOCKED |
| #21 | Specify bounded import plans and confidential literal search | [Phase 4](phase-04-clients-ui-import-search.md) | hard: #17; hard: #19 | BLOCKED |
| #22 | Define V2 recovery byte coverage and V1 compatibility | [Phase 5](phase-05-recovery-evidence.md) | hard: #17; hard: #19 | BLOCKED |
| #23 | Extend canonical R1 boundaries and discover R2 verification files | [Phase 2](phase-02-identity-storage.md) | hard: #17; interface: #20; interface: #21; interface: #22 | BLOCKED |
| #24 | Migrate R1 identity and the complete R2 storage boundary | [Phase 2](phase-02-identity-storage.md) | hard: #23; hard: #19 | BLOCKED |
| #25 | Implement human-authorized agent and native credential lifecycle | [Phase 2](phase-02-identity-storage.md) | hard: #24; interface: #20 | BLOCKED |
| #26 | Enroll credential-bound runtimes and separate presence from leases | [Phase 2](phase-02-identity-storage.md) | hard: #25; interface: #24 | BLOCKED |
| #27 | Implement versioned task metadata, eligibility and authorized reads | [Phase 3](phase-03-durable-execution.md) | hard: #26; interface: #20; interface: #24 | BLOCKED |
| #28 | Apply version-bound catalog archive and remap plans atomically | [Phase 3](phase-03-durable-execution.md) | hard: #27; hard: #25; interface: #20 | BLOCKED |
| #29 | Enforce atomic claim, WIP, fences and execution lease renewal | [Phase 3](phase-03-durable-execution.md) | hard: #26; hard: #28; interface: #27 | BLOCKED |
| #30 | Settle failed and expired attempts without losing uncertainty | [Phase 3](phase-03-durable-execution.md) | hard: #29; interface: #20 | BLOCKED |
| #31 | Cancel and requeue tasks with preserved holds and history | [Phase 3](phase-03-durable-execution.md) | hard: #30; interface: #27 | BLOCKED |
| #32 | Implement immutable artifact stage, upload, commit and authorized download | [Phase 3](phase-03-durable-execution.md) | hard: #31; interface: #26; interface: #24 | BLOCKED |
| #33 | Reconcile expired artifact intents and orphans without deleting committed bytes | [Phase 3](phase-03-durable-execution.md) | hard: #32; interface: #30 | BLOCKED |
| #34 | Enable task and committed artifact references in existing messages | [Phase 3](phase-03-durable-execution.md) | hard: #32; interface: #27; interface: #25 | BLOCKED |
| #35 | Submit results and require independent current-authority acceptance | [Phase 3](phase-03-durable-execution.md) | hard: #33; interface: #32; hard: #31; interface: #29 | BLOCKED |
| #36 | Search authorized resources with bounded confidential continuation | [Phase 4](phase-04-clients-ui-import-search.md) | hard: #35; hard: #34; interface: #21 | BLOCKED |
| #37 | Apply reviewed import plans without overwriting local work | [Phase 4](phase-04-clients-ui-import-search.md) | interface: #21; hard: #27; hard: #31; interface: #36 | BLOCKED |
| #38 | Extend the existing transport with a typed native client facade | [Phase 4](phase-04-clients-ui-import-search.md) | hard: #37; interface: #23; hard: #34 | BLOCKED |
| #39 | Capture a complete V2 SQL and artifact recovery set under durable quiescence | [Phase 5](phase-05-recovery-evidence.md) | interface: #22; hard: #37; hard: #33; interface: #24 | BLOCKED |
| #40 | Verify complete R2 workspace and current-authority isolation | [Phase 4](phase-04-clients-ui-import-search.md) | hard: #36; hard: #37; hard: #38; hard: #34 | BLOCKED |
| #41 | Persist CLI mutation intent and runtime proofs before dispatch | [Phase 4](phase-04-clients-ui-import-search.md) | hard: #38; interface: #26 | BLOCKED |
| #42 | Render the authorized task board and retained evidence honestly | [Phase 4](phase-04-clients-ui-import-search.md) | hard: #38; hard: #35; interface: #36 | BLOCKED |
| #43 | Restore V2 in isolation and invalidate all recovered execution authority | [Phase 5](phase-05-recovery-evidence.md) | hard: #39; interface: #31; interface: #26 | BLOCKED |
| #44 | Implement explicit native CLI commands and safe artifact file handling | [Phase 4](phase-04-clients-ui-import-search.md) | hard: #41; hard: #38; interface: #34 | BLOCKED |
| #45 | Add accessible version-bound board commands and conflict recovery | [Phase 4](phase-04-clients-ui-import-search.md) | hard: #42; interface: #38; interface: #35 | BLOCKED |
| #46 | Extend existing operator tooling for V2 recovery and explicit cutover | [Phase 5](phase-05-recovery-evidence.md) | hard: #43; interface: #39; interface: #19 | BLOCKED |
| #47 | Extend the existing release verifier with additive R2 evidence gates | [Phase 5](phase-05-recovery-evidence.md) | hard: #17; interface: #22; interface: #38; hard: #19 | BLOCKED |
| #48 | Prove native CLI conformance against a real isolated HTTPS deployment | [Phase 4](phase-04-clients-ui-import-search.md) | hard: #44; evidence: #40 | BLOCKED |
| #49 | Close R2 on one reviewed candidate with real recovery and multi-agent evidence | [Phase 5](phase-05-recovery-evidence.md) | evidence: #17; evidence: #40; evidence: #48; evidence: #45; hard: #46; hard: #47 | BLOCKED |
| #50 | Prepare the reproducible R2 artifact and operator handoff after acceptance | [Phase 5](phase-05-recovery-evidence.md) | hard: #49 | BLOCKED |

## Why these boundaries remain separate

- #19 reconciles source and planning, not runtime code.
- #20–22 produce different canonical contracts; #23 integrates generated/type/auth/event/cursor/test-discovery boundaries. They share files and must serialize integration.
- #24 owns the complete storage boundary and registry registration, while #25 owns lifecycle and #26 proof/presence.
- #27 metadata/reads, #28 catalog lifecycle, #29 claim/renewal, #30 expiry/failure and #31 cancel/requeue each carry different state invariants and failure evidence.
- #32 bytes/commit, #33 orphan reconciliation and #34 message references separate remote-byte lifecycle from metadata visibility. #35 independent acceptance is a distinct authorization gate.
- #36 search, #37 import and #40 full isolation prevent broad Task8/9 cycles. #38 transport facade does not own CLI persistence (#41), explicit commands (#44) or live conformance (#48).
- #42 read-only board and #45 mutation/conflict UX have independently testable permissions/accessibility contracts.
- #39 capture, #43 restore, #46 operator CLI and #47 evidence verifier have distinct control-plane/test owners. #49 acceptance and #50 release are operator/evidence gates, not autonomous implementation.

## Current state and target mapping

Read [synthesis](brainstorm-synthesis.md) for source-backed partial implementation and [execution plan](execution-plan.md) for waves/ownership. Each phase distinguishes existing versus create paths, exact planned interfaces, negative/restart tests and review evidence. Snapshot JSON under `research/` preserves source issue text; live issue state wins at pickup.

## Reconciliation recommendation

Keep every existing child. Add exact plan/branch/commit comments only after verified publication. Do not rewrite older candidate claims as if they were historically false; date the new snapshot. Keep epic4 organizational and non-pickable. No duplicate new issue justified by current research; discovered provenance/binding/platform choices belong to #20/#22/#41 and their consumers.

## Revision 2 synchronization

The approved four corrections and W1 workflow alignment are recorded in [decision delta](research/revision2-decision-delta.json). Whole-plan task/phase/common interfaces and tests must remain equivalent. Dependency types, shared-file ownership and hard #17 are unchanged. Historical receipts refer only to their original bytes; this revision requires fresh independent review. Corrections append to existing task branches under unchanged-tip guards, without force/rebase or extra task queues.
