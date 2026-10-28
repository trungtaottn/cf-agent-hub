# Data model

Status: R2 schema15 and local source through reviewed create-only imports · Contract revision0.1 · Later-round commands and live acceptance pending.

This page defines conceptual ownership and invariants. The local storage and successive identity/task/artifact/result producers are described in the issue-scoped sections below. Other conceptual behavior is not automatically an enabled command. JSON field spelling and request schemas are defined in [HTTP API](http-api.md) and [OpenAPI](../spec/openapi.json). Database table/index design must preserve these invariants while being verified against the chosen runtime.

## Entity ownership

| Entity | Stable identity and ownership | Important relationships and invariant |
| --- | --- | --- |
| Workspace | Operator-provisioned workspace ID | Maps to one Durable Object; profile edits cannot reroute it |
| Human principal | Verified `(issuer, subject)` | Display name/email are attributes, not identity keys |
| Membership | Workspace + principal | Role and grant ceiling; revocation checked on each command |
| Agent | Workspace + agent ID | Capability declarations and lifecycle; not a model name or credential |
| Runtime instance | Workspace + runtime ID | One registered agent binding, credential-bound runtime-proof hash and freshness state |
| Credential/grant | Workspace + credential ID | Opaque native token verification hash, bound agent, scopes, expiry/revocation; raw token is not stored |
| Project | Workspace + project ID | Stable profile entry; archive rather than silently deleting referenced work |
| Work role | Workspace + role ID | Work classification/eligibility hints; never an authorization role |
| Task | Workspace + task ID | Intent, state, versions, assignment, run/result pointers and retry budget |
| Run | Workspace + run ID | One task execution attempt, agent/runtime binding, lease and fence |
| Approval | Workspace + approval ID | Specific task proposal/version, human decision and expiry |
| Message/thread | Workspace + message/thread ID | Immutable actor attribution, references, recipients and delivery tracking |
| Artifact | Workspace + artifact ID | Metadata lifecycle and server-owned R2 object key |
| Event | Workspace + event ID | Append-only actor/action/resource/version evidence |
| Outbox item | Workspace + delivery ID | Destination, attempt count, due time and delivery disposition |
| Idempotency outcome | Workspace + principal + operation + key | Request fingerprint and committed response outcome |

IDs in examples are synthetic. Clients must treat IDs as opaque and use the IDs returned by the server. An ID that belongs to another workspace must never resolve through a global fallback lookup.

## Task and run records

The proposed task representation contains `id`, `workspace_id`, `title`, `description`, `state`, `task_version`, `proposal_version`, nullable `project_id`, `work_role_id`, `assigned_agent_id`, `active_run_id`, `latest_run_id`, `approval_id`, nullable `result`, `retry_count`, `retry_limit`, `flags`, `created_at` and `updated_at`.

`active_run_id` is non-null only when the task is Doing and the referenced run remains active. `latest_run_id` preserves the last attempt even after authority is released. A current result belongs to one submitted run and records its submitting principal and agent, allowing independent acceptance checks even after credential rotation. Historical results and decisions remain auditable when a task is requeued.

The run contains `id`, `workspace_id`, `task_id`, `agent_id`, `runtime_instance_id`, `status`, `run_version`, `fence`, `lease_expires_at`, `started_at` and nullable `ended_at`. Fences increase monotonically per task; they are not timestamps and clients cannot choose them. A unique active-run constraint plus transaction guards enforces one active owner. Internal run/audit evidence also retains the trusted retry-safety policy decision applicable at claim; expiry defaults to uncertainty when no preexisting replay-safe classification exists. A run's nonactive status is terminal for that attempt.

`task_version` advances for committed task-domain mutations. `proposal_version` advances when issuing a new decision proposal. `run_version` advances for run changes including heartbeat. A renewal must not modify task/proposal versions. Use integer versions for compare-and-swap; timestamps alone cannot detect competing edits reliably. The exact transition increments are part of the [lifecycle contract](task-lifecycle.md).

## Identity and attribution

Authorization roles, work roles and runtime capability labels have separate fields and separate validation. An agent's display name cannot turn it into a human or administrator. A human-to-agent action records both the authenticated principal and the target agent without pretending the agent initiated it.

Each event records the request correlation ID, workspace, actor kind and stable actor identity, action, affected resource, resulting versions and server timestamp. Events should reference sensitive payloads rather than duplicating secrets or entire uploaded files. Redaction and retention must preserve enough context to explain decisions while following workspace policy.

## Approvals and result history

An approval references one current proposal with task/proposal versions, scope, inputs, checkpoint, expiry and the eventual human decision. The implementation must preserve the original proposal alongside the decision. A new proposal cannot overwrite a past approved or rejected record. Approval state and task state change in one transaction; an event cannot claim approval while the task still awaits a different proposal.

A result contains a bounded summary and references to committed artifacts. Result submission is not acceptance. Independent review checks the stable submitting principal and agent, not just the token used in the last HTTP request. Archived agents and revoked credentials must remain referentially resolvable for historical attribution.

## Delivery and artifacts

A message's acceptance, destination transport result, recipient ACK and any referenced task state are distinct records. Delivery attempts reference an immutable payload version or a canonical stored envelope, so a retry cannot silently deliver a different command under the same identity. ACK records are idempotent per recipient and message.

Artifact metadata tracks staging, expected digest/size, upload state, committed digest/size, creator, associations and the upload intent expiry. An expired intent is a durable cleanup tombstone; a committed artifact has no active upload deadline. Only server-generated object keys are persisted. Cleanup must first atomically mark an expired uncommitted intent as unavailable for upload/commit before deleting bytes. A late in-flight upload is reconciled as an orphan. Checking for a reference and then deleting without a durable exclusion can race a valid commit and is forbidden. Artifact access derives from workspace grants and association rules; R2 object existence alone is not access. Orphan detection compares metadata with bounded object inventories and restore manifests. Retention must not remove an artifact still required by a retained accepted result without an explicit retention event.

## Index and migration requirements

Expected indexes include scoped task state/order, agent active runs, due leases, pending approvals by expiry, outbox due time/status, thread order, event order and idempotency expiry. Uniqueness includes scoped entity IDs, idempotency keys and applicable active-run constraints. Query plans and per-workspace storage growth must be measured before release.

Restoration must not reuse authority issued after a recovered snapshot. Maintain an enforced recovery epoch or advance fences beyond all previously issued values, and overlay current revocations before reopening admission. Restored active runs cannot simply resume.

Application schema versions are distinct from Cloudflare class lifecycle configuration. Migrations must be versioned, restart-safe and rehearsed on representative snapshots. Destructive changes require an export and verified restoration path; rolling code back does not automatically roll data back. Import uses explicit external IDs and provenance mappings with dry-run reconciliation, never reusing an external owner/run/approval as trusted active authority. See [development](development.md) and [backup and restore](backup-restore.md).

## R1 atomic message admission

R1 admission uses forward application migration 4 after the preference-owner migration 3. Fixed membership is `(thread_id, participant_kind, participant_id)`, with kind exactly `human` or `agent` and a composite primary key. Human IDs are principal IDs; agent IDs are agent IDs. Membership joins the owning thread for workspace isolation. Initial membership is the sender plus unique addressed agents; a reply cannot add members. The closed request has no subject, so a new thread stores empty subject text. An authorized reviewer can read under current policy but cannot send into a thread without membership.

A recipient requires its current installed static identity and one coherent enabled, unexpired, nonretired same-epoch credential with `messages:read` and applicable resource access. Credential scopes and project restrictions are never combined. R1 messages have no project association, so a project-restricted read grant cannot authorize their workspace-wide content. Fixed human participants use their enabled current installed grant without inventing a session. The real caller keeps its own verified credential/session and current authorization; another credential cannot broaden its proof. Every message reference is checked for the actual caller and every fixed participant, including participants omitted from the reply. Task/artifact references remain unavailable in historical R1; local R2 issue34 adds them under the same current coherent-grant rule.

The command wrapper's existing synchronous outer transaction owns thread/participants, immutable message, one inbox row per addressed recipient, the sole accepted event, notification intent, scheduler marker and durable outcome. The internal fourth execute argument is the wrapper's reserved accepted event ID. Notification event ID and acceptance time match that event exactly. Failure at any insertion rolls back all families. IDs and retry jitter are reserved from owned entropy before SQL. A valid replay reauthorizes and returns its original outcome without executing again. Accepted DTOs have null ACK; later recipient projections expose only that recipient's ACK.

Each new outbox row stores immutable canonical `MessageNotification` JSON and canonical protected `destination_snapshot_json` with exactly `{agent_id,url,signing_key_ref}`. URL is the validated HTTPS URL's canonical serialization; snapshots contain references, never key values. `deliveryId` maps to both `id` and `notification_id`; payload `delivery_id` is identical. Descriptor `attemptCount:0` maps to `attempts=0`, `nextDueAt` to `next_due_at`, status is `pending`, lease/disposition fields are null, and `created_at`/`updated_at` equal acceptance time. Jitter is persisted in `[0.8,1.0]`. There is one intent per enabled destination of an addressed agent, independent of credential count or other thread members.

Migration 4 preserves old outbox bytes, identities, destinations, status and attempt counts and adds `suppressed`. Legacy routing snapshots remain SQL NULL when their original route cannot be proved. Such rows are non-executable history; current catalog values must not be used to manufacture a snapshot. Scheduler state adds `dirty` (0 or 1, default 0) and a nonnegative integer `generation` (default 0). Each inserted intent sets dirty and advances generation in the acceptance transaction. Tasks 8/9 use the shared transaction-only marker for scheduling-relevant changes. Task 9 owns claiming, alarms and delivery; Task 11 validates typed identities, notification version/linkage and routing snapshot relationships before any recovery dispatch and recomputes scheduling under maintenance authority. Preserving legacy history does not activate delivery.

## R2 import provenance and immutable plans

The unique mapping is `(workspace, source_namespace, external_id)` to local task ID and canonical source-row SHA-256. Exact repeats do not rewrite tasks; changed source conflicts. Source revision belongs to attempt metadata, not the row hash. A preview ID immutably binds original source rows/hashes and mapping/reference snapshots, trusted creation and owning principal/workspace internally. The public digest commits its public preview, not omitted input bodies. Apply cannot replace those internal snapshots or partially commit after a revalidation failure.

Version-1 preview rows use create/unchanged/conflict/rejected. Version-2 report rows use created/unchanged/conflict/rejected with exact partitioned counts and contiguous indices. Authorized created/unchanged report rows carry the closed ImportProvenance for the current attempt (including revision, original state and inert reference); rejected/conflict rows carry null provenance. Unchanged provenance records this attempt without asserting a task/mapping overwrite. Preserve provenance in permitted audit history as well. Task remains its existing closed DTO; imported state is never local authority and every newly created task starts Backlog. Issue24 supplies the tables and issue37 supplies local create-only commands; current recovery integration remains with39/43.

## Executed storage boundary (issue24)

Migration `0008-durable-work.sql` appends to unchanged versions1–7. The [complete storage manifest](../validation/r2-storage-contract.json) enumerates all35 application tables, every column/default/primary/foreign key and complete SQLite table/index SQL (including CHECK predicates). The typed current registry is reviewed source, not generated from the live database being captured. `sqlite_sequence` remains the sole recognized engine table and only events uses it.

`static_agents` retains its historical physical name and is the single identity registry. Existing agent/credential IDs, verification hashes, ceilings (including JSON null versus []), retired/disabled/expired rows and message/outbox/replay bytes survive adoption. Metadata defaults are neutral; existing installed_at supplies creation time. Fresh static installations use trusted install time. Cross-workspace/origin collisions reject atomically. Dynamic issuance, epoch revocation and active/archived authentication rules remain #25/#26; no dynamic route is activated by migration.

New families are runtimes; tasks/runs; results, ordered artifact links, acceptances and history; artifacts and immutable generations; artifact/message associations; catalog/import previews and provenance mappings. Runtime restore mode is invalidate and generation mode paused-effects; these are obligations for #43, not implemented recovery transformations. Existing modes remain unchanged. Nullable task proposal/approval and event evidence fields preserve compatibility without enabling R3.

Immediate composite foreign keys bind workspace/task/run/result/generation identity. One partial unique index enforces at most one active run per task; terminal runs require ended_at and task Doing requires a non-null active pointer. Counters are positive and task-local fences/submission sequences are unique. The allocator fields next_fence and next_result_sequence must advance in the owning command; schema alone does not enforce monotonic updates, pointed-run status, immutable history, independent acceptance or current artifact authorization.

**Ordered mutation protocol:** create task with nullable pointers; insert its run; set Doing and active/latest pointers in the same synchronous transaction. Insert result/generation before attaching its pointer. Immediate checks reject cross-task/workspace IDs. Any later failure rolls back all writes. Deferred constraints were rejected after actual Workers savepoint tests demonstrated delayed violations could reset the object; no second global transaction validator was introduced.

Artifact generation rows retain expected and observed digest/size, admission epoch/generation and current effect identity/kind/state/start/drain evidence. A single slot requires serialized external operations: never replace in-flight/uncertain work or dispatch cleanup delete until the prior put is conclusively drained. Future effect owners retain immutable evidence needed before advancing a drained slot; no simultaneous put/delete tracking or optimistic drain is promised. Polymorphic associations and actor/creator consistency require command guards. Imports retain original source rows, preview/report snapshots, digest, scoped mapping identity, originating import and provenance JSON.

Schema8 operational recovery is deliberately unavailable until #39/#43 implement the complete versioned restore/capture semantics. V1 / schema 7 codec/registry remains frozen; it cannot omit new tables to produce a partial backup. See [backup/restore](backup-restore.md). Source tests and index observations do not establish deployment, throughput or R2 acceptance.

## Issue25 identity lifecycle persistence

The legacy-named `static_agents` remains the single identity registry, with immutable `operator_static | human_managed` provenance and versioned metadata. `native_credentials` retains immutable identity/hash binding, provenance, issuing human and independent local revocation. No parallel identity/grant store or new migration is introduced. Legacy empty static labels are projected safely as “Operator credential” without rewriting migration history.

Agent archive never deletes attribution: it rejects active runs or nonterminal assignments, then atomically archives the identity and revokes all credentials/proofs alongside event and sanitized outcome. Credential revocation can invalidate an active owner without changing its task/run history. Higher-epoch installation and restore overlay invalidate dynamic credentials/proofs, retain identities and preserve archived/local-revoked state. Same-epoch same-digest ordinary install remains a no-op. The current schema 10 operational recovery interface remains unavailable pending #39/#43; overlay source behavior is not complete recovery acceptance.

Credential DTOs contain metadata only. Raw bearer bytes exist only in private first-response preparation; SQL holds SHA-256 verification material, and replay outcomes always retain `token: null`/`revealed: false`. Current scope/project disclosure checks cover both the current row and original replay metadata. See [agents](agents.md) and [security model](security-model.md) for the authority ceilings and replacement procedure.

## Issue27 query and mutation implementation

The local task domain consumes schema 8 without modifying its migration or introducing another registry. Ordered nullable-pointer foreign keys remain immediate. Task creation writes all server-owned counters/pointers; metadata and Ready increment only task_version. The command wrapper inserts the sanitized event, then its scoped task_history association, then the replay outcome in the same transaction. Profile stable-ID renaming does not rewrite task IDs.

Task listing merges seven fixed-state indexed seek streams in ascending created_at/id order. This is a measured alternative to a new global-order index, not a claim that a generic workspace ORDER BY/LIMIT is bounded. History seeks by workspace/task/submission sequence. Private candidate budgets and whole-response byte limits are recorded in [issue 27 execution](r2-task-plans/issue-027-execution.md). Current Task.result and retained history share complete committed-artifact/generation/result-association authorization. Task-only or unbound artifacts remain supported; non-null task/run bindings must match, and their corresponding associations must exist.

## Catalog lifecycle and index-only schema 9 — local issue 28

Forward migration 0009 adds only `tasks_catalog_project(workspace_id,project_id,id)` and `tasks_catalog_role(workspace_id,work_role_id,id)`. Historical migration 0008 and its manifest remain unchanged; table rows, foreign keys and domain semantics are preserved. Current admission, bootstrap identity adoption and registry checks recognize schema 9. Explicit V1 / schema 7 recovery stays isolated; schema 9 operational capture/restore remains unavailable pending #39/#43.

`catalog_plans` stores the creator principal, exact profile revision, trusted creation/expiry, immutable public plan and private request/complete task-agent version evidence. Only status changes on apply. Terminal tasks and archived agents bind the snapshot but are retained unchanged. A new or removed reference invalidates apply. Original mutation-derived extra scopes survive in private evidence and are required for replay even after references move. The complete current Task/result visibility predicate applies before exposing catalog task IDs. Catalog preview/apply events have fixed summaries, profile resource identity/version, and no task content or reason text. SQL commit includes metadata, profile, plan status, event and sanitized outcome.


## Shared scheduler index-only schema 10 — local issue 30

Forward0010 adds only `outbox_pending_order(status,next_due_at,id)` and `outbox_lease_order(status,lease_expires_at,id)`. Prior0001–0009 SQL and the historical schema8 manifest are unchanged. The registry uses the compiled current sequence; bootstrap's named R2 capability requires membership in that supported sequence and rejects unknown future versions rather than falling back to legacy identity semantics. Genuine9→10 tests preserve all domain rows, including archived/revoked human-managed authority, and cover frozen migration denial, actual-DDL rollback and restart idempotency.

These indexes support bounded ordered candidate subqueries; they do not alone cure the former OR/CASE scan. Split selection retains exact SQLite BINARY ordering and NULL behavior; completion seeks known delivery ID while retaining token/lease/fence checks. Current schema10 operational recovery/probe remains unavailable pending39/43, and schema7 historical receipts remain historical. [Issue30 execution evidence](r2-task-plans/issue-030-execution.md) records review and local checks.

## Issue31 private cancellation/requeue history

Schema11 adds nullable `task_history.reason`. NULL means no reason was recorded for a legacy or unrelated event, not an empty reason. Existing history's event foreign key retains the actor and request correlation. Command and audit producer validation enforce the canonical TaskReasonRequest (nonempty string and the existing65,536-byte request envelope); the nullable SQL TEXT column does not invent an independent field-size or trimming rule. Whitespace and Unicode remain valid under that contract.

Reasons are private retained domain evidence, not ordinary Event summaries, Task/Run DTOs, replay outcomes or logs. The audit writer inserts the event first, then its linked history/reason in the same transaction. Ordinary event projection is fixed/redacted. Current-schema operational capture/restore remains unavailable until its owning issues; schema7 recovery is not schema11 acceptance.

R2 currently has only a dormant `approval_id` pointer, not persisted R3 proposal/decision records. Cancel and explicit Backlog/Review requeue invalidate that pointer and advance task version, but do not claim to settle nonexistent decision rows. R3 must atomically invalidate its eventual pending records when integrating these commands, preserve immutable decision evidence, and repeat the real race tests before exposure.

## Issue32 local artifact admission (schema12)

Forward migration12 adds nullable stage `admission_generation`, generation reservation `artifact_version` and immutable `upload_idempotency_sha256`, plus committed-list seek indexes. Unknown historical values are not backfilled: old uncommitted rows cannot gain new authority. Valid historical committed generations remain readable even with a null active pointer/new admission fields. Original migrations1–11 and historical wire fixtures remain unchanged. Schema11 code cannot be rolled back onto12 storage as a supported operation; use a reviewed forward repair. Current-schema restoration is still gated, not an available rollback mechanism.

The upload identity hashes workspace/principal/operation/target/key; credential/runtime remain separate exact staged-owner checks, so rotation cannot mint a replacement intent. Persist reservation and mark its effect in-flight before a create-only R2 put. Trusted completion settles only the exact operation/kind/generation/current-state slot. Object existence alone cannot prove drain. A drained retry hashes incoming bytes and independently verifies stored bytes without re-putting; ambiguous effects stay unavailable. Final selection CAS requires the reserved base version/admission/deadline; commit re-verifies bytes outside SQL then requires unchanged selected identity and current grant/proof/lease inside SQL. Retained immutable run ID/fence binds execution; no redundant mutable fence field was added.

Each product generation has a fresh key `artifacts/{encoded_workspace}/{encoded_artifact}/{generation_id}/{sha256}`. The [recovery amendment gate](adr/r2-recovery-contract.md#issue32-generation-identity-amendment-and-closed-recovery-gate) documents its incompatibility with historical V2 digest-only keys. At that issue32 checkpoint no current-schema recovery runtime was activated; issue39 now adds only the explicit capture projection below.

That issue32 checkpoint kept ingress unregistered. Issue33 now supplies independently reviewed cleanup/exclusion and shared scheduler integration; source ingress is conditionally registered only with an explicit separate trusted product binding. Default/dev remain unbound, with no deployed activation claim. #34/#35 consume the committed visibility helper without weakening task/message/result association checks. See [issue32 evidence and handoff](r2-task-plans/issue-032-execution.md).

## Artifact cleanup scheduling and drain evidence (schema13)

Forward migration13 preserves all prior migration bytes. `artifacts.expiry_check_at` is a retry/ordering timestamp, **not** the immutable admission deadline `expires_at`; retained-reference deferral never extends a stage's authority. Committed/expired intents clear it. `artifact_generations.cleanup_next_at` and a closed diagnostic code preserve bounded retry/hold work. Exact delete reservations have separate nullable-paired `delete_admission_epoch`/`delete_admission_generation`; original put admission, upload identity and object key never change. Backfill schedules only finite integer legacy expiries, never invents terminal completion or delete authority. Malformed legacy generation times remain NULL/UNKNOWN_GENERATION and require investigation.

`artifact_inventory_state` is one installed-workspace-bound row with opaque cursor (4096 UTF-8 bytes), safe monotonic generation, due/last-scan timestamps and saturating observation counters. Counters count observations, not distinct objects. It is recovery **evidence**, not restored execution authority;39/43 must reset/rebind operational cursors and every effect reservation. Schema13 has36 application tables plus SQLite's exact engine table. Binary12 cannot transparently roll back onto13; current recovery is not a rollback mechanism.

Due candidates are selected through partial workspace/due/id indexes before inspecting retained references; reverse result/message artifact indexes make those checks bounded. One trusted expiry transaction records the permanent tombstone, sanitized system event and shared scheduler marker together. Unknown or uncommitted retained references do not authorize deleting bytes. The [execution record](r2-task-plans/issue-033-execution.md) owns measured query evidence and remaining recovery gates.

## Local R2 message association integration

Issue34 uses existing message_artifacts(workspace_id,message_id,artifact_id,ordinal) and matching artifact_associations message edges. No new table is added. Forward migration14 adds only `credentials_live_read`, a partial workspace/agent/config_epoch/expires_at/credential_id index over enabled, nonrevoked, nonretired native credentials. The query seeks current epoch and future expiry before bounding candidates, so retained history does not consume message eligibility. Original migrations1–13 and frozen schema8/V1 remain unchanged. Binary13 rollback onto14 is unsupported, and current recovery remains closed. Explicit IDs retain exact order; refs_json retains typed refs. Both sides of the relationship and all existing message transaction families commit together. Post-insert visibility checks run before commit so a newly added cyclic edge cannot strand accepted messages beyond the bounded graph budget. Reads/replay/events/dispatch, artifact downloads and retained Task.result/history projections use the same iterative all-edge relationship checks, not a cached ACL or recursive authentication. A visited set deduplicates work only after local scope/membership validation. [Execution and compatibility](r2-task-plans/issue-034-execution.md) describe bounds, unknown/hidden failures and current recovery gates.

## Issue35 immutable result and acceptance producers

Issue35 consumes the existing schema14 tables without a migration. A submitted run has one task_results row with stable actor kind/principal/agent, task/run binding, monotonically increasing task-local submission sequence, summary and timestamp. result_artifacts preserves exact attachment order and artifact_associations retains reverse result links. The result, ended submitted run, Review task pointer/version, scheduler marker, event/history and sanitized outcome commit atomically; requeue/cancel never delete this evidence.

Independent acceptance inserts task_acceptances with reviewer principal/agent, exact result/run, resulting task version, private reason and time before Done. It does not overwrite submitted_by or add undocumented public Task fields. Public existing events expose reviewer actor and task/run/version/time with fixed summaries; private reasons remain internal. The two new event producers are task.result_submitted and task.result_accepted. Historical event reads validate their own immutable result/acceptance, not merely the task's current pointer. Full current artifact/message association visibility remains mandatory.

The producer validates standalone history result, embedded Task and complete command data before committing; safe counter overflow fails closed. Current schema14 recovery remains unavailable pending39/43, so retained source fixtures are not operational restoration evidence. See [execution](r2-task-plans/issue-035-execution.md).

## Issue36 bounded search and exact native-token lookup

Forward schema15 adds only nonunique `tasks_created_order`, `messages_created_order` and `native_credentials_token_lookup` indexes. The first two provide workspace-global `(created_at,id)` seeks; the third provides workspace/hash lookup returning at most2 matches. Existing artifact status/order indexing is reused. No table, row, registry column or historical migration is changed. Duplicate credential hashes are preserved physically but now deny authentication as ambiguous before eligibility, including during current-proof revalidation; no arbitrary first row or grant union is allowed. The [compatibility and query evidence](research/r2-search-runtime.md) explains this explicit security amendment.

Genuine14→15 fixtures retain all rows (including duplicate hashes), historical migration evidence and schema other than the three indexes; faults roll back DDL and version atomically. Binary14 rollback onto15 is unsupported. Frozen schema7/V1 and schema8 recovery contracts remain byte-preserved; current-schema operational recovery remains closed pending39/43.

## Issue37 durable import binding

Existing schema15 suffices: no migration, table, index, registry column or frozen schema8/V1 change. `import_plans` stores the owning human/workspace, immutable public preview, strict valid source rows (invalid rows become null), source hashes, explicit mapping presence/absence, original mapped-task version/project, current profile revision and fixed creation/expiry. `source_digest` is SHA-256 of canonical sanitized private binding `{workspace_id,actor_principal_id,profile_revision,created_at,preview,batch,evidence}`; it is **not** a hash of the original raw envelope. The command wrapper separately retains the original canonical request fingerprint, including rejected-row semantic values, without retaining those raw values.

HTTP GET/apply and known-preview replay verify public, row and private-binding hashes outside SQL, then compare identical immutable bytes under final current authority in synchronous SQL. These are corruption/race checks, not authenticated storage or a defense against coordinated SQL replacement. Applied report/status are excluded from that checksum to allow the one legitimate preview→report transition. Report shape, row/provenance links and immutable mapping origins are checked synchronously; exact replay additionally compares the original saved outcome. Synchronous internal provenance/event projection does not claim asynchronous checksum validation.

Every attempt retains its report and import-event association. A revision-only unchanged attempt gets new report provenance without rewriting the original mapping/provenance or task. The reconciled internal helper is `getTaskProvenance(tx,ctx,importId,taskId)`: an authorized known-report projection of at most100 rows, **not** an exhaustive task-centric history query. Created report rows must match their immutable origin mapping; unchanged rows retain the exact original mapping snapshot. A future feature that mutates mappings must explicitly reconcile historical-report semantics before doing so. Local task metadata/result changes remain permitted but must pass current disclosure checks.


## Current capture projection (issue39, no schema migration)

The historical schema-version paragraphs above describe their named migration checkpoints. Issue39 now exports exact schema15 through a separate V2/revision0.2 typed representation; current restore remains unavailable. The existing36-table registry and migrations1–15 are unchanged. All registry modes are included: archived identities, credential/runtime verification hashes, run/task/result/history, immutable imports, catalog records and unrelated recovery controls. Current login nonce and PKCE verifier cells are projected to empty strings without source mutation; this is an explicit invalidated-secret projection, not literal SQL byte identity. Exact stored approved-input JSON is retained as evidence, not executable R3 approval authority. Only current capture bookkeeping is excluded. Generation-qualified manifest identity, drain-before-checkpoint and strict bounded job state are owned by the [issue39 amendment](adr/r2-recovery-contract.md#issue39-current-capture-amendment-revision02-schema15), not a reinterpretation of frozen schema8 or V1.
