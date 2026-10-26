# Owner amendment — MVP development and stacked draft PRs

Status: Owner-authorized development sequencing; live acceptance and release pending. No released capability is claimed.

## Explicit decision

On 2026-10-26 the owner authorized Agent Hub development on the assistant's own cloud while Cloud Harness is repaired, approved publication of the #19 handoff, and directed sequential R2 implementation with continuous issue-scoped pushes. The owner explicitly deferred real-environment acceptance until after R4 MVP development and required PRs without merging, each successor starting from the preceding PR branch.

This supersedes the earlier rule that #17 Verified R1 must precede any R2 implementation, including #20–23 contract work. It does not declare #17 complete or remove its required evidence. Current execution scope is R2; this scheduling decision does not initiate R3/R4 implementation.

## Boundaries that remain

- No merge or auto-merge, deployment, live environment provisioning, credentials, destructive recovery, tag or release is authorized. All implementation PRs remain draft for owner review.
- Real ingress, identity/revocation, recovery, immutable deployed provenance and integrated acceptance remain outstanding and must be performed truthfully at the owner-selected post-R4 acceptance stage before any Verified/Released claim. Source tests, mocks and contract fixtures never substitute for those results.
- Technical producer dependencies, frozen public contracts, one-owner shared-file coordination, meaningful failing tests, nonzero collection, regression checks and independent review remain required. Review one or two bounded subtasks per batch; do not treat development authorization as technical readiness.
- D1 credential/epoch behavior, D2 trusted artifact mapping, D3 protected CLI backend/OS support, D-HISTORY public history contract and D-JOURNAL storage bounds remain owner decisions. Work that does not depend on them may proceed; dependent behavior must not silently select a policy.
- Preserve historical plans, approvals and review hashes. This dated amendment governs current pickup where old task text, dependency tables or comments still describe #17 as a start gate. Keep #17 and incomplete evidence issues open; no readiness label or issue closure is inferred.

## Branch and PR sequence

1. Publish #19's reviewed docs-only amendment on its existing `docs/r2-019-plan` branch and open the first draft PR against `dev`.
2. For the next issue, start from the preceding PR head, bring forward its reviewed source and the next issue's reviewed plan, and use the existing issue-linked branch without overwriting its history. Non-destructive ancestry integration is permitted; force push/reset is not.
3. Open the next draft PR with the preceding PR branch as base, not `dev`. Preserve exactly one native issue-linked branch per issue; do not create duplicate queues or relink the existing 32 branches.
4. Recheck remote tips before each write. Stop and reconcile concurrent changes; never overwrite another contributor. Record exact head/base, scoped diff, actual local checks, independent review and remote CI separately.
5. Do not merge the stack. Owner review and future integration are separate from this development authorization; deferred live acceptance is not permission to fabricate readiness.

First coding issue: #20, beginning with the closed ExecutionPolicy schema and boundary contract tests. Catalog, scope and owner-decision-dependent changes remain subsequent bounded work within that issue. Recheck final R1 drift when live acceptance occurs and rerun affected tests; provisional development is not an accepted deployment baseline.

## Workflow

The owner requested the full AgentKit vibe workflow, including careful code, review and documentation updates. The installed workflow is named `ak-vibe` (version 1.4.1, CLI 2.19.0), not `ak-vibecode`; this naming difference was reported rather than inventing an alias. Read its pipeline and orchestration/integration references: intake, isolated branch, plan validation and red-team, bounded implementation, independent review, tests/docs, draft PR, then exact-head PR review and CI. Reuse valid evidence only for unchanged inputs. The owner's stacked targets and no-merge restriction override default shipping/label behavior: no `--ship`, `--both`, auto-merge, production-ready label or fabricated completion. Repository AGENTS.md and the exact authorized scope remain governing constraints. Use a task-local pinned toolchain and isolated source checkout; do not weaken tests, change security settings, run unsupported team commands or assume hooks executed. Cloud Harness is paused until the owner restores its authorization and requests reuse.
