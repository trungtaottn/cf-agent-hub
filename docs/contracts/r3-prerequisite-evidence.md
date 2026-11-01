# R3 prerequisite validator — partial source only

Status: Partial issue66 source · Prerequisite consistency only · R3 acceptance pending; no released artifact.

This unit is partial issue66 groundwork. It does not implement `--round R3`, does not complete issue66, and cannot establish Verified/Released status. R1/R2 acceptance branches are unchanged.

`validateR3Prerequisites(input, {files | root, expectedContext, fixtureMode})` checks a closed prerequisite manifest, exact pinned MCP tool mapping, producer/case inventory, candidate/policy/schema/client/environment consistency and bounded referenced bytes. `expectedContext` is separately supplied comparison data; neither it, a content digest, nor a `recorded` provenance label authenticates an execution. No submitted command text is executed. Disk mode reads declared bytes only; it does not attest Git HEAD, PR head versus synthetic merge checkout, deployment ownership or installed action semantics.

The result separates `structurally_valid` from `acceptance_eligible`, which is always false. `incomplete_policy` enumerates typed producers, action/effect predicates, recovery graph, runtime-origin inspection, prior-round acceptance and independent round review. Fixture mode requires an in-memory Map and reports `verifier-unit-only`. Synthetic fixtures stay under tests and are never written to validation/releases.

Future full issue66 integration must bind actual core and issue65 typed persisted-state producers, independently inspected source/build/checkout/runtime identities, exact installed action schema/semantic revision, authentic client launches, real recovery authority and independent review. A structural pass is not a waiver for any missing gate. Only then may the shared CLI/workflow gain a reviewed R3 acceptance profile; issues67/68 remain separate and formally deferred after R4.

Focused command: `node --test test/acceptance/r3-prerequisites.test.mjs`. CI must explicitly register this Node test; a file existing or being collected is not executed evidence.
