# Recovery and Evidence Implementation Plan

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

## Task 22 — V2 recovery contract and compatibility amendment

**Issue:** #22; hard #17/#19. Interface consumers #24/#39/#43/#46/#47. One reviewable schema/fixture/docs change; no working endpoints claimed.

**Files:** Modify `spec/recovery-manifest.schema.json`, `spec/recovery-command.schema.json`, `spec/recovery-response.schema.json`, `src/recovery/protocol.ts`, `src/recovery/manifest.ts`, `src/recovery/encoding.ts`, `src/recovery/jobs.ts` type declarations only, `scripts/generate-operator-contract.mjs`, `docs/backup-restore.md`, `docs/limits.md`, `docs/cli.md`; generate existing `src/recovery/generated/recovery-validators.{js,d.ts}`. Create `examples/recovery/manifest-v2.json`, `test/contracts/r2-recovery-amendment.test.ts`. Coordinate schema-owned fixture registration with #23.

**Produces:** Closed `RecoveryManifest` discriminated V1/V2 union, V2 artifact entry above, `RecoveryBudget={max_rows:number;max_artifacts:number;max_total_bytes:number}`, versioned job details/progress phases, exact trusted binding contract and compatibility table. Preserve every V1 field and database checksum/count/chunk representation. Reject duplicate artifact IDs/keys, noncanonical keys, unknown fields and raw authority material.

- [ ] **Tests Before:** Write `valid_v1_still_valid`, `v2_requires_complete_artifact_inventory`, `v1_cannot_claim_r2_schema_or_bytes`, `combined_budget_boundaries`, `unknown_keys_and_duplicate_generation_reject`, `no_plaintext_proofs_in_export`. Assert 1000/1001 artifacts; 10-MiB/10-MiB+1 object; 65,536/65,537 manifest; total-byte limits; exact table-count/chunk agreement. Create fixtures through canonical encoding so failures test semantics rather than malformed JSON.
- [ ] **Red:** `npm test -- test/contracts/r2-recovery-amendment.test.ts` must collect and fail V2/compatibility assertions on the baseline; record test count.
- [ ] **Amend:** Freeze the proposed binding/provenance/job-detail decisions above with independent security/schema review. Implement closed schema union and validators, preserve `verifyManifest(value,integrity):Promise<RecoveryManifest>`, `verifyCurrentLedger(value,anchor,w,minimumEpoch?):Promise<VerifiedLedger>` and canonical signing behavior. Keep runtime V2 unavailable until #39/#43.
- [ ] **Green:** `npm run generate:operator && npm run verify:generated`; repeat focused test; `npm run check`; `python -B scripts/validate_docs.py`. Preserve V1 fixtures byte-for-byte unless a newly added fixture is required.
- [ ] **Review/commit:** `docs(recovery): specify bounded V2 recovery contracts`; attach compatibility matrix, exact spec/generated diff and commands. Reviewer rejects missing binding authority, unbounded receipt state or a V1 reinterpretation. Done means reviewed contract, not captured/restored data.

## Task 39 — Complete capture under durable quiescence

**Issue:** #39; hard #37/#33, interface #22/#24; inherited #17. Deliver one restart-safe complete capture path.

**Files:** Modify `src/recovery/capture.ts`, `jobs.ts`, `manifest.ts`, `maintenance.ts`, `protocol.ts`, `src/workspace/workspace-do.ts`, `src/outbox/dispatcher.ts`; create `src/recovery/artifacts.ts`, `test/recovery/r2-capture.test.ts`. Registry additions stay in #24; docs `docs/backup-restore.md`.

**Consumes/produces:** Existing `assertRecoveryContext`, `assertJob`, `reserveStep`, `assertPending`, `withTransaction`, admission fence and #33 immutable-generation cleanup exclusion. Extend `advanceCapture` without changing its signature; emit complete V2 only after SQL and object verification.

- [ ] **Tests Before:** `barrier_restart_blocks_upload_dispatch_cleanup` asserts persisted capturing state and denial of newly admitted work. `late_upload_cannot_cross_checkpoint` pauses upload before its object await, enters capture, resumes upload and requires fenced commit. `copy_response_loss_reuses_generation` crashes after copy before SQL receipt and verifies one logical object/count on replay. `missing_or_corrupt_artifact_never_complete`, `omitted_table_or_column_rejects`, `total_budget_includes_sql_and_bytes` assert no complete receipt/signature on failure.
- [ ] **Red:** `npm run test:workers -- test/recovery/r2-capture.test.ts`; expected V2 completeness failure, not empty collection.
- [ ] **Implement:** Under one SQLite transaction close admission and persist immutable checkpoint/reservations before any copy. Reconcile previously admitted writes using #33 generation states; never hold SQL transaction over bucket/crypto awaits. Walk the reviewed registry in existing 200-row pages/chunks. Stream committed bytes from trusted artifact binding to deterministic recovery key; verify size/digest, then fence/re-authorize and persist receipt. Separate unfinished intents from committed byte inventory. Resume same pending identity after response loss; changed identity conflicts. Finalize only after all SQL chunks, table counts, budget, artifact receipts and digest checks pass.
- [ ] **Tests After:** Empty inventory, zero-byte permitted committed object if canonical artifact schema allows it, max limits, removed binding, stale operator proof mid-copy, maintenance-generation change, retained archived identity/import/history, and restart during each phase. Verify failed capture remains closed and does not silently resume.
- [ ] **Green:** Focused test plus `npm run test:workers -- test/recovery/core-flow.test.ts test/recovery/crash-fences.test.ts test/recovery/unresolved-bounds.test.ts`; `npm run typecheck`.
- [ ] **Review/commit:** `feat(recovery): capture complete bounded R2 recovery sets`; evidence includes SQL/artifact digest inventory and injected crash schedule. Reviewer checks every await and byte-coverage path. Done is local capture correctness; live recovery remains #49.

## Task 43 — Isolated restore and conservative authority invalidation

**Issue:** #43; hard #39; interface #31/#26; inherited #17. Deliver one complete restore/verifier path, not cutover automation.

**Files:** Modify `src/recovery/restore.ts`, `manifest.ts`, `controls.ts`, `probes.ts`, `protocol.ts`, `encoding.ts`, `maintenance.ts`, `src/workspace/workspace-do.ts`, `src/config/bootstrap.ts` with identity owner; extend `src/recovery/artifacts.ts`; create `test/recovery/complete-restore.test.ts`; docs `docs/backup-restore.md`, `docs/operations.md`.

**Interfaces:** Keep `beginRestore`, `writeRestoreChunk`, `advanceVerify` signatures above and existing `resumeWorkspace(w,ctx,{receipt_id,ledger,source_retirement_receipt,cutover_record})`. Proposed synchronous helper `applyRecoveryInvalidation(tx:WorkspaceTransaction,ctx:RecoveryContext,currentLedger:VerifiedLedger):void` runs once inside final overlay transaction with the same canonical identity/run owners; no token reconstruction.

- [ ] **Tests Before:** `same_manifest_restore_is_logically_idempotent` restores/replays each chunk and verifies one row per key; `changed_chunk_digest_rejects` leaves target closed. `restored_active_run_is_ended_unknown_even_replay_safe` checks run expired/ended, task Backlog/outcome_unknown, unchanged retry count/latest-run/history. `old_runtime_and_post_checkpoint_token_denied` probes renew/submit/replay after restore; `current_static_ledger_dynamic_revoked` tests reviewed provenance rule.
- [ ] **Red:** `npm run test:workers -- test/recovery/complete-restore.test.ts`; fail on missing artifact verification/runtime invalidation, not missing environment.
- [ ] **Implement:** Require empty isolated target, closed public admission/dispatch, authenticated manifest and strictly newer anchored ledger. Replace hardcoded <=7 with explicit reviewed format/schema compatibility, not accepting arbitrary versions. Import parameterized typed rows using existing chunk receipts. Restore exact immutable bytes under trusted bindings, verify relationships including task/artifact message refs and canonical identity rows. Verify source rows before transformations; preserve audit/result/import/approval compatibility bindings. In final fenced transaction overlay current grant ceiling, invalidate sessions/runtime proofs, apply dynamic/static provenance rule, expire active runs conservatively and preserve all holds/budgets/history. Recheck ledger anchor after awaits.
- [ ] **Tests After:** Corrupt/missing bytes, duplicate/unknown table, schema gap, wrong workspace/target environment, epoch or ledger changed mid-await, expired service proof, interrupted byte restore, existing target rows, terminal history preserved, synthetic disabled approved JSON bindings preserved. Missing trusted delivery receipt stays uncertain; `resolveDelivery` never changes ACK or dispatches. Missing retirement/probe/cutover denies resume.
- [ ] **Green:** Focused test plus existing `test/recovery/r1-recovery.test.ts`, `test/recovery/admission-schema.test.ts`, `test/recovery/crash-fences.test.ts` through `npm run test:workers -- ...`; `npm run check`.
- [ ] **Review/commit:** `feat(recovery): restore R2 bytes with revoked historical authority`; attach transformation matrix (source field → preserved/transformed/disabled) and negative probes. Reviewer rejects in-place active ownership resumption or recovery receipts used as admission.

## Task 46 — Existing operator CLI/gateway V2 orchestration

**Issue:** #46; hard #43; interface #39/#19. Deliver compatible bounded transport and restart-safe operator files.

**Files:** Modify `scripts/recover-workspace.mjs`, `scripts/lib/recovery-client.mjs`, `recovery-config.mjs`, `recovery-transport.mjs`, `recovery-io.mjs`, `protected-io.mjs`; `src/recovery/operator.ts`, `protocol.ts`, `workers/operator/src/index.ts`, `workers/operator/wrangler.jsonc`, `vitest.operator.workers.config.ts`, `vitest.workers.config.ts`; docs `docs/backup-restore.md`, `docs/operations.md`, `docs/cli.md`. Create `test/cli/recovery-v2.test.mjs`, `test/recovery/r2-operator.test.ts`. Extend package scripts only if discovery needs it, via #23 integration owner.

**Interfaces:** Preserve `main(args):Promise<number>`, `runRecovery(command,inputPath)`, `loadRecoveryConfig(command,inputPath)`, `createRecoveryTransport`, `verifyCapture(config)`; exact eight commands and `--input`. Trusted binding copies are driven by capture/restore/verify; operator encrypted local inventory/manifest records bind the exact remote recovery objects, not a claim that all bytes reside in a local archive. `verifyCapture` remains explicitly local-only; remote full-object verification is a separate authenticated command receipt.

- [ ] **Tests Before:** `all_eight_commands_remain_compatible_install_denied`, `restart_after_response_before_file_commit`, `changed_manifest_or_config_conflicts`, `unsafe_path_symlink_and_existing_output_denied`, `wrong_common_name_product_token_and_cross_environment_denied`, `stdout_contains_no_secrets`. Assert output permissions 0600, no evidence overwrite, stable operation identity after crash, precise bounded error.
- [ ] **Red:** `node --test test/cli/recovery-v2.test.mjs`; `npm run test:operator -- test/recovery/r2-operator.test.ts`. Add operator include and ordinary Workers exclude first, then require actual gateway assertions to fail. The old issue's ordinary Workers command would not exercise the real operator gateway correctly.
- [ ] **Implement:** Extend only reviewed V2 config/progress response variants and binding policy. Keep verified Access app JWT/type/common_name, exact origin/environment/workspace/service operation allowlists and gateway-constructed context. Persist encrypted intent before dispatch; retain received response before advancing file state. Resume interrupted captures/restores from bounded existing receipts. Keep HMAC key separate from AES key; secrets use protected descriptors, never new flags.
- [ ] **Tests After:** Local-only verification cannot claim remote byte integrity; missing object receipt fails completeness. Wrong binding/digest/epoch rejects without fallback URL. Resolve-delivery uses `delivery_id`, `confirmed_delivered|failed_without_redrive`, `evidence_sha256`, never redrive/ACK. Source failure keeps target closed.
- [ ] **Green:** Both focused commands; `npm run test:recovery-cli`, `npm run test:operator`, `npm run check`. Update runbook with protected config examples and explicit source/target/retirement/probe/resume ordering.
- [ ] **Review/commit:** `feat(recovery): orchestrate V2 through existing operator tooling`; attach CLI crash/evidence-file matrix, gateway denials and command compatibility. No real deployment credentials or live operation needed for this source issue.

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

## Task 49 — One-candidate integrated R2 acceptance

**Issue:** #49; hard #46/#47; evidence #17/#40/#48/#45 plus all original R2 task gates. Owner-authorized isolated target, private bindings, current ledger and service credentials are separate prerequisites, not artifacts an agent invents.

**Files:** Create `test/acceptance/r2-durable-work.test.ts`; modify `docs/release-checklist.md`, `docs/feature-matrix.md`, `docs/roadmap.md`, `docs/backup-restore.md`, `docs/operations.md`, `docs/testing.md`. Add exact candidate evidence under the existing `validation/releases/<release_id>/` convention only after the tested code is committed; retain protected raw data separately. No verifier weakening here.

- [ ] **Tests Before:** Integrated scenario `fresh_runtime_new_claim_and_independent_acceptance_after_restore` must fail until actual R2 functionality is present. Seed archived agents, rotated/revoked credentials, active/terminal attempts, committed/uncommitted artifacts, imports/catalog/history/outbox/replay and synthetic disabled approval binding.
- [ ] **Local gate:** `npm run check`; `npm run test:workers -- test/acceptance/r2-durable-work.test.ts test/acceptance/r2-isolation.test.ts test/recovery/complete-restore.test.ts`; `npm run test:ui -- test/ui/r2-kanban.spec.ts test/ui/r2-kanban-read.spec.ts`. Require discovered nonzero cases, actual backend, no screenshot-only acceptance.
- [ ] **Authorized live gate:** After owner provides the exact isolated target and operation authorization, execute reviewed runbook capture/verify/restore/probe/effect-resolution/retirement/explicit-resume sequence through protected `--input` configs. Do not print config paths containing secrets or origins. Verify all bytes/table counts, strictly newer epoch, denied old authority and unchanged holds/history. Before explicit resume, keep the shared maintenance gate closed, reconcile historical delivery effects without redrive and verify retirement/probe/exclusive cutover; missing evidence or unresolved effects still deny resume. Explicitly resume the existing shared gate, then run fresh task/review checks. No separate dispatch-only pause is introduced; normal post-resume admission/scheduling is not described as paused.
- [ ] **Independent journey:** After the accepted explicit resume receipt, assert domain commands are admitted and reconciled historical effects are not redriven. Test `paused_domain_mutation_denied`, `unresolved_effect_blocks_resume`, and `fresh_journey_only_after_explicit_resume`. Freshly enroll two distinct agents; complete a new claim, immutable committed evidence, Review and independently authorized Done. Submitter's alternate credential cannot self-accept. ACK/outbox success cannot complete task. Reuse #48 `npm run test:native:r2 -- --config <protected-isolated-config-path>` receipt only if exact candidate/target match; command does not yet exist at planning baseline.
- [ ] **Final gate:** On immutable independently reviewed candidate, `npm run verify:release -- --round R2 --evidence <path>`. Retain exact commands/runtime/case counts, failures and corrected reruns, current source/build/lock/tree identity and review digest. Durations are measured observations, not RPO/RTO/SLO promises.
- [ ] **Review/handoff:** `docs(r2): record exact-candidate acceptance and R3 handoff` only after evidence review. Provide canonical DTO/state versions, stable submitter attribution, immutable application/json binding, approved-intent edit rejection, fresh-claim checks, and disabled approval schema/storage. Missing live access/receipts leaves R2 implemented-at-most, unreleased, with a concrete blocker list. Do not begin R3.

**Reviewer gate:** Independent reviewer checks real run provenance, all original 12 task coverage, no Important/Critical findings, complete restoration and current-authority denial. Passing verifier structure alone does not satisfy this gate.

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

CH skills_list and built-in ak-plan instructions were inspected. Existing issue bodies are preserved in `research/issues-recovery.json`. Source/code/runner/contract inspection was read-only; no product tests, credentials, live recovery, issue mutation, Git commit/push or release occurred for this plan. AK scaffolding was produced by the lead and this phase stub was read before replacement. Independent whole-plan review remains the lead's gate.
