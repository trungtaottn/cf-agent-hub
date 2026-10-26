# R2 Agent Task Handoff

Status: Independent plan review complete; publication verification pending; implementation blocked by R1 acceptance.

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

Independent whole-system review found six source-grounded corrections; all were fixed and final readback found no remaining plan-publication blocker. Proposed design decisions remain unapproved. See research/review-receipt.json; format validity is not implementation approval. AK scaffold/create/add-phase/read was used; its files-first semantics govern the native export. Repository-compatible copies use H1/Status rather than YAML frontmatter because existing docs validation requires it; an explicit body-equivalence record joins both artifacts. Neither format implies implementation readiness.

## Next action

Review the complete bundle and proposed decisions. Once review is complete, publish authorized plan-only branches/comments. Future implementation still requires accepted R1 and task-specific gates.
