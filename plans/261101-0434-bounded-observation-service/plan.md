# B1 Durable observation service Implementation Plan
Status: reviewed source-only implementation plan; implementation in progress, acceptance pending. No live hook/credential/installation, merge or deploy.

> For agentic workers: use superpowers:subagent-driven-development with disjoint file ownership and independent whole-diff review. Integrator alone stages/commits/publication.

**Goal:** Implement the bounded optional SQL-backed observation service with real authenticated Workers tests, restart/restore safety and additive schema18 native compatibility; do not yet activate a real-host adapter or claim the full two-agent pilot complete.
**Architecture:** Existing WorkspaceDO owns two diagnostic slots and bounded records. Existing ingress/current actor/run gates are rechecked in a dedicated transaction; no domain event/outcome, lease refresh or authority minting. A separate offline adapter/Factory observation UI follow only after this service base is verified.
**Tech Stack:** Existing TypeScript/Workers SQLite/R2/JSON-schema generators; no dependency upgrade/new service.
**Spec:** [Phase A→B design](../261101-0245-factory-evidence-explorer/spec.md), original SHA1467792f91c0e568ef49cf3e5bf2a55d4288f650c69d04cef18f21ce4ce62d80; [closed wire](wire-contract.md), [schema definitions](contracts.schema.json), [recovery/native/queue compatibility](compatibility.md). Independent closed-design review2026-11-01: no remaining material semantic blocker. Runtime tests below remain acceptance obligations.

## Global constraints
- Source base public77ee610c13a61077dc866a66556eafdfcb1d2553/tree3c6eb659c6ad6d30ddd30bc6b22500d819a6c73a; verify remote again before branch creation. Do not base on optional visual-driver branch.
- Two slots,32 records/batch,32768 request bytes,256 retained rows/session,512 total,262144 canonical stored bytes,16384 metadata bytes,50/read,4 in-flight observation allocations. Integer counters safe; current deny before any mutation/replay.
- Config absent disables routes. No new grants/delegable capabilities/MCP actions or operator defaults. Reports are unverified observations with unknown completeness, not test evidence/file locks/task commands.
- Preserve frozen schema15/16/17 bytes/receipts/profile identities and release fences. Capture genuine17 fixtures BEFORE migration18 exists in the candidate.
- Actual crash/HTTP/SQL/retention/native proof tests are B1 acceptance, not circular prerequisites to begin implementation. Their explicit expected semantics must already be reviewed.

## Review focus
- Lost append/replace response followed by expiry/config reset must remain UNKNOWN, never blind replay into successor.
- Hidden captured project plus currently visible task must not leak old paths/counts through read/cursor/status.
- Import original diagnostic rows only in CLOSED restore, validate source first then invalidate; never revive authority.
- New physical18 must reject frozen17 native proof, without rewriting historical signed bytes or increasing unrelated ceilings.
- Diagnostic saturation/body starvation must be bounded and not block current task heartbeat/domain operations.

### Task 1 — Genuine schema17 recovery evidence before migration
Files: isolated baseline fixture producer based on existing test/recovery/schema16-* patterns; output new test/fixtures/genuine-schema17-{bundle,snapshot,lifecycle}.json plus sanitized provenance README. No current source behavior change.
- [ ] Run exact baseline17 encoder/capture in workerd with synthetic rich data; capture signed bundle, captured SQL/R2, partial-import and completed-target snapshots. Record public base/tree and original fixture hashes; do not claim random IDs/timestamps reproducible byte-for-byte.
- [ ] Verify original encoder signature/hash/manifest and current17 restore/control tests before copying immutable fixtures into implementation tree.
- [ ] Independent review provenance and fixture contents (synthetic only; no real credentials/logs).

### Task 2 — Closed protocol, optional configuration and authenticated service
Files: new src/observations/{validation,repository,service,reads}.ts; new src/http/observation-routes.ts; modify src/workspace/workspace-do.ts, src/http/cursors.ts, spec/openapi.json and spec/deployment-config.schema.json, src/config/deployment.ts, scripts/generate-config-validators.mjs and scripts/generate-auth-contract.mjs. Exact generated file inventory from scripts, no hand-edited generated DTOs.
Interfaces: service establishes current binding, appends exact contiguous batch, replaces exact session/highwater, owner-status and ordinary historical-read according to B0 operation definitions. Inputs use generated closed types; contexts are real WorkspaceContext/current actor, never caller supplied authorization booleans.
- [ ] RED actual Workers route tests: absent config unavailable; synthetic enabled current native owner positive; human write denied; missing execute/read proof denied; stale lease/fence/epoch/config denied with identical domain/diagnostic rows.
- [ ] Implement minimum closed validation and fresh post-await transaction guards; serialize canonical receipt before returning; hash exact accepted body identity, not credential bytes. Add dedicated no-domain-write tripwires.
- [ ] RED append/replay/changed-body/gap/overflow and replacement-after-append/lost-response tests. Implement two-slot atomic metadata/records/receipt updates and deterministic private ingest order.
- [ ] RED historical read current+captured-project visibility, hidden session indistinguishability, cursor highwater/eviction/replace and current grant race tests. Implement padded distinct cursor operation and post-crypto current recheck; no cross-slot counters.
- [ ] RED exact/+1 byte/record/metadata/counter/work caps; delayed body/crypto cancellation; current heartbeat under4held observation requests. Implement bounded allocation finally-release and strict duplicate JSON preflight without modifying generic parser semantics.
- [ ] GREEN focused Workers/Node types/schema parity and current browser/native transport nonactivation checks.

### Task 3 — Schema18 and recovery compatibility (disjoint worker)
Files: src/storage/schema-version.ts, src/storage/migrations.ts and new src/storage/migrations/0018-observations.sql; src/recovery/** and scripts/lib/recovery-client.mjs; spec/recovery-manifest.schema.json; test/recovery/schema17-* and observation recovery tests. Integrator owns workspace/workspace-do.ts touch points to prevent collision.
- [ ] RED schema18/current registry and genuine17→fresh18 restore plus same-release captured/restoring/restored lifecycle tests; wrong-release remains denied unchanged.
- [ ] Add exact18 DDL/registry/decoders and explicit17 source→18 mapping, never relabel old signatures/receipts. Keep old columns exact.
- [ ] RED source18 captured observations→closed restore original graph validation→records then slots deletion→final0 across restart at every phase; old session reads/writes always denied until current legitimate future establish. Corrupt source relationships/caps rejected BEFORE deletion.
- [ ] GREEN full recovery/operator/CLI fixtures, original15/16/17 paths, source/target schema reporting and irreversible pending admission invalidation.

### Task 4 — Additive native18 full producer/consumer compatibility (disjoint worker)
Files: new scripts/generate-native-schema18.mjs and schema18 descriptor artifacts; trusted shared native profile selection/worker selected-state/controller/Node signed config/bootstrap/custody/preparation/output consumers; corresponding native tests. Freeze original16/17 artifact hashes first. Coordinate exact generated commitments with service/recovery workers, no overlap writes.
- [ ] RED physical18 rejects old17 proof and explicit18 source path fails until supported.
- [ ] Generate precise current18 budgets from pinned17 facts: S bridge+41 per130 executed S =+5330; private query1 and six-S attachment deltas recomputed independently, not blind literal replacements.
- [ ] Implement trusted closed18 profile binding through authenticated existing fixture/ledger commitments; absent/default tags remain old semantics only. No caller-selected budgets/unsigned override.
- [ ] GREEN exact old profile byte/signature/digest fixtures plus18 full signed controller→service source journey and mixed/swapped-tag negatives; no live installer/credential activation.

### Task 5 — Integrate, review, publish source candidate and exact-head acceptance
- [ ] Stable checkpoint across workers; verify no private/raw data; source-only manifest and private recovery checkpoint labelled pending until final gates.
- [ ] Independent frozen diff review, resolve each finding with RED→GREEN; add truthful source/activation status docs and scoped plan amendment if required by canonical accepted plan.
- [ ] Run Node/full types/generated/docs/build, actual Workers, recovery CLI and native full-profile/source gates. Preserve environment failures separately, never weaken guards.
- [ ] Publish stacked draft PR through current authorized same public repo. Full exact-head CI to terminal, including unchanged existing browser suite. New service read API tested in real Workers; full observation UI/browser scenarios belong to next bounded UI+adapter slice, not falsely claimed here.
- [ ] Reconcile literal delivered service AC vs remaining offline adapter, Factory observations, actual two-agent/two-worktree pilot and visual evidence. No automatic dependency/product-action closure.

## Next slice, not part of B1 service completion
After B1 verified: offline Linux adapter implementing pinned lock/atomic-file protocol with fake provider and multiprocess crash tests; then explicit Factory observation projection for two authorized selected tasks with unsupported-coverage mode. Real host activation requires actual safe environment and any mandatory action-time permission. AcceptanceBinding/loop budgets/file enforcement/merge authority remain outside A/B.
