# B0 schema18 compatibility proposal — source inventory and exact boundaries
Status: SQL18 design reviewed; implementation in progress, runtime acceptance pending. Preserve ordinary-restart durability. Volatile alternative is deferred, not accepted.

## Proposed DDL, subject to generated registry validation
```sql
CREATE TABLE observation_slots (
 slot INTEGER PRIMARY KEY NOT NULL CHECK(slot IN (0,1)),
 workspace_id TEXT NOT NULL,
 task_id TEXT NOT NULL,
 project_id TEXT,
 run_id TEXT NOT NULL,
 agent_id TEXT NOT NULL,
 runtime_instance_id TEXT NOT NULL,
 credential_id TEXT NOT NULL,
 authority_epoch INTEGER NOT NULL CHECK(authority_epoch>=1),
 maintenance_generation INTEGER NOT NULL CHECK(maintenance_generation>=0),
 mapping_digest TEXT NOT NULL CHECK(length(mapping_digest)=64),
 session_id TEXT NOT NULL UNIQUE,
 session_epoch INTEGER NOT NULL CHECK(session_epoch>=1 AND session_epoch<=9007199254740991),
 high_water INTEGER NOT NULL CHECK(high_water>=0 AND high_water<=9007199254740991),
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
 metadata_bytes INTEGER NOT NULL CHECK(metadata_bytes>=0 AND metadata_bytes=length(CAST(metadata_json AS BLOB))),
 UNIQUE(workspace_id,task_id,run_id)
);
CREATE TABLE observation_records (
 session_id TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence>=1 AND sequence<=9007199254740991),
 ingest_order INTEGER NOT NULL UNIQUE CHECK(ingest_order>=1 AND ingest_order<=9007199254740991),
 received_at INTEGER NOT NULL CHECK(received_at>=0),
 record_json TEXT NOT NULL CHECK(json_valid(record_json)),
 record_bytes INTEGER NOT NULL CHECK(record_bytes>=0 AND record_bytes=length(CAST(record_json AS BLOB))),
 PRIMARY KEY(session_id,sequence)
);
CREATE INDEX observation_records_eviction ON observation_records(ingest_order,session_id,sequence);
```
No hidden tables in schema17. Allocate the whole batch internal ingest_order range from current retained MAX+1 under the same transaction, check safe-integer overflow BEFORE insert/eviction; reset only when no retained rows. Never expose this ordinal; wallclock rollback does not reorder eviction. Historical reads require current task visibility AND captured project_id visibility for BOTH tasks:read/events:read under one refreshed actor. Null captured project requires unrestricted project grant, not a wildcard. Writes require captured project still equals current task.

No domain FK required: current task/run/credential relationships are checked transactionally at ingress, not inferred from the diagnostic rows. All records must refer to a current slot session by source invariant; replacement deletes records before slot rewrite. Capture validation independently rejects orphan rows and malformed metadata. Neither table is a domain authority reference target. Absence of SQL FK must not become permission to accept orphan rows or trust backup content.

`metadata_json` is closed canonical JSON containing only repository/checkout opaque IDs, configured coverage, best-effort completeness, latest batch/replacement receipt, retained range and truncation marker. No proofs/tokens/private local roots. Metadata accounting MUST include duplicated scalar columns/IDs plus JSON encoding—not only metadata_bytes column. Define slot-accounting as UTF8 canonical encoding of the complete typed slot projection including its scalar columns; records count the complete stored record projection including session/sequence/time. These totals are computed by server and checked against16384metadata/262144combined limits with2slot/256per-session/512total row caps. Stored byte columns are integrity aids, not authoritative caller-supplied budgets. Recompute in tests and on read/restore validation. Reject inconsistent source storage.

## Admission/invalidation
Every observation transaction rechecks current installed epoch and maintenance generation, current actor/run/proof and exact configured mapping_digest. If config generation changes, delete both diagnostic tables within the existing configuration mutation transaction where possible; also fail closed and clear on detected mismatch before any new diagnostic admission/read. Maintenance/recovery access closes the observation ingress through existing currentConfiguration gates. Ordinary process restart loads SQL unchanged. No implicit deletion from constructor unless authoritative generation mismatch is established.

## Recovery matrix
1. Preserve genuine17 registry as a separately named immutable constant before introducing18; registryForSchema(17) must never alias new current tables. Schema15/16 retain original exact table columns;17 retains events.creation_binding and creation_admissions.
2. Current18 capture includes both new diagnostic tables in authenticated source manifests/chunks; validate structural rows, counts, closed metadata and references while capturing. New mode is explicitly invalidated diagnostic data, not an undocumented exclusion.
3. Restore authenticates original source bytes/receipts first, then uses the existing CLOSED-target staged insertion pattern: insert original18 observation rows, validate the complete original relationship graph and bounds BEFORE any destructive transform, then explicitly delete observation_records before observation_slots in the resumable transform phase. This is deliberate invalidation, not implicit cleanup or skipped source validation. Diagnostic reads/writes remain denied throughout restoring/closed phases; imported sessions never become usable. Source consumption counts/hash evidence remain distinct from final target counts, which must be exactly0 for both tables at verification/probes. Source17 has no such tables; target18 defaults them empty. Old signed manifest remains source17, not relabelled18. Historical captured project/run tuples may validly differ from current task project or have expired/revoked runtime: source validation proves historical structural integrity, NOT current execution eligibility. Mandatory tests crash/restart before/after insertion, original validation, each deletion step, and final verification; old-session read/write attempts must fail in every phase. Existing release fencing is unchanged.
4. Update target-schema.ts/current restore admission, decode registry selection, restore-rows/count summaries, restore-verify/probes, control/capture selectors and operatorCLI registry dispatch. Maintain source17 physical restart/continuation under same exact release identity. Cross-build old pinned restore remains denied; no release fence extension.
5. Genuine17 fixtures: before changing source, produce signed original17 captured snapshot; source captured/retired; target partial-import and completed restore snapshots with matching objects. Test17backup→fresh18, same-boundary continuation/authorized resume and wrongrelease denial. Preserve original15/16 evidence unchanged. This is test fixture production, not live backup/deployment.

## Native profile arithmetic and boundary inventory
Frozen17 S accepts17 migration rows, reads18 lookahead, raw288, bridge739. Current18 S must accept18/read19, raw304, bridge780: +41 per S execution. Existing130 executions imply +5330 => bridge total180805484, query admissions2555 unchanged, canonical budget unchanged only if actual derived vectors prove it. Current17 exact canonical1..17 list fits424;independent canonical JSON byte measurement is247 for1..17 and262 for1..18, both below424; signed full-profile budget still requires generated tests. Private observer query1 rows17→18, raw136→144, JSON494→523; recompute every per-observation frequency ledger. Attachment3phasepair lane adds6×41=246 from current2368938 to2369184. These are calculated proposals, not executed acceptance.

Add explicit schema18 descriptor/catalog/fixture/required-commitment profile identities and hashes. Preserve all frozen16/17 artifact bytes and exported decoders. Full chain: worker selected-state/fixture admission/required controller, Node profile selection/catalog, signed fixture+ledger policy/config, service bootstrap/custody/host/preparation/observation/output consumers, current Miniflare fixture and exact profile negative tests. Keep equal-length reviewed profile tags if envelope caps depend on length; never silently widen caps or reinterpret absent tags as18. New observations are NOT added to frozen R2 required-operation inventory/grants. Shared helper reuse is allowed only with byte-compatible frozen outputs. Generate/check18additively and prove schema17profile vs physical18 rejects.

## Local adapter queue closure proposal (smaller chosen source option, pending final review)
Linux-only pilot; pinnedNode24.22.1 and verifiedutil-linux flock prerequisite. Each invocation independently opens the SAME stable lock inode with no-follow/create0600 under owner-only0700directory, then passes that independently opened FD to its own fixed-argv flock child (no shell). Never share one preopened FD across hook contenders: flock owner is the open-file-description. Never unlink/rename the lock inode during terminal cleanup. No time-based lock stealing.

Hold lock across read/validate state→persist pending→bounded HTTP→persist settled receipt. Fixed files only: empty lock, state.json, state.tmp. State JSON max131072UTF8bytes includes at most64 projected records/65536bytes, one frozen request<=32768bytes and metadata<=16384bytes with actual serialized total checked. state.tmp uses fixedname only while lockheld; write+fsync temporary, atomic rename onto state.json, fsyncdirectory BEFORE network. Settled receipt/epoch must likewise be durable before successor. Only clean up stale temp after lock acquired; never remove state with unresolved pending except explicit diagnostic cleanup that labels UNKNOWN. Both state files can coexist at bound, so logical filecontent max262144bytes plus stable emptylock; filesystem allocation overhead is not claimed equal to this logical cap.

No raw hook input, token/runtimeproof, transcripts, stdout or absolute roots persisted. Paths are still sensitive: no global/tmp-shared directory or repository files. Independent raw stdin bound1MiB+wholehook2s; contention/overflow emits no event, alwaysbest-effort/unknown completeness, no durable loss marker promise. Neutral empty success output only, never modeldecision/permission/context. Multiprocess actual flock tests must prove only one dispatch; childcrash releaseslock; pending durable beforeHTTP; commit-response-loss retainedUNKNOWN; late responses cannot rebind run. No localSQLite/WAL/journal requirement remains. Realhostversion validation and hookactivation remain separate.

## Stop/go
No B1 until closed schemas/error/cursor projections, exact atomic file/lock protocol and logical/physical accounting bounds, derived native18 budgets, genuine17 fixture plan and independent compatibility review have zero material findings. Phase A exactheadCI remains a separate prerequisite. No live hooks, credentials, service namespace, migration/deploy or merge occurs from this document.

### Exact local lock/atomic-state sequence for deferred adapter tests
1. Validate the private configured directory and fixed regular single-link files without following symlinks; reject unsafe ownership/mode/path before reading. Independently open stable `lock`0600 for THIS invocation. Spawn pinned util-linux `flock` with fixed argv `--nonblock`, inherited numeric FD only (no command/shell); only this child's FD shares this invocation's open-file-description. Success acquires the lock on the description retained by the reporter parent process until its final close. Other invocations independently open the same inode and therefore contend correctly. No long-lived shared FD passed across all hooks.
2. With lock held, bound-read and validate state; capture immutable launch binding. Write fixed `state.tmp` with exclusive/no-follow validation and bounded bytes, fsync file, rename same-directory, fsync directory. Only AFTER all durability steps succeed may dispatch begin. Failure holds/returns neutral without dispatch; never treats a failed fsync as persisted pending.
3. Bound HTTP by remaining wholehook budget; on timeout/abort or malformed response retain exact pending bytes as UNKNOWN. A remote commit after cancellation is possible. Never unlock and then dispatch or settle a response from the old generation. No background retry/waitUntil or model-facing output.
4. Matching success or authorized exact receipt readback is persisted via the same fsync/rename/directory-sync sequence before any next operation. Close the lock FD in finally after the HTTP operation is settled/aborted; do not spawn a child retaining it after return. Process death releases the open description when its final FD closes; no timestamp lease takeover.
5. Cleanup under this same lock may remove only stale fixed temp and explicitly retired state; never unlink/rename lock. Missing/corrupt state does not reconstruct old payload from current run: explicit UNKNOWN/current-status/coverage-loss path. For source tests, pin exact Node/util-linux versions in the test receipt; live Claude/runtime versions and adapter configuration require a separately verified activation manifest, not guessed 'latest'.

`st_size` caps apply before allocation and after writes to both regular state files; fixed maximum131072each. Allocation blocks, filesystem metadata, executable overhead and process heap are separately measured/not falsely equated to the logical262144file-content bound. Host disk quota/isolation and malicious same-UID writers are outside advisory flock's guarantee; an unsafe/shared state directory disables the reporter rather than weakening checks.
