# Phase1 — Contract, admission and typed SQL continuation

Status: pending. Owner: integration/restore. Sourcefiles: src/recovery/{protocol,manifest,jobs,encoding,restore,maintenance,table-registry}.ts; src/workspace/workspace-do.ts; src/recovery/capture.ts for status/read dispatch; spec/recovery schemas and generated files only as needed. Existing V1 implementation/signatures retained; version-discriminated V2 helper may live restore-current.ts with same exported entrypoints dispatching to it.

## Tests before

- [ ] Genuine schema16 capture -> current empty isolated16 target rejects today due V1-onlyguard; show semantic RED.
- [ ] Accepted/rejected format/revision/source/target matrix: exact16 only for newrestore; retained15 capture/read/status unchanged;15 restore andcontrol operations zero writes/effects; V1 tests unchanged.
- [ ] Authentication, expiredproof, wrongledger/epoch/environment/workspace/bindings, targetnonempty eachtable and unsupported schema reject beforeeffects. Empty means schema/control bootstrap baseline only, not wipingexistingdata.
- [ ] Same operation/manifest begin retry is idempotent despite target now containing its own admitted metadata/job; changed manifest/ledger conflicts. Distinguish legitimate existing job from arbitrary populated target before emptyTarget check. This also requires the narrowly authenticated original-epoch admission replay in trusted-anchor-contract.md; merely moving emptyTarget is insufficient because operator/protocol currently reject epoch mismatch before restore. Do not weaken generic epoch checks or change canonical request fingerprints.

## Implementation steps

- [ ] Define CurrentRestoreJob as separate bounded discriminant, not CurrentCaptureJob with changed operation. Keep one existing recovery_jobs/chunks ledger, deterministic jobID and operation receipts. Record exact manifestdigest, source schema16, target schema16, current ledgerdigest/epoch, binding/catalog identity, durable counts/cursors/pendingstep and transformversion. Freeze maximum serialization test.
- [ ] Verify canonical manifestshape+HMAC, complete table registry/chunk order/count/aggregatebytes, independent ledger, expected targetclosed state. Store immutable cloned input after crypto; recheck authoritative target fence/anchor after await before initial transaction.
- [ ] Use schema16 registry with exact typed/nullable/PK constraints. No arbitrary imported column/table, SQLtext, JSON keys or source version range. Validate every row belongs to the same workspace and source checkpoint before staging. Explicitly validate original enum/CHECK predicates and relevant uniqueness before overwriting any source field: typed codec checks alone are insufficient. In particular reject uploaded/staged artifacts with missing expiry, noncommitted artifacts with committed_at, invalid doing/active pointer or run status/ended_at combinations, and invalid effect-state/timestamp combinations. Do not let the expired/null staging projection launder malformed authenticated source rows.
- [ ] Respect immediate cyclic FKs. During bounded first pass insert tasks with active_run_id/latest_run_id/current_result_id NULL and state backlog only when originaldoing would conflict with active pointer CHECK. Insert runs/results inregistry order. Insert artifacts with active_generation_id/committed_generation_id NULL, status expired, committed_at NULL and no reusable stageauthority. Insert generations after artifacts. These are closed staging projections, not final businessoutcomes. Original source cells remain in authenticated recoverychunks, never rewritten.
- [ ] After all source chunks imported and authenticated, perform bounded per-table fixup passes by sourcechunk/cursor: restore targettask latest/current pointers to valid rows, active pointers remainNULL for restoredactivework; finalstate per transformmatrix. Restore exact committed artifact pointers/status only after phase2 verifiedbytes. Nonactive tasks keep originalstate. Verify the staged-to-final transformation against originalsource cells and fullgraph, not lossy stagingvalues.
- [ ] Source relational validation uses canonical source references/chunks plus restored keys; do not let intentionalnulling mask missing source links. Validate source active task/run correspondence, latestresult/run, resultacceptance identity, historicalreferences and all association edges. Fixed SQLqueries or paged checks only; no global JSmap. Future dynamic references/approval JSON remain interpreted only under currentcontracts.
- [ ] writeRestoreChunk preserves source bytes and digestreceipt. Reserve exact step before R2copy, on crash/retry verify existing immutable bytes before accepting; changed payload fails. Atomically import rowbatch+receipt+cursor; noawaitinsideSQLtransaction. On source conflict target staysclosed; no compensatingpublicdelete.
- [ ] Source schema_migrations and all evidence tables remain authenticated source evidence, not copied over targetcontrol rows. Maintain complete sourcecounts/digest separately from installed targetstate.

## Tests after

- [ ] Doingtask->run and committedartifact->generation cycles restore using real immediateFKs; no disabledconstraints; badsource cycles/foreignworkspace/danglingrefs failclosed.
- [ ] Chunk order/PK order/duplicate/unknown table/rowtypes/nulls/overflow/counts/gaps/mixedschema rejected; exactretry one logicalrow.
- [ ] Crash each reservation/blob/rowreceipt boundary; eviction continuation; serviceproof/currentledger changes during crypto/read/write rejects before publication.
- [ ] Genuine all36table fixture and comprehensive coverage matrix show preserved/transformed/evidence disposition, including emptytables. Constructor restart does not migrate/resume restore implicitly.

## Exit gate

Focused tests plus independent exactdiff review of current dispatch, typedimports, stagedFKs and idempotentbegin. No source16 compatibility claim until sourceversion binding tested end-to-end. Parent must resolve findings before phase2.

## Status/read dispatch ownership

Existing capture.ts readRecoveryStatus routes non7 jobs to assertCurrentCaptureJob, which rejects restore jobs. Explicitly dispatch status by validated schema and job operation to current restore parser, retaining capture behavior. read-chunk must likewise select the exact authenticated restore chunk receipt without confusing source capture identity. Tests require status after begin, each phase, lost response, eviction, completion and forbidden/mixed capture ID or job ID. These read paths remain current-authority checked and bounded, not an alternate capability.

## Parent-approved operator integration

Implement and test operator-envelope-contract.md and trusted-anchor-contract.md in this phase. Issue43 owns minimal authenticated admission replay delegation and exact current-restore envelope handling; provider provisioning and CLI remain46. No implementation until independent re-review resolves remaining envelope compatibility boundary.
