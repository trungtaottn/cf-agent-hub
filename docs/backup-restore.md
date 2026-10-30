# Backup and restore

Status: Historical R1/schema7 recovery retained · Current schema13 operational recovery unavailable · Deployed rehearsal pending.

**Current development boundary:** issues24–33 advance ordinary workspace storage through schema13. All current operational recovery commands reject before replay, maintenance checkpoints, SQL changes, object IO or alarms. No current schema13 backup/restore/probe success is claimed. V1 manifests/chunks remain pinned to the historical schema7 registry; current-schema storage cannot be silently serialized as V1. Issue39/#43 own activation with complete runtime-proof invalidation, run holds, artifact bytes and composite relationship verification. Local tests distinguish historical schema7 storage from current WorkspaceDO; do not deploy this intermediate stack expecting working recovery.

R1 implements bounded logical SQL capture and typed restore through a separate authenticated operator gateway. The first rehearsal must use disposable isolated source and target authorities. Actual deployed rehearsal remains a release gate; local Workers results do not satisfy it. Operators define retention, recovery point and recovery time objectives for their own deployment; no achieved objective is promised here.

## Historical schema7 R1 recovery boundary

Follow the [R1 recovery runbook](runbooks/r1-recovery.md) for protected input formats and the eight commands: `capture`, `restore`, `verify`, `probe`, `resolve-delivery`, `retire`, `resume` and `status`. Installation remains the separate static credential helper. Commands use exact-target HTTPS and service authentication, encrypted local recovery material and secret file descriptors; no SQL text, catalog override or plaintext secret is accepted in a command flag.

Capture enters persistent maintenance and freezes the authoritative SQL projection. It is an exclusive recovery/cutover workflow, not an online backup that automatically reopens the source. The retained generation fences requests already in flight. The frozen schema7 registry covers all 21 application tables plus the event sequence high-water metadata. Every chunk contains typed values, at most 200 rows and at most 1 MiB; the manifest authenticates the exact ordered bytes, schema, environment, mapping and checkpoint. Private R2 writes happen outside SQL transactions, with durable continuation/reservation state for reconciliation after a lost response.

Restore imports only into an empty isolated target. Each chunk and its receipt commit together. The separately authenticated current ledger must match the operator's independent current anchor and install a greater authority epoch. Imported domain history is retained; imported operator outcomes do not become live operator authority. Old sessions and login attempts are invalidated. The target stays in maintenance with uncertain notifications paused, preserving attempts and due history.

Resolve every uncertain delivery using trusted receipt evidence or explicit permanent failure without redrive. Run the actual SQL write/read/forced-rollback and alarm probe. Retire the source permanently, then supply its signed retirement receipt and the matching cutover record to resume the target deliberately. The resumed generation is new, and the source cannot resume or install stale authority. A failure or timeout leaves a durable checkpoint and closed admission; use `status` and the recorded request/job identity to reconcile it.

R1 contains no task, run or artifact bytes. The following coordinated artifact/task recovery requirements remain the R2 extension, not an R1 acceptance claim. The R1 release verifier requires actual capture, interrupted continuation, restore, authority overlay, resolution, probe, retirement and resume receipts from the deployed operator workflow.

## What must be recoverable

A coherent workspace recovery set contains a transactionally consistent database snapshot or supported recovery reference; every committed artifact's exact bytes; schema and contract revisions; workspace catalog mapping; compatible Worker version and binding identifiers; and an authenticated manifest. The database includes events, outbox state, idempotency outcomes, credential revocations, approvals and run fences. Omitting those records can cause duplicate effects or restore authority that was deliberately removed.

The manifest must identify workspace and environment, capture start/end, consistency checkpoint, database checksum when export is used, artifact identifiers, exact object keys, byte counts and independently computed checksums. Protect manifest integrity with an operator-controlled signing or authentication mechanism and protect its confidentiality and retention. Keep signing keys and encrypted-secret recovery material outside the backup dataset. A checksum detects corruption; without trusted manifest provenance it does not establish who created the backup.

Cloudflare's [SQLite-backed storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) documents database recovery facilities. Their availability is a platform capability, not a coordinated R2 backup. Select and test a supported database capture method in the actual implementation; do not assume a Durable Object exposes a filesystem SQLite file or ordinary remote SQL dump command. A profile export is configuration portability, not a workspace backup.

## Capture protocol

1. Authorize an operator, identify the exact workspace and resource map, and choose a compatible release. Record the reason and capture identifier.
2. Gate new mutations and new uploads for that workspace; pause dispatch and destructive cleanup. Allow in-flight commands to settle or mark uncertain operations for reconciliation. Record a durable capture barrier. A backup process must not depend only on an in-memory maintenance flag.
3. Establish the supported database snapshot/recovery checkpoint. List all committed artifacts and their integrity metadata at that checkpoint. Keep unfinished upload intents separately; they must not be advertised as recoverable committed artifacts.
4. Copy the referenced immutable artifact objects into a separately protected recovery set. Verify every copied byte count and checksum. Do not treat a bucket inventory or an object listing alone as proof of a coherent snapshot.
5. Create and authenticate the manifest. Verify referential integrity, task/run/approval invariants, event ordering, artifact coverage and schema compatibility. Mark the recovery set complete only after verification; retain incomplete captures as clearly failed or remove them under policy.
6. Resume service after confirming the capture barrier has been removed intentionally. Record capture status and actual elapsed time without claiming those observations as an SLO.

The initial contract chooses quiescence for a coherent capture. A future online snapshot protocol may replace it only with evidence that concurrent commits, cleanup and object copying cannot create missing references. R2 [strong consistency](https://developers.cloudflare.com/r2/reference/consistency/) helps inspect object state but does not synchronize a database checkpoint with a bucket copy.

## Restore into isolation first

Never overwrite production as the first restore test. Provision an isolated Worker, namespace and private bucket with outbound delivery disabled, no production runtime credentials attached and no public route. Authenticate the manifest, verify all checksums, check schema compatibility and restore the database through the tested platform method. Restore referenced artifact bytes to the exact recovery mapping and verify authorized reads against metadata.

Restored revocation state can be older than a later security incident. Apply the current external incident/revocation ledger and membership restrictions before allowing access; rotate exposed credentials. Raw runtime proof values must never be exported; restore must not reveal or reconstruct a one-time `runtime_token`. A protected database snapshot may contain verification hashes, which must be invalidated with restored runtime authority before admission reopens. Revoke or retire restored runtimes before reopening execution, and enroll fresh runtimes bound to the current issuing credential. Credential rotation cannot transfer an old run to the new runtime. Invalidate all restored active runs, advance fencing authority beyond any pre-restore issued fence or introduce an enforced recovery epoch, and require fresh claims. The implementation must prove old runtimes cannot regain ownership even when a database recovery moves counters backwards. Persist this invalidation and recovery event before reopening traffic.

Keep delivery paused while reconciling the outbox. A historical queued record may already have been delivered after the checkpoint. Use event identities and receiver receipts to decide whether to suppress, resume or explicitly redrive. Retain uncertainty for human review instead of inferring that an absent receipt proves no effect. Preserve `outcome_unknown` and `retry_exhausted` Backlog holds: they must block Ready, requeue and claim even when retry budget remains. After external reconciliation, recovery uses separately reviewed replacement work; restoring a database must not silently clear a hold or amend the intent of an approved Ready task. Restoring an idempotency record cannot undo an already executed external action; expired idempotency retention does not authorize repeating it.

## Validation and controlled cutover

Verify these acceptance conditions in isolation:

- All database relationships and task state invariants hold, and uncommitted artifacts remain unavailable.
- Every committed artifact has matching bytes, size and checksum; a missing byte stream blocks acceptance of that recovery set.
- Unknown, removed and cross-workspace principals are denied; restored revoked credentials cannot be used.
- Old lease owners fail, new claims obtain valid authority, and approvals still require the current proposal and authorized human.
- While the shared maintenance gate is closed, reconcile historical effects without redrive and complete ledger/probe/retirement/exclusive-cutover checks; unresolved effects deny resume. Explicitly resume the existing shared gate, then verify a fresh representative task reaches Review and independent acceptance. Normal post-resume delivery scheduling is not paused; no separate dispatch-only gate is introduced.
- A repeated restore using the same manifest yields the same logical records and artifact coverage without duplicating effects.

For production cutover, gate ingress, stop old dispatchers and runtimes, preserve the failed environment for investigation, update the operator-controlled workspace map only through an explicit recovery deployment, and run readiness again. Ensure exactly one authoritative environment is accepting commands. Resume delivery only after reconciliation and remove the maintenance gate deliberately.

## Evidence and deletion

A recovery receipt must name the manifest, verifier, compatible version, validation results, unresolved side effects and cutover decision. Periodically test recovery from a separately retained copy rather than the active bucket. Retention deletion must respect legal holds and operator policy while remaining consistent across metadata, bytes and backups. Do not delete keys needed to decrypt retained recovery sets. Record failed restore attempts and their causes; a successful backup upload without a restore exercise is not evidence of recoverability.

## R2 recovery contract boundary

The [issue #22 recovery decision](adr/r2-recovery-contract.md) defines the closed V1/V2 envelope, simultaneous SQL-plus-artifact bounds, trusted private bindings and bounded future restart state. This is a contract, not enabled V2 recovery. Current runtime remains V1-only; nonzero artifact capture budgets and V2 restore are unavailable. No new CLI command or caller-selected bucket/key/URL is added. Existing protected files, HMAC authentication, separate AES-GCM file protection, operator Access identity, current ledger, maintenance and explicit resume remain required.

## Artifact exclusion barrier integration required by39/43

Issue33 implements a shared current-schema drain guard, not capture/restore activation. Closing admission invalidates new reservations/dispatch. Capture completion, restored/retired completion and closed→open resume reject persisted artifact `in_flight` or `uncertain` effects. Original trusted terminal callbacks may settle exact slots after close; a reserved but never-dispatched call must reacquire current authority after resume. The shared transition helper preserves only the explicitly verified contiguous schema7 legacy no-artifact policy; schema8–12, future or gapped sequences cannot use that bypass.

Future recovery must establish drain **before recording** its coherent checkpoint, authenticate exact committed generations, and protect source/destination immutable inventories. The new cursor/due/fence fields must be included in a reviewed current schema wire representation and invalidated/rebound on restore; exporting them does not restore authority. Current runtime still refuses schema13 recovery before replay/effects. No complete capture was produced by these local interleaving tests. Historical V1 codec/fixtures and migration1–12 bytes are unchanged; use reviewed forward repair rather than a binary downgrade.
