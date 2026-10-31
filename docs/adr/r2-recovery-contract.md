# R2 recovery envelope and trusted artifact mapping

Status: Historical decisions retained; issue43 conditional schema16 restore amendment below. No released or live-accepted recovery capability is claimed.

Sections before the issue39 amendment describe their named historical checkpoint, not current runtime availability. The amendment explicitly supersedes those activation/status statements; historical wire examples and signatures remain unchanged.

## Decision and alternatives

The owner delegated technical choices during MVP development. Choose distinct operator-owned private artifact and recovery bindings (D2). `RecoveryWorkspaceV2` requires `artifactBucket` alongside existing `bucket`; current R1 construction deliberately does not implement this capability. Never fall back to another bucket when the binding is absent. Caller-selected bucket/key/URL authority is rejected. A single bucket with separate prefixes was considered, but increases collision and configuration risk without simplifying the existing trust boundary.

The frozen issue22 format uses `artifacts/{workspace_id}/{artifact_id}/{sha256}` and `r2/{workspace_id}/{capture_id}/artifacts/{artifact_id}/{sha256}`. **This is historical wire evidence, not the schema12/13 production key contract.** The gateway/domain owner derives them from committed SQL metadata, not user filenames, supplied URLs or public configuration. Manifest validation requires exact equality, unique IDs and unique keys. #32/#33 must preserve immutable generation identity; no mutable overwrite is permitted. A changed digest is a different generation, never replacement of the committed artifact identity.

The [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) supports private bindings and conditional writes. Future #39/#43 copies must use conditional create-if-absent and, on retries, verify the existing object's actual size and SHA-256 before accepting it. ETags are not SHA-256 evidence. [Strong consistency](https://developers.cloudflare.com/r2/reference/consistency/) does not make SQL plus object writes atomic. [Streaming reads](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/) avoid buffering all artifacts. No bucket was provisioned or live request performed for this decision.

## Closed compatibility boundary

| Input | Format/semantic contract | Current runtime |
| --- | --- | --- |
| V1, schema7, original empty artifact arrays | Existing HMAC, SQL representation and complete registered table coverage | Frozen codec/registry; legacy harness exercises schema7. Current WorkspaceDO upgrades supported open storage to13. |
| V1 with artifacts, unknown fields or incompatible schema | Reject | Reject before writes |
| V2, schema7 synthetic format fixture | Bounded envelope only; schema7 has no committed-artifact metadata table | `RECOVERY_FORMAT_UNAVAILABLE` |
| V1 or V2, schema8–13 | Issue24 complete typed registry exists, but operational semantics are not implemented | Unavailable before side effects until #39/#43 |

`validateManifestShape` validates the envelope's declarations; `verifyRecord` authenticates canonical bytes. Neither proves bytes exist or grants admission. `verifyManifest` preserves its signature but rejects V2 explicitly. Capture rejects nonzero artifact budgets before workspace access. Thus a widened future-facing schema does not silently activate runtime recovery. Existing V1 fixtures and historical receipts remain unchanged. No generic V1-to-R2 restore mapping is invented.

## Bounded restart contract

`JobDetailsV2` is a future type only; current `rowJob` remains version1-only. Its entire canonical `details_json` must be at most 262144 bytes, including manifest, ledger, keys and bookkeeping. The signed manifest is the single immutable inventory. `RecoveryArtifactTransferState` contains its digest, verified artifact index/bytes, phase and at most one pending reservation. The reservation binds operation ID, request fingerprint, index, artifact ID, exact keys, size and SHA-256. No array of duplicate per-artifact receipts is appended.

#39/#43 must validate checkpoint/index against the frozen manifest, sum exactly the completed prefix, and reject `complete` unless all SQL chunks and all committed artifact bytes have been read and verified. Pending must reference exactly the next immutable entry; completion requires pending=null. Advance index/counts once, after digest verification and maintenance/authority recheck. Guard before and after every await; a crash retries the same identity without incrementing twice. The standalone shape validator does not prove these state-machine or byte-presence obligations. Missing committed bytes must fail completion in the future runtime tests.

A SQL transfer-receipt table was considered but requires #24 migration and typed registry coverage. Bounded single-inventory JSON fits the already bounded manifest and existing jobs owner without another ledger. If future metadata cannot fit the whole-document bound, fail closed and obtain a reviewed storage design; never truncate or omit entries.

## Experiment and simultaneous ceilings

A Node 24.22.1 UTF-8 JSON sizing experiment using SHA-256 immutable names measured 402 bytes for one illustrative entry, 40101 for 100, 80201 for 200 and 401001 for 1000. These are sizing observations, not throughput benchmarks or guaranteed production capacity. A checkpoint-only progress structure stayed 170–173 bytes. The [reproduction script](../r2-task-plans/evidence/issue-022/size.mjs) and [result](../r2-task-plans/evidence/issue-022/sizing.json) are retained with the implementation evidence.

All ceilings apply together: 1000 artifacts, 10 MiB each, 256 MiB combined SQL+artifacts, 65536-byte manifest, 256 SQL chunks, 1 MiB/chunk, 200 rows/page and 1000000 total rows. The chunk/page combination permits at most 51200 represented rows. The artifact-count ceiling does not promise that 1000 inventory entries fit the manifest. Tests therefore distinguish per-field schema limits from complete canonical manifest limits. Reject excess without truncation.

## Authority overlay and downstream obligations

D1 remains the reviewed single provenance registry decision: preserve identity and historical metadata within snapshot coverage; newer current ledger/epoch revokes old human-managed credentials and runtime proofs, including credentials absent from the old snapshot. Only independently anchored current static grants activate. Retained active dynamic identity advances to the new epoch without resurrecting archived identity or granting scopes; fresh human issuance uses the current operator ceiling. #24/#26/#43 own implementation and negative/fresh-issuance tests.

Restore consumes/revokes login/session records, leaves R3 approval JSON disabled, holds uncertain runs/effects, and never auto-resumes/redrives. Current ledger, source retirement, fresh probe, reconciled effects and explicit exclusive resume remain necessary. A complete capture receipt is not admission. After explicit resume only, perform fresh task/review acceptance. Real acceptance remains deferred to the owner's post-R4 stage, never waived.

## Issue24 compatibility implementation

Issue24 established the complete schema8 registry; forward migrations now extend the current registry through13. `table-registry-v1.ts` freezes historical wire meaning. The shared fence algorithm accepts a closed explicit version policy: ordinary callers use current13, and only the V1 recovery lane supplies7. Its central context check rejects any sequence except exact1–7 before replay/effects. Current production recovery therefore fails closed. Frozen/non-open7 cannot be auto-upgraded; the original migration gate remains. The test-only historical storage/scheduler harness is explicitly not production WorkspaceDO. It preserves original migration bytes and tests real SQLite/eviction, not a deployment or current-runtime recovery-success claim.

## Issue32 generation identity amendment and closed recovery gate

Product writes use `artifacts/{encoded_workspace_id}/{encoded_artifact_id}/{generation_id}/{sha256}`. The server allocates a fresh generation identity for every newly accepted upload intent, even for identical bytes. A late old put must never share the key selected by a newer generation. Conditional create is defense in depth, not a substitute for persisted reservation, drain evidence and current-authority selection. Independent review approved the minimal schema12 admission evidence; original migrations1–11 and historical manifests remain unchanged. See [artifact execution](../r2-task-plans/issue-032-execution.md).

This intentionally conflicts with frozen V2 semantics: `spec/recovery-manifest.schema.json` permits a bounded string key but has no generation identity field and an unconstrained positive checkpoint-schema number; its generated owner is `src/recovery/generated/recovery-validators.js`. `src/recovery/manifest.ts` additionally requires exact digest-only keys, V1 table counts and schema7; its `verifyManifest` rejects V2 operationally. `test/contracts/r2-recovery-amendment.test.ts` explicitly proves generation-qualified keys pass the historical string shape but fail semantic identity validation, and schema12 passes the numeric shape but fails semantic format validation. Frozen examples under `examples/recovery/` are not rewritten.

Before #39 capture or #43 restore activates, their reviewed amendment must: bind each entry and pending effect to the exact committed generation ID/key/version/digest/size; add exact current schema/registry representation; retain explicit historical decoding or reject it, never reinterpret old signatures; apply generation-aware duplicate/mapping checks to source and destination keys; resize the complete manifest/job budget using longer keys; refuse capture while any put/delete effect is reserved/in-flight/uncertain; verify both bucket bytes and SQL associations; invalidate incomplete/legacy-unknown stages and old runtime authority on restore; repeat delayed-put/tombstone/copy/crash/maintenance/restart races and missing-byte completion denial. Distinct operator-approved bucket mappings remain mandatory.

No activated exporter can emit a supposedly valid incompatible manifest: `src/recovery/protocol.ts::assertRecoveryContext` rejects every schema sequence except1–7 before replay/effects, `src/recovery/capture.ts::advanceCapture` rejects nonzero artifact budgets, and `verifyManifest` rejects operational V2. These gates remain intact. At the historical issue32 checkpoint, schema12 capture/restore and public artifact ingress were **unavailable**. Issue33 supersedes only the source-ingress gate below; current schema13 capture/restore remains unavailable, not accepted.

## Issue33 cleanup consumer amendment

Schema13 adds bounded cleanup scheduling and separate current delete fences without changing immutable upload admission or historical wire fixtures. Composed32/33 review permits conditional source artifact ingress under an explicit separate product binding; default/dev remain unbound. Unknown operation outcomes are durable holds, not HEAD-proven drains. The shared maintenance transition blocks current completion/resume while any put/delete is unresolved; exact schema7 retains its historical no-artifact policy. Inventory observations cannot authorize deletion. Any existing capture/restore job has unknown artifact coverage until39/43 supplies a reviewed exact-generation inventory and therefore conservatively protects cleanup candidates. See [execution evidence](../r2-task-plans/issue-033-execution.md) and [operations](../operations.md).


## Issue39 current capture amendment (revision0.2, schema15)

**Owners and scope.** The integration/contract owner explicitly authorizes a third disjoint manifest branch: `format_version:2`, `checkpoint.contract_revision:0.2`, `checkpoint.schema_version:15`. Required `generation_id` and `artifact_version` preserve the immutable #32/#33 product identity. Source key is `artifacts/{workspace_id}/{artifact_id}/{generation_id}/{sha256}`; recovery key is `r2/{workspace_id}/{capture_id}/artifacts/{artifact_id}/{generation_id}/{sha256}`. IDs are canonical slugs, generation IDs are `generation_` plus48lowercase hex digits. Duplicate artifact/generation/key mappings reject. This does not repair or reinterpret revision0.1 signatures. Both original schema branches, frozen V1 registry/fixtures, schema8 evidence and migrations1–15 remain unchanged. No migration16 or second ledger is introduced; the read-only storage owner approved existing jobs/chunks capacity.

**Admission.** Exact current schema15 admits only capture/status/read-chunk. Other versions cannot inherit this permission. Restore, write-chunk, verify, probe, resolve, retire and resume remain closed before replay/effects; `verifyManifest` still denies operational V2. The current typed SQL codec is explicitly format2/schema15 and covers all36registered tables; format1 keeps its historical registry. Current CLI orchestration remains a later owner obligation, not implicit in schema widening.

**Checkpoint amendment.** Persist barrier closure before waiting, with `capture_drain` and null checkpoint. Require all dispatched put/delete effects terminal before checkpoint/counts/inventory/first SQL page; exact callbacks are allowed to settle before that point. This supersedes the historical blanket statement about all reservations: **never-dispatched reserved intents stay fenced unfinished evidence**, not a reason to invent terminal drain or dispatch after closure. Unknown/in-flight effects stay held indefinitely with bounded resumable status; timeouts, HEAD/LIST and matching bytes cannot clear them. Outbox/scheduler/inventory continuations enforce the same admission fence. Mutable current recovery controls cannot modify the snapshot.

**Projection and authority.** Capture every registry mode, including archived identities, native/runtime verification hashes, revoked credentials, accepted results and private history, exact stored approved-input JSON, immutable imports and retained recovery controls. Exclude only current job/chunks/control outcomes to avoid recursive self-bookkeeping; historical control object references are retained SQL evidence, not recursively copied old recovery sets. Freeze the source maintenance row. Current login nonce and PKCE verifier cells become empty strings without source mutation; this invalidated-secret projection is explicit and does not claim byte-identical raw SQL. Captured proof hashes and reservations never become restore authority. Complete receipt's unresolved-effect summary retains existing outbox semantics, not an assertion that task/run uncertainty is absent.

**Restart/publication amendment.** A strict version2 loader owns bounded `recovery_jobs.details_json`; the legacy loader remains version1-only. One unexposed unsigned draft inventory exists only after checkpoint and acquires verified SQL metadata. It is replaced, not duplicated, by the final signed manifest. At most one exact pending artifact is stored; verified prefix/index/bytes must agree. Conditional copies read actual destination bytes on new write or retry; ETag, declared checksum and object existence alone are insufficient. Recheck proof, installation epoch/digest, maintenance fence, frozen source release/catalog/binding IDs and exact operation around awaits. Within a reserved step, an admission-validated immutable baseline is compared byte-for-byte against every authoritative job row field at each await; proof/installation/fence/barrier/binding checks still read current authority. This is not cached admission or a timestamp/version shortcut. Full typed inventory and separate SQL receipt coverage are revalidated at admission, counted completion and before signing/publication. Any concurrent diagnostic/phase/pending change aborts conservatively. Trusted opaque bucket handles are pinned per call; deployment declarations remain an external prerequisite, not caller authority.

**Bounds.** Size-only SQL candidate queries prevent materializing200near-limit rows before selecting a page. Actual SQL streams are capped despite untrusted object metadata. Artifact hashing/copying uses one producer chunk and serial slices≤64KiB, without whole-object buffers or tee. All limits above apply simultaneously; full progress/job serialization is checked before HMAC publication. Longer generation-qualified entries make1000artifacts an independent ceiling, not a guaranteed admissible manifest. A finite safe diagnostic code set never persists external exception text. Failure keeps unsigned/incomplete evidence and closed admission; successful authenticated capture also stays closed. #43 must separately implement restore relationships/overlays/runtime invalidation and deliberate cutover. Live acceptance is deferred afterR4, not claimed from local tests.

See [capture behavior](../backup-restore.md#current-capture-semantics), [research/measurements](../research/r2-capture-runtime.md), and [issue39 execution](../r2-task-plans/issue-039-execution.md).


A fresh current capture ID is reserved across retained recovery jobs and operator control targets. Reusing an ID owned by historical restore/capture or orphan retained control outcomes rejects before closing admission; this prevents the self-bookkeeping projection from hiding unrelated history. Resuming/replaying the same valid current capture job remains supported.


Current HTTP artifact creation generates `artifact_` plus hex identities. Capture independently requires canonical manifest slugs and exact selected committed generation evidence. Unsupported/noncanonical selected identities or unverifiable selected committed metadata reject completeness instead of being omitted; SQL storage is not claimed to enforce that slug restriction globally. Unselected historical generations remain SQL evidence. Signed manifest/receipt `ended_at` is the durable finalization reservation timestamp reused across retries, neither wall-clock completion nor the checkpoint instant. Actual measured durations are separate observations.

## Issue42 auth-return schema16 and frozen15 continuation

The read-only task board requires an exact `/tasks` authentication return. Existing migration2 constrained `login_attempts.return_path` in SQLite; HTTP enum changes alone therefore fail. Additive migration16 rebuilds this one transient-auth table, preserves all prior rows and rowids, defaults, nullability, uniqueness, range and expiry checks, and recreates the expiry index. Only the return-path CHECK gains `/tasks`; migrations1–15 and historical wire branches remain unchanged.

New normal admission and capture use exact contiguous schema16, with a separate disjoint format2/revision0.2/schema16 manifest branch and matching SQL chunks. Schema15's original branch remains unchanged. The registered table/column representation is unchanged; this does not activate restore or broaden the accepted recovery operations. Every operational chunk is bound to its own captured schema version, never silently decoded as another version.

A deployment while schema15 is already frozen must not strand an authorized capture. The constructor retains15 only after exact contiguous schema validation, the complete typed registry and a unique coherent existing capture agree with maintenance state, workspace metadata, epoch, barrier, generation and retained chunk records. Arbitrary frozen states do not bypass migration's existing refusal. Only that existing capture ID can continue or be read; a new15 capture is denied. Ordinary admission remains closed and the source stays15, rather than auto-upgrading behind the immutable checkpoint.

An existing15 checkpoint retains its original producer revision/worker-version while still requiring the current exact environment, catalogue and bucket-binding declarations. Before the first checkpoint no captured producer exists, so the executing build is recorded explicitly together with schema15. New16 captures keep the strict current producer checks. This narrow continuation rule does not grant old runtime/session execution authority, import data, release maintenance or implement cutover. The retained original pre16 fixture is used for actual new-constructor eviction/continuation/readback tests; synthetic fixtures and local source tests remain distinct from deployed recovery acceptance.

See [issue42 execution evidence](../r2-task-plans/issue-042-execution.md). Current restore/control is still owned by issue43; operator/client orchestration remains issue46.


## Issue43 isolated schema16 restore and current controls

The accepted tuple is exactly V2, semantic revision0.2, captured schema16 and an empty isolated schema16 target. Historical V1/schema7 stays separate. Retained schema15 remains capture/read/status only; no implicit schema upgrade, source relabeling or imported executable recovery jobs is allowed. All 36 registered tables are covered. No SQL migration is introduced.

A deployment-owned service binding supplies a bounded fresh, independent authoritative ledger anchor. Its response binds workspace, environment, object name, positive epoch, digest and monotonic generation; the configured binding identity is also pinned. Every asynchronous cryptographic, bucket, stream or alarm continuation is followed by a fresh observation and synchronous local proof/installation/fence/job check. The provider must be linearizable and independent; that property is an issue46 integration obligation, not established by a TypeScript interface or test fake. The default capability is absent and fails closed.

The restart sequence is: bounded import with cyclic FK pointer staging; bounded restoration of original source pointers; original typed and semantic relationship validation; exact source database digest; full committed artifact byte verification/copy; bounded final authority and execution invalidation; bounded missing-current-authority additions; restored maintenance receipt. No destructive transformation can conceal an invalid original task/run/result association. No stage opens admission or dispatches old effects.

Artifact copies preserve exact generation-qualified identity, use conditional creation, hash existing and newly copied bytes, and apply backpressure with at most 64 KiB writes. Never-dispatched reserved generation evidence remains reserved; it is not invented drainage or a cleanup authorization. In-flight/uncertain source effects contradict complete capture and deny restore.

The actual authenticated operator adapter has finite raw parsing plus exact operation and server-job caps: restore 137765 bytes, verify 72218 bytes, resume 203479 bytes; each nested signed record remains at most 65536 bytes. Other accepted operations and V1 retain the 65536-byte envelope. Resume cannot select a version through its body. Exact epoch0 restore admission retry is the only narrow stale-epoch exception and requires the fresh target installation digest and unchanged original identity/fingerprint.

Current controls keep bounded internal pending/completed admission evidence separate from the public receipt and immutable capture job. Retire/resume completion records the exact post-transition state; replay verifies both records, outcome digest, fresh anchor and current local state before returning the prior result without effects. Source capture evidence is never rewritten to add this admission.

Recovery expiry audit events use the truthful system:recovery producer, not the natural lease-expiry identity. Current visibility requires non-importable bounded provenance, completed schema16 restore, exact source page/offset and task/run/fence/history correlation in addition to ordinary current authorization. The development workflow includes genuine source capture, eviction, authenticated malformed-source cases, byte/rotation failures and actual HTTP-to-DO envelopes. Local results are not release acceptance; actual provider/client integration and post-R4 rehearsal remain pending.

### Issue43 reviewed engine metadata compatibility

A genuine alarm probe followed by recapture revealed the engine-owned `_cf_METADATA` table. Current schema16 inspection accepts only its exact observed type, name, owner and SQL declaration on the pinned workerd runtime; case variants, extra owner objects and schema drift fail closed. This is not a broad internal-name exemption. All 36 product table definitions and `sqlite_sequence` checks remain mandatory. Historical schema15/V1 policy is unchanged.

The table is never a product registry entry and its contents are never read, copied, imported or deleted by recovery. The platform alarm API retains ownership. The [pinned metadata implementation](https://github.com/cloudflare/workerd/blob/v1.20261019.1/src/workerd/util/sqlite-metadata.c%2B%2B) and [SQL access regulator](https://github.com/cloudflare/workerd/blob/v1.20261019.1/src/workerd/api/sql.c%2B%2B) explain its creation and application-access restriction. This exact engine shape is not a promised public API: an incompatible runtime must fail with `RECOVERY_ENGINE_SCHEMA_INCOMPATIBLE` and receive explicit compatibility review, not silently skip unknown tables. Real-alarm repeated-recovery regression evidence is required in the checkpoint.


## Schema17 original-creation admission amendment

Schema17 adds one private pending-authority table and one nullable private event column.
The reviewed schema15/16 registry is frozen separately from the schema17 registry; format2,
revision0.2 readers select columns and table coverage using the authenticated source schema.
Existing row/chunk/manifest/job/combined-byte ceilings are unchanged and apply to the new
table as part of the same totals, never an extra unbounded side channel.

Restore accepts16 and17 into an isolated17 target. Hash and source-cell verification use
the original source tuple; only the explicit16-to17 insertion mapping supplies NULL for
`events.creation_binding`. Verification requires that added column to remain NULL on16
imports. Source migration sequence1 through its declared schema version is validated via
exact manifest count, bounded versions, and globally strictly increasing primary keys;
source migration rows remain evidence while target migrations remain17. There is no
reinterpretation, re-signing or mutation of retained16 bytes or receipts.

All source17 `creation_admissions` are invalidated during the existing closed-gate authority
transform, including records prepared before capture and consumed later in the lost future.
The final completion and restored-target resume gates independently reject any remaining
reservation. Source capture/resume and ordinary restart do not consume live reservations.
An event binding is historical evidence only and remains subject to current authorization
and event retention. No new recovery credential, signing key, external effect or operator
authority is introduced. Source manifest schema and target readiness schema are distinct;
existing restore receipt provenance binds the original source manifest without relabeling it.


Physical16 lifecycle continuity is separate from importing a16 backup into a fresh17 target.
The constructor retains only coherent captured/capturing or existing restoring/restored16
jobs (and retired16 capture authority), with exact physical registry, workspace, epoch,
barrier, generation, manifest and chunk-prefix checks. Current anchored controllers own16
and17;16 must never fall through to legacy7 controllers. A retained16 restore uses16 target
columns/counts without rewriting its closed job, source hashes or receipts. Retirement
remains frozen16. Authorized resume performs the canonical17 DDL and schema ledger insert
inside the same SQLite transaction as gate transition and control completion; SQL/bookkeeping
failure leaves16 closed and retryable. No scheduler/network await occurs inside that SQL
transaction. The new17 registry is inspected before a successful resumed admission.
