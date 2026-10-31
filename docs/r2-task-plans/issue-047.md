# R2 Issue 47 — Extend the existing release verifier with additive R2 evidence gates

Status: Implementation pending; planning review and R1 acceptance required.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing R1 recovery and evidence controllers for complete R2 state without reviving historical authority, then establish independently reviewed exact-candidate acceptance and explicitly authorized publication.

**Architecture:** Keep the existing operator Worker, binding-only `RecoveryContext`, SQLite maintenance fence, typed registry, job/receipt store, protected operator CLI and immutable release verifier. Add artifact completeness and R2 authority invalidation inside those owners; do not create a second recovery API or ledger.

**Tech Stack:** TypeScript, SQLite Durable Objects, private R2 bindings, Node 24.22.1/npm 11.19.1, Vitest Workers/operator configurations, Node test runner.

**Spec:** `docs/superpowers/plans/2026-10-23-r2-durable-work.md` Task 1/12; `docs/backup-restore.md`; current GitHub issues #22, #39, #43, #46, #47, #49, #50. Paths below are repository-relative. The historical plan remains unchanged.

## Global Constraints

- Planning baseline: PR #93 candidate `4c8e487eee7b8a3d4f76562ecca2369819aa0a9a`; dev was `fcbe6139c65f9baafee9804a5c50867a1fcc0968`. This local plan is stacked on the candidate, not proof of merge.
- All implementation below remains blocked by R1 acceptance #17 and each listed dependency. #11 embedded-toolchain advisories and #10/#14–18 live gates are not cleared by source CI.
- Current schema is 7. #24 owns the next migration (8 only if still next at pickup), including every registry/schema/foreign-key change; recovery does not append an independent migration.
- Limits: 1,000,000 rows, 1,000 artifacts, 268,435,456 total SQL-plus-artifact bytes, 200-row SQL pages, 1-MiB SQL chunks, 256 SQL chunks, 65,536-byte manifest and 10-MiB individual artifacts. Reject excess; never truncate a complete set.
- HMAC-SHA256 manifest authentication and separate AES-GCM local-file protection remain distinct. Exclusive 0600 files, protected descriptor/config secrets, no secret-bearing arguments/output.
- Capture receipt is evidence, not admission. Restore stays isolated/paused until current ledger, newer epoch, reconciled effects, source retirement, fresh probe and explicit exclusive cutover pass.
- No R3 approval activation, automatic resume/redrive, production first rehearsal, merge, credentials, provisioning or publication is authorized by this plan.

## Review Focus

1. Upload admitted before the barrier finishes after it: commit must be fenced; capture either includes exact committed generation or records an unfinished intent, never mixed SQL/bytes (#39).
2. Crash after object copy but before receipt: same immutable identity resumes without duplicate count or replacing bytes (#39/#43/#46).
3. Post-checkpoint credential absent from snapshot: old proof/token still fails under independent current epoch/ledger; dynamic provenance must not be mistaken for static configuration (#22/#43).
4. A valid SQL manifest with missing artifact bytes cannot certify restore; V1 evidence cannot certify F40 (#22/#43/#47).
5. A green fixture verifier or skipped live job cannot promote R2; every command and review belongs to one compatible immutable candidate (#47/#49/#50).

## Observed source and amendments requiring review

Observed, not inferred: `src/recovery/jobs.ts` declares `RecoveryBudget.max_artifacts:0`; `manifest.ts::validateManifestShape` rejects nonempty artifacts/unfinished IDs and requires the current registry. `restore.ts::validateSourceRow` hardcodes migration versions <=7; `verifyRow` knows static-agent/message-only relationships. `workspace-do.ts::#recoveryWorkspace` supplies a single `RECOVERY_BUCKET`. `scripts/verify-release.mjs::runCli` accepts only R1 and `release-policy.mjs` is R1-specific.

The following are **proposed implementation interfaces**, not approved product changes. #22 must freeze them with #20/#24/#32/#33 before downstream implementation:

- Preserve actual exported signatures `advanceCapture(w:RecoveryWorkspace,ctx:RecoveryContext,budget:RecoveryBudget):Promise<RecoveryJobProgress>`, `beginRestore(w,ctx,manifest:RecoveryManifest,ledger:CurrentLedger):Promise<RecoveryJobProgress>`, `writeRestoreChunk(w,ctx,metadata:{index:number;sha256:string;byte_size:number},bytes:Uint8Array):Promise<RecoveryJobProgress>`, `advanceVerify(w,ctx,manifest):Promise<RecoveryJobProgress>`. Historical illustrative `captureWorkspace`/`restoreWorkspace` are not new APIs.
- Add trusted internal `RecoveryWorkspace.artifactBucket:R2Bucket` alongside existing recovery `bucket:R2Bucket`. The source/target artifact binding and recovery binding are deployment/operator supplied, never caller-selected keys/URLs. Existing capture/restore/verify operations drive server-side copies; no ninth CLI command or new artifact-transfer public operation.
- Define `RecoveryArtifactEntry={artifact_id:string;object_key:string;recovery_object_key:string;byte_size:number;sha256:string}` from the canonical committed immutable artifact generation. Copy helpers proposed in `src/recovery/artifacts.ts`: `copyArtifactToRecovery(w,ctx,job,entry):Promise<void>`, `restoreArtifactFromRecovery(w,ctx,job,entry):Promise<void>`, `verifyRecoveryArtifact(w,ctx,job,entry,location:'recovery'|'artifact'):Promise<void>`. Each guards before and after every await; all digests/sizes are verified, not trusted from headers.
- Persist transfer identity/status in existing `recovery_jobs.details_json`: versioned details with `artifactIndex`, `artifactBytes`, and bounded immutable entries plus `pending` reservation. The exact JSON shape and progress phase enum are #22 outputs; #24 owns any SQL receipts required if the reviewed bounded JSON representation is too large. Do not use one unbounded document or add a parallel recovery ledger.
- Identity proposal from phase 2 retains physical `static_agents` as the single canonical registry and marks agent/credential `origin:'operator_static'|'human_managed'`. Higher-epoch restore/overlay activates only independently anchored current static grants; human-managed credentials remain metadata/history but become disabled/revoked, all runtime proofs invalidated, fresh human issuance required. This conservative rule needs explicit #20/#22 review; do not present it as owner approval. Both paths share `restoreAuthorityOverlay`, not separate bootstrap semantics. The reviewed epoch rule must also advance the retained active human_managed agent row to the newly installed config_epoch while preserving archived/disabled state and never granting scopes; old credentials/proofs remain revoked. Fresh human issuance then uses the current operator ceiling and can enroll a fresh runtime. Add higher_epoch_then_fresh_human_issuance_and_runtime_succeeds alongside old_credential_and_proof_denied and archived_identity_not_resurrected. This is part of proposed D-ID-1, not an approved behavior change.
- V1 compatibility means preserving original compatible R1-schema decoding and empty-artifact semantics. It does **not** imply automatic cross-schema restore into R2. Reject unsupported schema/format combinations before writes; any migration-from-V1 procedure needs a separately reviewed mapping.

## Ownership and sequencing

#22 owns recovery schemas/docs and reviewed interface freeze; #24 owns migration and typed registry. #39 owns capture/jobs/artifact-copy helper; #43 owns restore/invalidation; #46 owns operator/client transport. Shared `protocol.ts`, `manifest.ts`, `workspace-do.ts`, `table-registry.ts`, generated files and docs are serialized through the integration owner; downstream changes land only after predecessor review. #47 may proceed after its interface dependencies are frozen but does not unblock live acceptance by itself.

No implementation runner below has been executed in this planning session. At pickup verify discovery yields nonzero tests. #23 owns Node/Workers discovery; #46 must additionally own operator-runner inclusion and Workers exclusion for its real gateway suite.


## Pickup scope and exact prerequisites

Implement only issue #47; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** BLOCKED — #17 Verified R1 plus named prerequisites must be satisfied before implementation.
**Hard:** #17, #19. **Interface:** #22, #38. **Evidence:** none additional.
**Branch purpose:** plan delivery only. Reconcile accepted dev and predecessor code at future pickup.

## Task 47 — Additive R2 evidence policy in existing verifier

**Issue:** #47; hard #17/#19; interface #22/#38. Source/schema deliverable, not acceptance.

**Files:** Modify `scripts/verify-release.mjs`, `scripts/verify-release.d.mts`, `scripts/lib/release-policy.mjs`, `scripts/lib/release-policy.d.mts`, `validation/runtime-evidence.schema.json`, `docs/release-checklist.md`, `docs/feature-matrix.md`, `docs/testing.md`; create `test/acceptance/r2-release-evidence.test.ts`; preserve `test/acceptance/release-evidence.test.ts`, `release-manifest.test.ts`. #23 integrates new Node acceptance-test discovery.

**Proposed interface:** `releasePolicy(round:'R1'|'R2'):ReleasePolicy` in the existing policy module; `ReleasePolicy={features:readonly string[];operations:readonly string[];authLanes:readonly string[];requiredKinds:readonly string[];requiredGates:Readonly<Record<string,{features:string[];environment:string}>>}`. Keep `verifyRelease(input:unknown,files:ReadonlyMap<string,string|Uint8Array>):VerificationResult` and `runCli(argv,root)`. Existing R1 exports/fixtures remain compatible. Schema dispatch accepts original format1/R1 and reviewed format2/R2 only; rejects other pairings.

- [ ] **Tests Before:** `r1_fixtures_unchanged`, `r2_round_dispatch_requires_complete_scope`, `r1_recovery_cannot_certify_f40`, `missing_skipped_stale_substituted_evidence_rejects`, `unreviewed_bytes_or_modes_reject`, `no_private_origin_or_credentials`. Test one-field mutations of positive synthetic fixture; no fixture is real acceptance evidence.
- [ ] **Red:** `npm test -- test/acceptance/r2-release-evidence.test.ts test/acceptance/release-evidence.test.ts test/acceptance/release-manifest.test.ts`; ensure new suite collected by #23.
- [ ] **Implement:** Add explicit required R2 capabilities F11–F26/F29/F34/F40 plus applicable inherited R1 requirements. Freeze exact enabled-operation/actor-lane list from #38, including human-only, native-only and revoked/stale/wrong-workspace cases. Add native live conformance, board accessibility/conflict, artifact commit/cleanup/integrity, race/fence/hold, complete isolation and full V2 recovery gates. Bind exact revision/tree/modes/lock/build/configured identity and independent review, complete table/byte coverage, current-ledger/epoch and retirement/cutover receipts. Preserve bounded protected artifact loading and clean committed candidate checks.
- [ ] **Tests After:** R2 relabeled R1, valid R1 manifest substituted into R2, unknown format/round, missing required case, successful exit with skipped gate, reviewer=author, changed object digest, stale CLI/build revision all fail.
- [ ] **Green:** Focused commands plus `npm run typecheck`, `npm run check`, docs validator. `--round R2` now parses but still fails absent real evidence.
- [ ] **Review/commit:** `feat(evidence): extend existing verifier with R2 policy`; independent reviewer maps each feature/operation to required evidence and confirms inherited R1 denials remain. Do not mark R2 Verified.
