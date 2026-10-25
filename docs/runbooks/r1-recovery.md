# R1 operator recovery protocol

Status: recovery core and finite CLI implemented and exercised locally; deployed rehearsal and release acceptance pending. Remote Service Auth, current-ledger deployment, real recovery drill, dependency/security gates and release approval still require separately recorded evidence.

The [static credential runbook](r1-static-credentials.md) describes the authenticated installation boundary. This runbook describes the finite recovery implementation for workspace SQL, messages and outbox. Local test evidence alone does not establish a production backup or release. The [command schema](../../spec/recovery-command.schema.json), [manifest schema](../../spec/recovery-manifest.schema.json) and [example set](../../examples/recovery/r1-commands.json) fix finite request shapes. The operator gateway is a separately deployed Worker at an exact protected HTTPS origin, never a route or binding on the public product Worker.

## Isolated Worker pairing

Select the same named environment for the application and the separate operator configuration. The checked-in templates pair these Worker names:

| Environment | Application Worker | Operator Worker |
| --- | --- | --- |
| `test` | `cf-agent-hub-test` | `cf-agent-hub-operator-test` |
| `dev` | `cf-agent-hub-dev` | `cf-agent-hub-operator-dev` |

Each operator environment explicitly binds `WORKSPACE` to its matching application's `WorkspaceDO` and repeats `OPERATOR_POLICY` and `BOOTSTRAP_INTEGRITY_KEY` in `secrets.required`. Wrangler does not inherit [Durable Object bindings](https://developers.cloudflare.com/durable-objects/reference/environments/) or [secret declarations](https://developers.cloudflare.com/workers/wrangler/configuration/#secrets-configuration-property) into named environments. Provision the reviewed environment's secret values separately.

The operator templates disable `workers.dev` and preview URLs and specify an empty route list. Before an authorized isolated rehearsal, review the exact protected operator route, Access Service Auth policy, target allowlist and resource ownership for that environment. These names and bindings do not establish a deployed target or grant operator authority. Do not pair a named application environment with the default operator configuration.

## Operator admission and commands

The CLI loads exact origin and environment/workspace allowlist from protected operator configuration and sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` from a protected file or descriptor on every request. It refuses redirects and does not rely on a `CF_Authorization` cookie. The gateway validates the Cloudflare Access service assertion signature, configured issuer/audience, `type='app'`, time claims and signed `common_name` service-token client ID against the explicit operation/target allowlist. Service-token `sub` is empty; a human JWT, caller header, product session or bearer is not authority. Access Service Auth policy, provider availability and operator allowlist are all required. Verified operator identity and target/epoch form an internal `RecoveryOperatorContext`; untrusted JSON cannot supply it. Only the separate gateway invokes binding-only WorkspaceDO recovery methods. Install uses the same attribution.

`POST /operator/recovery` accepts exactly `install,capture,read-chunk,restore,write-chunk,verify,probe,resolve-delivery,retire,resume,status`. The closed envelope requires `operation,workspace_id,capture_id,expected_authority_epoch,operation_id,reason,payload`; capture ID is null only for install/probe. Identical `operation_id`/payload replay returns its original result only after rechecking current operator authorization and the required installed epoch; changed payload conflicts. The existing original-install replay exception described below is specific to install. JSON control envelope plus payload is at most 65,536 UTF-8 bytes. The payloads are respectively `{config,verification_bundle}`, `{budget}`, `{index}`, `{manifest,ledger}`, binary metadata `{index,sha256,byte_size}`, `{manifest}`, `{}`, `{delivery_id,disposition,evidence_sha256}`, `{}`, `{receipt_id,ledger,source_retirement_receipt,cutover_record}`, and `{job_id}`. No SQL, arbitrary table/object name or destination is accepted. Delivery resolution is a separately authorized operation: `confirmed_delivered` records trusted receiver receipt; `failed_without_redrive` leaves delivery permanently failed. Both require retained external evidence digest, create an immutable private receipt and create neither ACK nor another attempt.

Install compares `expected_authority_epoch` to current installed epoch (0 for empty authority), verifies config target matches authenticated environment/workspace and requires new `config_epoch` strictly greater than installed epoch; skipped epochs are permitted. Other operations compare installed epoch before starting and again before async completion. A stale operation fails closed. A different operation ID with identical already-installed material is a new non-advancing install and is rejected. Original matching install replays reauthorize before stale CAS, and verified service-proof expiry is checked after asynchronous preparation at SQL transaction entry. The approved protected bundle and current-authority ledger are outside captured SQL.

Recovery permissions remain explicit in each service entry. The optional closed `OPERATOR_POLICY.recovery` object is `{integrity_key_id,current_ledgers:[{workspace_id,authority_epoch,sha256}]}`. Each anchor is the digest of the complete canonical, authenticated current ledger and its exact approved epoch. Updating this external policy is a separate operator act; a self-consistent historical ledger in the backup cannot declare itself current. The WorkspaceDO runtime requires `RECOVERY_ENVIRONMENT_ID`, `RECOVERY_INTEGRITY_KEY_ID`, a dedicated base64 `RECOVERY_INTEGRITY_KEY` (32–128 bytes), and closed `RECOVERY_RELEASE` JSON `{revision,worker_version,binding_ids}`. These are trusted deployment bindings. `CF_VERSION_METADATA.id`, when present, supplies the actual Worker version. No recovery request selects a binding or secret.

## Durable bounded progress and lost responses

The [closed response schema](../../spec/recovery-response.schema.json) separates `RecoveryJobProgress` from the terminal `RecoveryReceipt`. A capture invocation processes one page or bounded digest pass. Restore initializes a paused target; each write accepts one chunk; each verify invocation processes one chunk, the digest pass, or the authority overlay. Progress exposes only job identity, phase, counts, pending operation identity, the next finite operation, and nullable receipt/manifest metadata. It never returns SQL rows through JSON. The entire JSON response remains below the control limit.

Persist the operation ID and exact request before sending it. A pending step reserves that ID and fingerprint in SQL before R2 work. Retry the same request after a transport failure; use a new operation ID only after the prior result is durably known. Successful R2 writes followed by lost SQL completion reuse the same content-addressed object and chunk position. A changed repeated chunk or changed intent conflicts. Job identity is deterministic: `job_` plus the first 48 lowercase hexadecimal digits of SHA-256 over canonical JSON `[workspace_id,capture_id,"capture"|"restore"]`.

Restore initialization changes the empty target epoch from 0 to the approved ledger epoch. If its response is lost, replaying the original expected-0 request must fail. Issue a new authorized `status` request at the ledger-derived target epoch and deterministic restore job ID, and verify its persisted capture/job identity. Do not bypass the expected-epoch check to obtain replay. Status/read-chunk are read-only; every asynchronous read still rechecks current epoch and maintenance generation before returning.

## Binary chunk transport

`write-chunk` uses `application/octet-stream`. `X-CFHub-Recovery-Control` holds unpadded base64url canonical UTF-8 JSON for the same closed envelope, with payload exactly `{index,sha256,byte_size}`. The encoded header is at most 8,192 ASCII bytes; index is 0–255, SHA-256 is lowercase 64-hex and byte size is 1–1,048,576. Authenticate service, target and installed epoch before accepting bytes; bound streamed bytes and verify actual length/digest rather than trusting Content-Length. `read-chunk` stays a JSON request with `{index}`; success returns `application/octet-stream` and `X-CFHub-Recovery-Chunk`, unpadded base64url canonical UTF-8 JSON of closed `{capture_id,index,sha256,byte_size}` under the same header and byte bounds. Ordinary responses/errors stay JSON receipt/envelope data. The CLI never logs row bytes. If platform header/body limits prove narrower, fail closed and amend this contract before transport.

## Capture and manifest

Establish a durable maintenance barrier before a checkpoint. It blocks domain mutation, login/session issuance, dispatch and destructive maintenance across restart while allowing restricted diagnostics. Every ordinary admission and asynchronous completion requires the exact compiled migration sequence and the captured `{authorityEpoch,maintenanceGeneration}` fence. Migration 0007 retains a monotonic maintenance generation even after same-epoch resume. In-flight callbacks recheck both values before SQL updates; a legacy non-open maintenance row also prevents migration even if old metadata still says installed. Physical alarm operations that complete late reconcile to current paused/open authority before returning. Drain admitted dispatch inside its lease or record unknown disposition; no completion crosses the frozen checkpoint.

Capture a versioned typed logical SQL export, not database-file bytes or arbitrary SQL. The runtime table registry must compare every table, column, type, primary-key order and restore mode against `sqlite_schema`; an unregistered item fails complete capture. The R1 registry is `schema_migrations,workspace_metadata,human_grants,static_agents,native_credentials,login_attempts,sessions,profiles,preferences,threads,thread_participants,messages,inbox,events,idempotency_outcomes,outbox,scheduler_state,maintenance_state,recovery_jobs,recovery_chunks,probe_receipts`. The observed Workers schema contains those 21 application tables plus explicitly checked `sqlite_sequence`, for 22 covered tables. There is no prefix exclusion. `checkpoint.event_sequence` preserves the validated `sqlite_sequence` high-water for `events`, including previously deleted event IDs; it is not `MAX(events.sequence)`. Domain/history IDs and event sequence remain stable. SQL pages have at most 200 rows; typed-row JSON tags binary as base64 and rejects unsafe integers/unknown columns. The exact canonical UTF-8 chunk object is `{format_version:1,capture_id,index,table,columns,rows}`. `columns` follow registry order; rows are arrays of typed SQL values. Nullability, safe integer bounds, primary-key order and exact columns are checked. Binary values use closed `{type:"blob",base64:"..."}` with canonical padded base64. The database SHA-256 hashes raw canonical chunk bytes concatenated in ascending global index with no separator; the byte size is the same sum. The Worker feeds a bounded `crypto.DigestStream` and never buffers the whole database. Each chunk has at most 1 MiB, each manifest at most 65,536 bytes and 256 chunks, and required operator budgets cap 1,000,000 rows and 268,435,456 bytes. Exceeding any bound yields failed/incomplete evidence, never a truncated complete manifest.

Freeze source control-record projections at barrier establishment: maintenance uses the retained barrier row, the current capture job/chunks and exact current capture receipt namespace are excluded, and probe writes are refused while capture/restore is running. Historical control records remain immutable evidence. Capture work is tracked separately, avoiding recursive capture. Scheduler state is recomputed on restore. Login attempts/sessions restore revoked/consumed, with nonce and PKCE values cleared in active target SQL. Source metadata, migrations, scheduler, maintenance, recovery jobs/chunks and probes remain evidence; they never become active target control state. Authority tables remain inaccessible behind maintenance until the current-ledger overlay. Typed parameterized inserts into an empty isolated target are restart-safe by `(capture_id,table,chunk_index,digest)`; changed repeated chunk conflicts. Verify chunk digests/counts, complete registry and relationships before signing complete status. R1 artifact arrays are empty; future versions extend this manifest.

The manifest records format version 1, checkpoint, release binding IDs (unique 1–32 bounded identifiers, never secret values), the single captured workspace `{workspace_id,object_name}` catalog mapping, SQL counts/chunks and HMAC auth. Authenticate canonical manifest with only `auth.tag` omitted; retain `auth.key_id` and `auth.algorithm` in the preimage, using a dedicated operator-managed integrity key outside snapshots. Recovery files are AES-GCM encrypted under a different protected key, created exclusively 0600. Metadata stdout contains neither rows nor credential hashes. A complete receipt alone does not open admission.

## Restore, proof and resume

`CurrentAuthorityLedger` is independently authenticated and retained outside SQL. Restore requires latest approved ledger, with target epoch higher than manifest epoch and every recorded prior authority. Validate immutable credential actor/hash IDs, overlay current membership/restrictions/revocations and invalidate restored sessions/login attempts. Pending/in-flight notifications remain paused; absent trusted receiver receipt is unresolved, not evidence of nondelivery. Preserve attempt counts and replay history; never auto-redrive uncertain effects.

`probe` records a receipt only after actual transactional write/read, forced rollback with absence verification, exact schema, and physical scheduling checks. Its exact check names are `sql_write_read`, `rollback`, `schema`, and `scheduler`. It is unavailable during an incomplete capture/restore. The private stored wrapper binds the receipt to the installation digest and maintenance generation; freshness is at most 300,000 ms. Readiness reads this trusted receipt, not a caller-supplied assertion. `retire` writes a durable permanent barrier plus authenticated closed retirement receipt identifying source environment, workspace, epoch and barrier. A target `resume` requires matching authenticated source retirement receipt and cutover record, the latest external ledger, actual target catalog mapping, target epoch strictly higher than source and a fresh passing probe. Records prove reviewed linkage; they never create routing from supplied JSON. If source cannot be retired, fail closed for a separately reviewed outage-recovery procedure. Ordinary capture may resume its original unchanged source from its complete capture receipt if no target cutover/retirement occurred. In either path require zero unresolved effects, complete verified receipt and exclusive authority. `resolve-delivery` may record a trusted delivered receipt or explicit permanent failure, never a fresh attempt. Retirement prevents later source resume at that epoch. A successful resume receipt links `probe_id`, `old_generation`, and `new_generation`; readiness may validate that linkage after the generation advances. Keep private system-actor operator receipts outside restored state and never reenroll a principal silently.

Install control receipts use the permanent `operator.install` namespace in `idempotency_outcomes`, keyed by verified principal, workspace target and operation ID. Restore excludes every imported `operator.*` control outcome from active target SQL and preserves the target's own control history. Source control bytes stay in authenticated capture chunks. Domain idempotency outcomes keep their IDs and responses. Fresh request IDs and service-proof expiry are not part of the stable install-intent fingerprint.

## Local verification commands

The primary Workers runner exercises registry/barrier, exact-schema admission, capture/restore, crash retry and probe alarm behavior:

```sh
npx vitest run --config vitest.workers.config.ts test/recovery/r1-recovery.test.ts test/recovery/admission-schema.test.ts test/recovery/core-flow.test.ts test/recovery/crash-fences.test.ts
```

Operator transport requires its separate runner, which binds the operator Worker to actual source/target WorkspaceDO Workers and R2:

```sh
npm run test:operator
npm run typecheck
npm run verify:generated
```

`operator-transport.test.ts` intentionally does not run in the primary application Worker project. Run it through `vitest.operator.workers.config.ts`; do not substitute a mocked public recovery route. The tests use synthetic keys and local bindings, and do not claim a deployed Access policy, current-ledger approval or production cutover. Release verification remains the single O2/O3 process recorded by the release owner.


## Executable finite CLI

The CLI entrypoint is `scripts/recover-workspace.mjs`. It exposes exactly `capture,restore,verify,probe,resolve-delivery,retire,resume,status`; installation remains the existing static-credential/install helper. `read-chunk`, `write-chunk` and target `verify` pages are internal finite continuations, never arbitrary SQL or object-key interfaces.

```sh
node scripts/recover-workspace.mjs --help
node scripts/recover-workspace.mjs capture --input /protected/source/capture.json \
  3</protected/service.json 4</protected/integrity-key.json 5</protected/snapshot-key.json
```

Use the same protected inputs when resuming an interrupted command. Each actual HTTP invocation has one attempt. Known successful progress may cause the controller to issue the next finite step, with a new deterministic operation ID. Unknown network or response outcomes stop the process; a subsequent explicit invocation retains the exact operation ID, expected epoch, canonical body and binary digest. The default per-invocation request budget is1024, configurable from1 to2048. Exhausting it returns `RECOVERY_BUDGET_PAUSED` with encrypted progress retained, not a truncated complete snapshot.

### Protected files, descriptors and layout

The executable targets the reviewed POSIX Node runtime. Input configuration, authority ledgers, cutover records and receiver evidence must be owner-only regular files. Secret descriptors must be inherited descriptors3 or greater backed by owner-only regular files, with one link; pipes, standard input and broadly readable files are rejected. No secret value is accepted in a command-line flag. A service descriptor contains only `{client_id,client_secret}`; a key descriptor contains only `{key}`, with canonical padded base64 key bytes.

The manifest/ledger HMAC key is32–128 bytes. The separate AES-256-GCM snapshot key is exactly32 bytes, with a different key ID and value. Keep both key source files outside the snapshot directory and captured state. A different key under an existing ID does not decrypt old state and is not a recovery override.

Directories must exist as private owned directories, or capture may create its one artifact directory under an already private parent. All runtime input/output paths must be absolute and outside any checkout. The configuration file, state path, current ledger, receiver evidence and cutover record must be outside the entire controller-owned `artifact_directory`. The generated portable source-retirement record is intentionally read from that directory. Use sibling locations, for example:

| Purpose | Example |
| --- | --- |
| Source configuration/state | `/protected/source/capture.json`, `/protected/source/capture-state.enc` |
| Target configuration/state | `/protected/target/restore.json`, `/protected/target/restore-state.enc` |
| Encrypted snapshot and receipts | `/protected/snapshot/` |
| External current authority | `/protected/authority/target-ledger.json` |
| External reviewed cutover | `/protected/authority/cutover.json` |
| Secret source files | `/protected/keys/` |

The artifact directory belongs to the controller: `manifest.enc`, `chunk-0000.enc` through `chunk-0255.enc`, `retirement.enc`, encrypted exact request/response records and encrypted CLI receipts. Never place a configuration, key source, mutable authority ledger or state file in that namespace.

New artifacts are exclusively published0600 with fsync. Existing artifacts are reused only after decryption, exact context authentication and byte identity checks. The state journal is encrypted and atomically replaced only against its known previous ciphertext. If a process dies between the publication hard link and unlink of its temporary alias, the encrypted reader may repair only its one owned same-inode `.cfhub-recovery-<32 lowercase hex>` sibling in a private owned directory. It authenticates the AES-GCM payload/context first, requires exactly two links and mode0600, then removes only that alias, fsyncs and verifies a single remaining link. Unrelated/multiple links and wrong keys or contexts remain errors; plaintext inputs and secret FD readers never repair hard links.

### Capture configuration

This is a structural template, not an installed target or an approval record. Replace the origin, environment, workspace and catalog object with an independently approved disposable source. Supply keys and credentials through the referenced protected descriptors.

```json
{
  "format_version": 1,
  "origin": "https://source-operator.example.invalid",
  "environment_id": "isolated_source",
  "workspace_id": "ws_example",
  "object_name": "source_workspace",
  "allowed_workspace_ids": ["ws_example"],
  "expected_authority_epoch": 1,
  "operation_id": "capture_rehearsal_one",
  "capture_id": "capture_rehearsal_one",
  "reason": "Reviewed disposable R1 recovery rehearsal",
  "service": {"principal_id": "recovery_operator", "credentials_fd": 3},
  "integrity": {"key_id": "recovery_integrity", "key_fd": 4},
  "encryption": {"key_id": "snapshot_encryption", "key_fd": 5},
  "state_path": "/protected/source/capture-state.enc",
  "artifact_directory": "/protected/snapshot",
  "budget": {"max_rows": 10000, "max_artifacts": 0, "max_total_bytes": 67108864},
  "max_requests": 1024
}
```

The origin is an exact approved HTTPS origin. The transport always posts to its `/operator/recovery` path, refuses redirects and sends only the Access service headers and finite content headers. It sends neither product cookies nor native bearer credentials. The installed gateway remains responsible for verifying service identity, current scope, target and epoch; a configuration label is not authority.

Capture follows durable progress through at most200 rows per server page. A complete authenticated manifest is exported, each authorized opaque chunk index is read and checked against its signed digest/size/table/count, and exact bytes are encrypted before the next chunk. Whole-database verification hashes plaintext canonical chunks incrementally in index order; it never buffers the whole database. No SQL rows, nonce/PKCE material, credential hashes, keys or full ledgers are printed.

A genuine fresh operator workspace can contain its actual `configuration.installed` audit event. Do not remove an installed audit fact to manufacture an empty capture or dashboard.

### Local verification

Create a verification configuration with the same captured source identity/epoch, capture ID, artifact directory and keys, but a distinct operation ID and state path such as `verify_rehearsal_one` and `/protected/source/verify-state.enc`. The service section may be omitted for this command.

```sh
node scripts/recover-workspace.mjs verify --input /protected/source/verify.json \
  4</protected/integrity-key.json 5</protected/snapshot-key.json
```

Public `verify` is entirely local. It authenticates the manifest, checks complete registry/count/order/typed chunk boundaries, decrypts each chunk, verifies every byte digest and the concatenated database digest, and returns `outcome:"verified_local"`. It does not contact the gateway, claim current remote authority or manufacture a probe.

### Restore and interrupted initialization

Restore uses the same encrypted snapshot and decryption/HMAC keys, a distinct target operator identity/origin, a distinct state path and operation ID, and an independently approved current ledger. The target environment must differ from the captured source environment; the gateway still enforces the actual empty target and approved catalog mapping.

Change the common fields to the disposable target and add:

```json
{
  "expected_authority_epoch": 0,
  "operation_id": "restore_rehearsal_one",
  "state_path": "/protected/target/restore-state.enc",
  "current_ledger": {
    "path": "/protected/authority/target-ledger.json",
    "authority_epoch": 2,
    "sha256": "<SHA-256 of the complete canonical authenticated approved ledger>"
  }
}
```

Omit the capture budget. The actual ledger epoch must be greater than the manifest source epoch; skipped epochs are permitted. The ledger HMAC, exact external anchor digest, target environment, workspace, object mapping and installation digest are checked before restoration. The gateway independently compares its current external approved anchor. Do not treat a backup's historical ledger as current.

```sh
node scripts/recover-workspace.mjs restore --input /protected/target/restore.json \
  3</protected/target-service.json 4</protected/integrity-key.json 5</protected/snapshot-key.json
```

The controller handles initialize → one authenticated binary chunk per step → one verification page per step → stream digest → current authority overlay until a terminal receipt. It never resets attempt counts or automatically redrives uncertain delivery.

If initialization might have committed but its response was lost, the next invocation first issues a new persisted, authorized `status` request at the ledger-derived target epoch and deterministic restore job ID. A successful matching status continues at that epoch and sends no expected-zero initialization again.

A canonical authenticated JSON409 `CONFLICT` from that status is **not evidence that the target is empty**. The controller may make at most one globally journaled guarded attempt of the exact original expected-zero request, with the same operation ID/body/fingerprint. Current gateway epoch CAS and transactional empty-target checks remain mandatory. This lets an original request that never reached an untouched epoch-zero target proceed, while an already installed or unrelated-epoch target rejects it without mutation. Text/plain, malformed or unvalidated denials do not authorize this guarded attempt. Another ambiguous/conflicting result leaves the journal intact and stops; subsequent successful ledger-epoch status may still reconcile it, but no second expected-zero attempt is generated. Seek explicit operator review if authority cannot be established. Do not delete the journal, refresh the expected epoch, select a different ledger or reinitialize a target merely to conceal the failed scenario.

### Probe, resolution, retirement, resume and status

Each deliberate control action has its own operation ID and state path. Reuse the same protected configuration to reconcile that action after interruption. Do not reuse one operation ID across unrelated source/target workflows sharing the artifact directory.

| Public command | Additional configuration | Evidence / behavior |
| --- | --- | --- |
| `probe` | `capture_id:null`; current target/source epoch | Calls actual rollback/schema/scheduler probe; a failed check remains failed evidence. |
| `resolve-delivery` | `resolution:{delivery_id,disposition,evidence_path,evidence_sha256}` | Hashes protected external evidence; records explicit delivered proof or permanent failure, never ACK/redrive. |
| `retire` | Complete locally verified source snapshot; source epoch | Receives authenticated source retirement and exports portable encrypted `retirement.enc`. |
| `resume` | `current_ledger` and `resume:{receipt_id,source_retirement_path,cutover_path}` | Requires real server probe, resolution and exclusive-authority checks. Both proof paths are null only for unchanged-source resume. |
| `status` | `job_kind:"capture"` or `"restore"`; current epoch | Reads the deterministic durable job/receipt after process restart; each completed status query may be refreshed. |

Example control invocations retain the same descriptor pattern:

```sh
node scripts/recover-workspace.mjs probe --input /protected/target/probe.json \
  3</protected/target-service.json 5</protected/snapshot-key.json
node scripts/recover-workspace.mjs resolve-delivery --input /protected/target/resolution.json \
  3</protected/target-service.json 5</protected/snapshot-key.json
node scripts/recover-workspace.mjs retire --input /protected/source/retire.json \
  3</protected/source-service.json 4</protected/integrity-key.json 5</protected/snapshot-key.json
node scripts/recover-workspace.mjs resume --input /protected/target/resume.json \
  3</protected/target-service.json 4</protected/integrity-key.json 5</protected/snapshot-key.json
node scripts/recover-workspace.mjs status --input /protected/target/status.json \
  3</protected/target-service.json 5</protected/snapshot-key.json
```

For target resume, `source_retirement_path` points to the exported encrypted `retirement.enc`; `cutover_path` points to a separately approved authenticated JSON cutover record outside the artifact directory. The CLI verifies both records and their source/target/capture/receipt linkage. It does not create a cutover authorization or routing mapping. Never retire production during the first rehearsal: both authorities must be separately approved disposable isolated deployments.

A `confirmed_delivered` resolution requires independently checked trusted receiver evidence, not a provider2xx alone. `failed_without_redrive` is an explicit permanent-failure disposition. The CLI sends only the exact evidence digest and chosen finite disposition; it does not interpret arbitrary provider formats as trusted proof.

Recovery receipts contain `unresolved_effect_count` (the exact SQL count observed at their `ended_at`), at most64 sorted unique `unresolved_effect_ids`, and `unresolved_effect_ids_complete`. The prefix length is exactly `min(64,count)`; the completeness flag states whether it is exhaustive. Original receipts are immutable historical observations. Never infer the total or live remaining effects from the list length, and never mutate a historical receipt after resolution. Each explicit resolution response supplies a new observed remaining summary; server resume independently requires the live SQL count to be zero.

### Completion, receipt evidence and safe failure

The encrypted state retains exact pending commands before dispatch and exact encrypted request/response records after acknowledgement. A successful terminal control response is revalidated from those original encrypted records after a process interruption; it is not replaced with a newly generated retire/resume/resolution command. The exact CLI finish result, including `completed_at`, is journaled before immutable receipt publication. Restart may finish the same publication without changing its content or redispatching a committed action.

Successful stdout is a redacted wrapper with `format_version,operation,origin,environment_id,workspace_id,capture_id,job_id,outcome,request_id,completed_at,command_sha256,response_sha256,response_operation_id,response_attempt,response_file,manifest_sha256,receipt,local_verification,progress`. It contains canonical receipt metadata, not SQL rows or secrets. Exact raw gateway request/response bytes remain encrypted for independent digest binding. A local verification has no gateway response/request ID; a status projection shows phase/counts/pending operation and next finite operation. `completed_at` is CLI completion time; canonical receipt timestamps retain the server observation time.

`outcome:"complete"` means that finite action completed, not recipient ACK, task completion, fresh current authority, production readiness or release. Reinvoking an already completed non-status action may return its retained historical receipt; use a distinct authorized status/probe intent for fresh observations. Errors print only a bounded category, optional HTTP status, safe server category and request ID, with a nonzero exit code. Raw exception text, response bodies, configuration paths, credentials and row data are not printed. Missing target access, failed probes, unresolved effects, stale authority, invalid artifacts or absent independent review remain explicit blockers.

The proposed package scripts are `recover:workspace: node scripts/recover-workspace.mjs` and `test:recovery-cli: node --test test/cli/*.test.mjs`. They are merged by the release owner into the single R1 check pipeline. Local protocol tests, actual local HTTPS/Workers smoke and crash regressions do not satisfy deployed Service Auth/OIDC/recovery rehearsal or promotion gates. Those gates remain pending until actual external observations and independent review are retained.
