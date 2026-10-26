# R2 Agent Task Handoff

Status: Approved corrections drafted; fresh post-correction independent review pending; implementation blocked by R1 acceptance.

## Overview

This additive amendment prepares existing issues19–50 for precise future pickup. It preserves the canonical2026-10-23 R2 design and historical approvals; it implements no R2 runtime code. Candidate4c8e487 on PR93 is not Verified R1.

Read [synthesis](brainstorm-synthesis.md), [all32 issue contracts and dependencies](issue-decomposition.md), [execution waves and ownership](execution-plan.md), and [queue rules](label-plan.md). Current GitHub issue state wins over snapshots.

## Goals

| # | Goal | Priority |
| --- | --- | --- |
| 1 | Match every existing issue to current source, exact proposed interfaces and meaningful negative/restart tests | P1 |
| 2 | Preserve hard/interface/evidence gates and unresolved product decisions | P1 |
| 3 | Publish one independently readable plan branch per existing child after independent review | P1 |

## Phases

The following is a human navigation index; AK also discovers the phase files themselves. Its initial CLI template table did not auto-add later phases, so this index explicitly links the full bundle without claiming phase completion.

- [Source reconciliation — #19](phase-01-start.md)
- [Identity and storage — #20/#23–26](phase-02-identity-storage.md)
- [Durable execution — #27–35](phase-03-durable-execution.md)
- [Clients, UI, import and search — #21/#36–38/#40–42/#44–45/#48](phase-04-clients-ui-import-search.md)
- [Recovery and evidence — #22/#39/#43/#46–47/#49–50](phase-05-recovery-evidence.md)

## Dependencies

#7 publication precedes #19; #9 current documentation is its interface. #17 is a strict runtime implementation start gate. New proposed credential-epoch, artifact-binding and CLI-storage decisions require review. Complete typed graph: `research/issue-graph.json`.

## Success Criteria

- [ ] Source-correct32 task plans independently reviewed and all decisions explicit.
- [ ] Native AK export parses/validates and repository Markdown passes existing documentation checks.
- [ ] One docs/r2-NNN-plan branch per child verified against frozen payload hashes, with exact issue comment.
- [ ] No source implementation, label/body changes, automatic merge or release.

## Validation and red-team status

Historical first publication review found six corrections and cleared only its original payload. That receipt remains unchanged and does not approve the revision below. Proposed design decisions remain unapproved. See research/review-receipt.json; format validity is not implementation approval. AK scaffold/create/add-phase/read was used; its files-first semantics govern the native export. Repository-compatible copies use H1/Status rather than YAML frontmatter because existing docs validation requires it; an explicit body-equivalence record joins both artifacts. Neither format implies implementation readiness.

## Next action

Review the fixed snapshot using three fresh complete passes before any correction publication. Append reviewed correction commits to the existing guarded task branches only after publication GO; do not rewrite their history. Future implementation still requires accepted R1 and task-specific gates.

## Red Team Review — approved revision 2

Three independent pre-fix passes each covered all 32 tasks and all five phases. Their findings were deduplicated into R2-RV-01 full request/principal binding, R2-RV-02 retention-aware no-send recovery, R2-RV-03 corrected shared-gate resume ordering and R2-RV-04 immutable historical evidence links. The owner explicitly approved those four corrections and the recommended RV-03 sequence; W1 separately aligns the requested AgentKit workflow. See [decision delta](research/revision2-decision-delta.json) and [current review status](research/revision3-review-status.json). Original review receipts are preserved as historical evidence.

### Whole-Plan Consistency Sweep

Task and aggregate copies are updated together; common, source baseline notes, provider/journal interfaces, planned test matrices, recovery sequence and historical evidence links are reconciled. The typed dependency graph is unchanged; [current graph receipt](research/revision2-issue-graph.json) pins the same edges against merged source. The old format-equivalence receipt remains historical; the revision3 equivalence receipt identifies current native/body hashes; revision2 is historical. Fresh reviewers must challenge provenance, temporal guarantees, restart boundaries and all 32 plans. No semantic pass is claimed yet.

## Validation Log — Session 2

Owner decision: apply four source-verified corrections; for recovery retain historical-effect reconciliation/no-redrive and exclusive cutover before explicit resume, then run fresh task/review after resume. No new dispatch-only pause gate. W1 requests actual installed AgentKit workflow routing without automatic implementation. D1/D2/D3/D-HISTORY/D-JOURNAL and hard #17 remain unapproved/unresolved. Structural and semantic-model receipts are separate from future application tests; fresh post-fix review is pending.

The approved [recovery ordering amendment](../../../r2-task-plans/review2-recovery-amendment.md) supersedes only the contradictory historical pause-through-fresh-task clause; historical plan/digests are untouched.

### Post-correction replay review

All three independent full passes covered the b221 fixed snapshot. One High local proof-store interface mismatch (F-D1) was retained despite the other two passes finding none; imported opaque-token enrollment has no public credential_id. The working revision fixes that local store seam using captured slot/generation, adds producer/consumer tests, clarifies suspend-aware time proof, and corrects one baseline status marker. Targeted verification plus whole-plan sweeps against the new exact hashes are pending; previous reports remain historical and no final clean result is inferred.
