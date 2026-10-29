# Phase2 — Immutable artifact restoration and completeness

Status: pending after phase1. Owner: artifactrestore helper; sharedjobs/contracts serialized by integrationowner. Files src/recovery/{artifacts,jobs,restore-current}.ts or corresponding existingowner and tests/recovery/complete-restore.test.ts + focusedartifacttest as justified.

## Tests before

- [ ] SQL-only success cannot certify manifest with committedartifact. Missing/corrupt/short/long/wronggeneration bytes reject. Existing wrongtargetbytes never overwritten.
- [ ] Genuine source includes one committedartifact used by both result andmessage, old nonselected generation, staged/expired artifacts, and known-drainedeffects. HMAC-valid but relationallyinvalidsource stillrejects.

## Implementation

- [ ] Reuse verifiedStream mechanics only through restore-specific guards; existing captureArtifact functions bind CurrentCaptureJob and direction, so cannot merelyswapbuckets. Trusted distinct product/recovery bindings only; manifestkeys validated against workspace/artifact/generation/digest.
- [ ] Durable fixedinventory from authenticated manifest. At most one pendingimmutable transfer percontinuation; reserve beforecopy, onlyIf create, full streamSHA256/size validation and destinationreadback. Exactexistingbytes allow sameoperationcompletion after crash. HEAD/size/mtime/existence do not prove digest or oldexternal effect drainage.
- [ ] Every awaited read/write/hash/conditionalconflict revalidates proof/fence/jobphase/ledgeranchor/epoch and bindingidentity. Bounded64KiB writes/backpressure; honor sourcechunk retention and resourcebudgets. Pendingfailure neverincrements successfulartifactcount.
- [ ] Source capture39/42 rejects in_flight/uncertain put/delete effects before checkpoint, but explicitly permits reserved effects because they were never dispatched (maintenance.ts49–56). Restore must accept valid reserved PUT/DELETE source evidence and invalidate its old continuation authority without fabricating drained timestamps. Reject a HMAC-valid complete capture with in_flight/uncertain generations or invalid relationships. Noncommitted stages with effect none, reserved, or historical known-drained generations retain source evidence but cannot resume old upload/delete calls. Final noncommitted artifact projection: status expired, active_generation_id/committed_generation_id/committed_at/expiry_check_at NULL; preserve other source evidence and advance version deterministically if changed. For noncommitted generations retain source effect kind/state/start/drain evidence (including reserved), clear cleanup_next_at and delete_admission_epoch/delete_admission_generation together, set cleanup_error_code RECOVERY_COVERAGE_UNKNOWN to hold automatic cleanup. Do not fabricate drained or tombstoned success. Original immutable source rows remain available for audit. Validate these projections against every actual CHECK before coding; only independently authorized new cleanup can occur after resume, never implicit old dispatch.
- [ ] After verifiedcommittedbytes, restore exact committedgeneration/version/key pointers and status, preserving original SQLidentity. Verify artifact_associations/result_artifacts/message_artifacts bidirectionally and referenceownership. Oldnonselected generationbytes are not part of committedinventory and cannot be readascurrent.
- [ ] Recompute complete SQLsource digest and inventorycounts; allsourcechunks present, allcommittedbytes verified, allreferencechecks pass before authorityoverlay. No new receipt can authorize frontendaccess while restoredstateclosed.

## Tests after

- [ ] Same digest differentgeneration remainsdistinct; extra/duplicate inventoryentry rejects; old digest-only key never silentlymapped.
- [ ] Delayed PUT/rejectedconditionalcopy, crash before/after objectwrite, corrupt existingobject, eviction+sameoperation, alteredoperationfingerprint, bucket change/missingbinding. All failurepaths remainclosed.
- [ ] Proofexpiry/ledgerrotation/epoch/fencechange at every awaitededge aborts completion; actual digestreadback against targetobject.
- [ ] Genuine capture fixtures frozen between PUT reservation and dispatch, and between DELETE reservation and dispatch, restore successfully with no old effect dispatched and no invented drainage. Invalid stage/effect source rejected or explicitly invalidated per matrix without dispatch/delete. Unknownexternal effects never auto-resolved; no targetcleanup sideeffect before authorizedresume.
- [ ] Boundary limits, manifest/jobserialization ceiling, measured chunkmemory/SQLwork; near-limit sourcecapturereceipt is not restorebenchmark.

## Exit gate

Independent review of exactgenerationinventory, stagingfixups, streamguards and paused-effects contract; focusedactualWorker receipts. CurrentoperatorCLI stillunavailable pending46, no newpublicoperation.

## Asynchronous fresh guards are awaited, never void callbacks

Existing verifiedStream/signRecord helpers accept synchronous `() => void` guard callbacks. Do not pass an async resolver guard into them: TypeScript may accept a Promise-returning function as void while the caller never awaits it. Current16 restore needs explicitly async-aware variants (`() => Promise<void>`) with awaited checks at every relevant read/write/hash/crypto boundary and immediately before next effect/publication. Preserve historical synchronous helper behavior and all V1/capture call sites; do not mechanically make shared callbacks async without auditing every invocation. Actual DO tests suspend the resolver at each boundary and assert that no bucket write, read continuation or SQL publication begins until the guard resolves; delayed failure/rotation rejects, no unhandled promise/reordered side effect. Trusted resolver timeout cannot be ignored by a void caller.
