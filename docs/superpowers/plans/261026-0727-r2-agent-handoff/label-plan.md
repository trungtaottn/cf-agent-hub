# R2 Label and Agent Queue Plan

Status: Recommendations pending; no label changes performed.

## Existing dimensions

Existing labels include epic, documentation/enhancement/ci/operations, priority:high/medium, round:R2, ai-handle, blocked and backlog. Epic4 is backlog/epic; children19–50 are blocked. Most bounded implementation children carry ai-handle, but operational gates48–50 do not automatically gain it.

## Pickup contract

Only `ai-handle` AND `ready to cook` after all hard prerequisites and interface decisions are satisfied allows autonomous implementation. Priority and a pushed plan never imply readiness. #17 is a hard R2 start gate, not optional later evidence.

## Recommended current queue

- #19: owner-directed planning active in this session, review/integration pending. Its publication prerequisite #7 is closed and corrected docs exist on PR93; reconcile final integrated base. Leave live labels unchanged.
- #20–47: blocked, even where an interface can be researched. #20–23 explicitly depend on Verified R1.
- #48–50: blocked operational/evidence work, additionally require authorized environment/target and explicit release scope.
- #4: coordination only, never agent pickup.

## Later promotion procedure

Re-read current issue, dev and predecessor evidence; independently review the exact plan and resolve proposed decisions; only then may an authorized maintainer change queue state. Preserve metadata additively. Do not equate implementing one child with closing its evidence consumer.

## Publication scope

User authorized one task plan branch per existing issue19–50 and explanatory comments. No body rewrite, label mutation, automatic implementation,32 PR creation, merge or release is included. Comments must state the current blocked status and exact prerequisite types.
