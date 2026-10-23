# Backup and restore

Status: Design baseline · Contract revision 0.1 · Implementation pending.

This is the required recovery design, not a claim that backup/export or restore tooling exists. The product must not pass an advanced operations release gate until a repeatable recovery exercise produces inspectable evidence. Operators must define retention, recovery point and recovery time objectives for their own deployment; no objective or achieved duration is promised here.

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
- A representative task can reach Review and be independently accepted; delivery remains paused throughout this check.
- A repeated restore using the same manifest yields the same logical records and artifact coverage without duplicating effects.

For production cutover, gate ingress, stop old dispatchers and runtimes, preserve the failed environment for investigation, update the operator-controlled workspace map only through an explicit recovery deployment, and run readiness again. Ensure exactly one authoritative environment is accepting commands. Resume delivery only after reconciliation and remove the maintenance gate deliberately.

## Evidence and deletion

A recovery receipt must name the manifest, verifier, compatible version, validation results, unresolved side effects and cutover decision. Periodically test recovery from a separately retained copy rather than the active bucket. Retention deletion must respect legal holds and operator policy while remaining consistent across metadata, bytes and backups. Do not delete keys needed to decrypt retained recovery sets. Record failed restore attempts and their causes; a successful backup upload without a restore exercise is not evidence of recoverability.
