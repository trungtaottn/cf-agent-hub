# ADR 0008: R2 authority provenance and historical results

Status: Selected technical direction under delegated research and review · Contract integration pending · No runtime or live acceptance claimed.

## Context and evidence

The published R1 boundary treats native credentials as static operator entries. Dynamic R2 issuance must not bypass that exactness or create a second registry. Historical TaskResult bodies also need a public authorized read contract; sanitized events cannot reconstruct their complete contents. The [bounded option study](../research/r2-contract-options/decision-study.md) records source hashes, alternatives and synthetic SQL measurements. Measurements are not product performance or security acceptance.

## Selected authority decision — 2026-10-26

Identity and credential provenance is immutable `operator_static | human_managed` in the single existing registry. Only static rows participate in static completeness/ref/hash/tombstone checks. Existing R1 rows migrate as static without new grants. Cross-provenance ID collisions and implicit reclassification fail atomically.

A successful higher-epoch install and every restore-authority overlay revoke human-managed credentials and runtime proofs. Preserve identity, evidence associations and disabled/archive state present in authoritative restored/current evidence. Retained active agents advance to the installed epoch without acquiring grants. Never advance an old credential into current authentication. Fresh issuance requires a currently authorized human, current active agent and current operator ceilings. Same-epoch same-digest ordinary install remains idempotent; restore independently revokes dynamic authority even when its numeric epoch is unchanged.

A backup cannot reconstruct later dynamic status edits that it never contained. No external newer-status ledger is introduced here. Revocation after restore is conservative and does not claim to recover unbacked edits.

## Issue25 implementation amendment — 2026-10-27

Local identity/credential source implements the provenance decision without adding another registry. A human-managed credential remains beneath its issuing human's current enabled, same-epoch grant, including `credentials:manage` and every delegated scope/project. The original issuance browser session need not stay alive. Recognition of a native scope never grants it, and native-disallowed human scopes cannot be delegated.

For adoption of an operator-static identity, one current enabled, unretired, locally unrevoked static credential must cover the complete requested scopes, projects and expiry. Separate static credentials cannot be unioned. Authentication and background eligibility recheck that same ceiling; loss of the surviving static ceiling disables the dynamic credential. This preserves static authority rather than silently reclassifying it. Independent local `revoked_at` and archived identity state remain denial ceilings across later operator installation.

Agent identities are workspace-wide metadata, so their reads/management require an unrestricted project grant. Credential metadata/revoke requires the complete credential grant to fit the current administrator's ceiling; replay also checks the original retained outcome. `null` and `[]` project grants remain distinct. Operator changes to public static metadata or credential status/grants advance the corresponding version; repeated identical retirement does not. All new lifecycle events retain canonical `resource_version:null` for agent/credential resources; command DTO versions enforce mutation preconditions.

These choices were source-reviewed under delegated engineering authority; [research](../research/r2-identity-lifecycle.md) and [execution evidence](../r2-task-plans/issue-025-execution.md) record the alternatives and checks. No runtime enrollment, task transition, schema8 recovery activation or live acceptance is implied.

## Selected historical-results contract — 2026-10-26

Use additive GET `/v2/workspaces/{workspace_id}/tasks/{task_id}/results`, operationId `listTaskResults`, with closed `TaskResultListResponse={data:TaskResult[],page:Page,request_id}`. Reuse unchanged TaskResult, Page, Cursor and ListLimit (default 50, range 1–200). No Task/TaskResult fields, scope, total count or R1 route availability are added. Both human and native lanes require current `tasks:read`, workspace admission and current task/project access. `events:read` is neither sufficient nor additionally required.

Return a result only when its complete canonical projection is authorized, including every referenced artifact's current committed/readable state, workspace and result/run association and caller artifact scope/project permissions. Hide the whole result rather than altering its artifact list or leaking partial summary/attribution. Loss of task access fails the request, not an empty success. No artifact-byte download is needed.

### Authorized-result pagination, not scanned-candidate progress

Allocate an immutable strictly increasing internal submission sequence atomically with result, transition and event. Use a task/sequence seek index and fixed initial sequence ceiling. Later pages select fully authorized rows with `lastReturned < sequence <= ceiling`, ordered ascending. Retrieve up to limit plus one **authorized** rows; continuation is determined only by authorized lookahead. Cursor position is the last returned authorized sequence, never a hidden scanned frontier. Hidden-only suffixes terminate with `has_more:false` and `next_cursor:null`; they must not create empty progress pages. If response bytes stop a page early, the next fully authorized unreturned result establishes continuation. An empty authorized result set terminates normally.

For fixed visible data, grants, query and envelope bounds, successful pagination shape must not change merely because hidden results are inserted. The earlier candidate-budget/empty-continuation proposal in the option study is superseded. No 201-physical-row or 1,000-artifact-check guarantee is made: authorized output bounds do not bound underlying SQL work. Timing and resource-failure side channels are not eliminated.

Before activation, #27 must prove bounded indexed query and authorization work on the actual Workers storage implementation, including long hidden prefixes/suffixes and adversarial artifact visibility. If a supported hard work budget is exceeded, fail the entire request with generic 503 and no partial data or progress cursor. Do not invent an interrupt API or mistake post-query telemetry for preemptive enforcement. [Cloudflare's SQLite Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) documents synchronous cursor consumption and rows-read accounting; this review establishes no query-interrupt capability. The physical-work proof remains outstanding until real implementation.

### Response bytes and cursor validity

Select a new 1,048,576 UTF-8-byte ceiling for the entire serialized response, including actual page/cursor and request_id. This is a conservative reviewed contract bound, not a measured optimum or existing R1 guarantee. Stop before the next fully authorized result would exceed it, return no truncated result, and continue from the last returned position. Submission and restore owners must bound supported canonical identifier/envelope sizes and prove every admitted result fits with the **maximum supported continuation-envelope overhead**, not merely a terminal empty envelope. No arbitrary new identifier-length limit is selected here. Activation depends on that bound-and-fit proof. An impossible persisted oversize row fails with sanitized invariant error 500, never an endless empty continuation.

Reuse AES-GCM cursor protection, extending closed operation/position validation for `task-results` and numeric sequence positions. Bind workspace/task, operation, ordering, limit/query, principal/lane, credential/session, authority epoch and restore incarnation; preserve absolute 3,600-second expiry from the first page, never sliding. Use fixed-width or padded encrypted payload encoding so hidden sequence digit lengths cannot change token length; keep the complete encoded cursor within the existing 2,048-byte bound. Test both 2,048 and 2,049 bytes. Encryption alone does not hide payload length. Restore changes incarnation even at the same epoch. Recheck current authority every request; encrypted cursors are not grants. Invalid/tampered/wrong-binding cursors fail 400; expiry or recognized obsolete incarnation/result-specific retention floor fails 410 only where authenticated binding supports that distinction. Missing rows alone do not prove truncation. Do not reuse message/event retention floors.

Preserve the allocator across backup or invalidate old traversals on restore; deleted maxima must not be reused within a valid traversal. Current visibility may change between requests; a result newly visible behind lastReturned requires a fresh traversal. No cross-request authorization snapshot is promised. Successful/error responses are no-store with existing sanitized error/security headers. This GET requires neither CSRF nor Idempotency-Key and mutates no domain resources.

Required verification covers unchanged successful pages after hidden insertions (including limit 1), hidden-only terminal suffixes, complete artifact visibility, revoked task/credential access, fixed ceiling under equal timestamps/clock regression, no sequence reuse, expiry/incarnation/retention isolation, byte boundaries and worst-case continuation overhead, and whole-request fail-closed behavior under the actual supported work budget. These are future implementation obligations, not passing endpoint tests.

## Ownership and consequences

Public contracts belong to #20, generated routing/cursors to #23, single migration/registry to #24, bootstrap/auth to #25, runtime proof to #26, authorized queries to #27, immutable results to #35 and restore semantics to #22/#43. No migration or handler is introduced by this ADR. Required tests include static exactness, provenance collisions, same-epoch no-op, higher-epoch and restore revocation, fresh authorized issuance, disabled/archive preservation, reduced ceilings and restore round trips. Source/fixture checks are not deployed recovery evidence.

The owner delegated technical selection after comparison and experiments; these are the selected engineering decisions under that delegation, not a claim that the owner personally selected each alternative. No merge, deployment, credential operation or release is authorized by this ADR.
