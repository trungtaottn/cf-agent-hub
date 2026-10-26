# R2 Issue 50 — Prepare the reproducible R2 artifact and operator handoff after acceptance

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

Implement only issue #50; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** BLOCKED — #17 Verified R1 plus named prerequisites must be satisfied before implementation.
**Hard:** #49. **Interface:** none additional. **Evidence:** none additional.
**Branch purpose:** plan delivery only. Reconcile accepted dev and predecessor code at future pickup.

## Task 50 — Reproducible release proposal and explicit publication

**Issue:** #50; hard #49; owner/operator queue, not autonomous `ready to cook`. No permission to merge or publish inferred from acceptance.

**Files:** Existing `docs/superpowers/plans/2026-10-23-release-orchestration.md`, `docs/release-checklist.md`, `docs/deployment.md`, `LICENSE`, `README.md`, `CHANGELOG.md`, `package-manifest.json`; create `THIRD-PARTY-NOTICES.md` after actual dependency/asset inventory. Source confirms CHANGELOG/package-manifest exist; historical issue statement that candidate was unpublished is obsolete. Preserve historical records rather than rewrite them.

- [ ] **Preflight:** Read current accepted SHA, CI/evidence/reviews, branch/release policy and actual packaging workflow. Compare selected shipped files against `package-manifest.json` and immutable accepted manifest. If packaging script is missing, stop for a reviewed bounded packaging change; do not invent a manual tag process.
- [ ] **Reproduce:** Execute the accepted candidate's documented locked build twice in clean authorized build contexts; compare shipped file hashes/modes. Run `npm run build:ui`, `npm run check`, `npm run check:runtime` only where current packaging workflow requires; include its exact packaging command in receipt. No dependency bump or regenerated unreviewed bytes.
- [ ] **Review package:** Scan exact Git tree/archive for secrets/private identifiers/unreviewed assets; inventory complete installed and embedded dependencies and applicable MIT/third-party/asset notices. #11 must be resolved under its own contract, not masked by clean installed-tree audit.
- [ ] **Owner decision:** Present proposed tag/version derived from actual release policy, immutable artifact hash, exact target/release action and rollback limitations. Require explicit publication authorization. Preserve no-release state while unanswered.
- [ ] **Authorized publication/readback:** Only after approval use supported workflow; independently read tag target, release asset digest/size and metadata. A failed or uncertain write requires remote reconciliation before any retry. Changed bytes invalidate review. Update Released only for what readback proves.
- [ ] **Handoff:** Operator receives accepted SHA, artifact/manifest/evidence hashes, compatible migration/rollback path, source/target authority selection, known limitations and explicit excluded R3/R4 functionality. No automatic production deployment.

**Done/evidence:** Reproducible package + notices + recorded owner decision + matching remote readback. Absent authorization means a completed proposal, not a completed release.

## Agent handoff prompt

Read AGENTS.md, this phase, the current issue and parent epic, canonical R2 plan, exact current baseline and predecessor review receipts. Work on **one named issue** only after its hard/interface gates and implementation authorization are satisfied. Confirm file ownership with integration owner before touching shared schemas/registry/DO/config. Write the named failing tests, record real nonzero collection and red cause, implement minimally through existing owners, run focused and aggregate gates, and request fresh independent review. Report SHA/diff/tests/evidence/blockers. Stop on unresolved interface decision, unexpected schema/authority behavior, uncertain external mutation, missing operator authorization or failed safety gate; never fabricate a pass or widen scope.

## Planning receipt

CH skills_list and built-in ak-plan instructions were inspected. Existing issue bodies are preserved in [historical issue snapshot](https://github.com/trungtaottn/cf-agent-hub/blob/fdabd716b4af7ef0e5082e660dc2c397f003c303/docs/superpowers/plans/261026-0727-r2-agent-handoff/research/issues-recovery.json) (prior evidence only; current live issue remains authority). Source/code/runner/contract inspection was read-only; no product tests, credentials, live recovery, issue mutation, Git commit/push or release occurred for this plan. AK scaffolding was produced by the lead and this phase stub was read before replacement. Independent whole-plan review remains the lead's gate.
