# Backup and restore

Status: Local current schema15 capture implemented · Current restore/cutover unavailable · Live integrated acceptance deferred until after R4. Formal capability acceptance remains pending.

**Current development boundary:** issue39 adds capture-only V2/revision0.2 for exact schema15 through the existing authenticated recovery protocol. Only `capture`, `read-chunk` and `status` are admitted; current `restore`, `write-chunk`, `verify`, `probe`, `resolve-delivery`, `retire` and `resume` reject before replay/effects. The historical V1/schema7 and V2/revision0.1 contracts are not reinterpreted. Complete local capture is not current restore, live recoverability or release acceptance. Issue43 owns restored runtime/fence invalidation, holds, ledger overlay and cutover; issue46 owns current operator/client orchestration. The existing protected CLI is not promoted to a V2 workflow. Default/dev product artifact bindings remain absent.

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
6. Keep source admission closed. Issue39 does not remove the barrier or authorize resume; a separately reviewed recovery/cutover operation must do so. Record observations without claiming an RPO/RTO or SLO.

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

The [recovery decision and issue39 amendment](adr/r2-recovery-contract.md#issue39-current-capture-amendment-revision02-schema15) define the explicit historical/current boundary. No new CLI command or caller-selected bucket/key/URL is added. Existing protected files, HMAC authentication, separate AES-GCM file protection, operator Access identity, current ledger and explicit maintenance authority remain required.

## Current capture semantics

1. Persist a closed barrier and `capture_drain` job with **no checkpoint**. Exact original put/delete callbacks may settle after closure. In-flight or uncertain effects block checkpoint, counts, pages and copies, including after eviction. Object existence, timeout and inventory observations never prove drain. Never-dispatched reserved effects cannot dispatch under the old fence; they remain unfinished SQL evidence, not drained committed bytes.
2. Once drained, atomically freeze the event/checkpoint, complete 36-table counts, source maintenance projection, producer/binding declarations and committed generation inventory. All registry modes are exported, including retained credentials/proofs, task/run/result/history, imports, catalog and unrelated historical recovery jobs/chunks/outcomes. Only this capture's bookkeeping is excluded. Current login `nonce` and `pkce_verifier` are exported as empty strings: this is an explicit invalidated-secret projection, **not literal identical SQL bytes**. Source rows are not changed; verification hashes and other historical cells remain exact protected evidence, not renewed authority.
3. Persist typed SQL pages using bounded size-first selection (at most200 rows,1MiB/chunk,256chunks) and actual readback. Copy each selected committed immutable generation through the separate trusted product/recovery bindings, with conditional creation, streamed SHA-256/size checks and actual destination readback. Required current entry identity includes generation ID and artifact version; historical digest-only keys are not current keys.
4. Resume a lost response using the same persisted pending identity, never a new key or duplicate count. Proof, epoch, maintenance fence, producer declarations and in-call bucket handles are rechecked after awaits. Failures retain closed admission, unsigned/incomplete state and bounded safe diagnostics. Retryable incomplete jobs remain `running`; they are not advertised as complete or automatically cleaned up.
5. Reverify stored SQL and artifact bytes, exact coverage and all simultaneous budgets before publishing the HMAC-authenticated manifest and complete receipt atomically. The unsigned internal draft is replaced by the signed inventory. The source becomes `captured`, not `open`. Receipt unresolved-effect IDs summarize retained in-flight outbox evidence; task/run holds and other history remain in SQL and are not cleared by capture.

Ceilings compose:1Mrows,1000committed artifacts,10MiB/artifact,256MiB combined SQL+artifact bytes,65536-byte manifest, stricter65536-minus256-byte complete progress envelope, and262144-byte whole job. Generation-qualified names and receipts reduce practical capacity below independent maxima. Exceeding any limit rejects completeness; nothing is truncated. Physical bucket names cannot be proven from opaque handles: distinct reviewed deployment declarations remain mandatory. No bucket or credential was provisioned, and no live recovery was activated. [Research and local observations](research/r2-capture-runtime.md) compare the chosen bounded approach.

## Issue37 import history preservation, not recovery activation

Import previews, immutable applied reports and origin mappings use existing schema15 registered storage. Preserve all attempts, owner/workspace bindings, sanitized valid source rows, private snapshot/checksum meaning and per-attempt provenance. Rejected raw secret values are not stored. `source_digest` is the sanitized binding checksum described in [data model](data-model.md), not the raw request hash or an authenticated backup signature. Mapping origins are immutable under issue37; changing them may invalidate historical report/replay consistency and requires a reviewed future repair, not silent overwrite.

Issue39 captures these retained import records under the explicit current contract; current restore remains closed until43. Import-only tests are not recovery acceptance and do not migrate existing data. Migrations1–15, frozen V1/schema8 evidence and lockfile remain unchanged. The protected default temporary-directory recovery guard must not be bypassed to claim a green CLI rehearsal.


A fresh current capture ID is reserved across retained recovery jobs and operator control targets. Reusing an ID owned by historical restore/capture or orphan retained control outcomes rejects before closing admission; this prevents the self-bookkeeping projection from hiding unrelated history. Resuming/replaying the same valid current capture job remains supported.


Current HTTP artifact creation generates `artifact_` plus hex identities. Capture independently requires canonical manifest slugs and exact selected committed generation evidence. Unsupported/noncanonical selected identities or unverifiable selected committed metadata reject completeness instead of being omitted; SQL storage is not claimed to enforce that slug restriction globally. Unselected historical generations remain SQL evidence. Signed manifest/receipt `ended_at` is the durable finalization reservation timestamp reused across retries, neither wall-clock completion nor the checkpoint instant. Actual measured durations are separate observations.
