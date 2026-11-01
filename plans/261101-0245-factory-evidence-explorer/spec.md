# AgentHub Factory Evidence Explorer and Bounded Observability Pilot

Status: implementation acceptance pending; no released Phase A capability. Design/specification proposal for independent review. No implementation, repository change, live grant, adapter activation, merge or deployment is authorized by this document.
Date: 2026-11-01. Source pin: cfc42e26044ff596124291ec8f6dacd81c22f495 (PR137).
Visual baseline: issue124, mockup commit a4dfd79e0b7a5d5551026c1cd1672b50380a1188.

## 1. Goal and completion boundaries

Make the owner's AI factory understandable without asking chat for every status: who owns each work order, what evidence exists, what is blocked, and—only where an instrumented runtime reports it—where engineering work is occurring.

Phase A is an authorized read-only Factory Evidence Explorer. It is valuable task/evidence visibility, NOT a completed live-factory MVP or file-activity service. Phase B is a bounded nonproduction observability pilot: one repository, two already provisioned agent identities, two isolated worktrees, one supported adapter implementation, and a mixed-coverage unsupported-runtime scenario. The same adapter may instrument both agents; replace one session with unsupported mode for the coverage test. No third identity or new credential is implied.

The company view supports Lena intake, Monos coordination, technical lead and BA/design teams as configured responsibility labels. Names and hierarchy confer no permission. The technical lead's exact personal name is not assumed.

## 2. Options and selection

1. UI-only projection: smallest change, existing APIs, no new storage; cannot observe filesystem activity. Chosen for A, with explicit limits.
2. Existing kernel plus external observation adapters: keeps durable task authority in AgentHub and execution outside it. Chosen for B; requires new authenticated observation contracts and bounded storage, not merely animation.
3. Hosted orchestration/filesystem enforcement inside AgentHub: potentially centralized control, but introduces execution sandbox, credential custody, scheduling and write mediation. Excluded.

Do A then B; do not conceal B's missing capabilities behind synthetic data in A. Neither phase implements file locks, permission delegation, automatic acceptance, PR creation, merge, release or deployment.

## 3. Source-grounded reuse and gaps

All following source links use the pinned revision.

- Task creation/edit/schedule/requeue/cancel: https://github.com/trungtaottn/cf-agent-hub/blob/cfc42e26044ff596124291ec8f6dacd81c22f495/src/tasks/commands.ts
- Claim and WIP: https://github.com/trungtaottn/cf-agent-hub/blob/cfc42e26044ff596124291ec8f6dacd81c22f495/src/tasks/claim.ts
- Current run/fence/60-second lease: https://github.com/trungtaottn/cf-agent-hub/blob/cfc42e26044ff596124291ec8f6dacd81c22f495/src/tasks/lease.ts
- Eligibility uses installed project/work-role rules and eligible_agent_ids plus coherent current credential, not capability labels: https://github.com/trungtaottn/cf-agent-hub/blob/cfc42e26044ff596124291ec8f6dacd81c22f495/src/config/execution-policy.ts
- Current-result acceptance excludes submitting principal/agent: https://github.com/trungtaottn/cf-agent-hub/blob/cfc42e26044ff596124291ec8f6dacd81c22f495/src/tasks/results.ts
- Retry accounting: https://github.com/trungtaottn/cf-agent-hub/blob/cfc42e26044ff596124291ec8f6dacd81c22f495/src/tasks/failure.ts
- Existing version-bound action controller: https://github.com/trungtaottn/cf-agent-hub/blob/cfc42e26044ff596124291ec8f6dacd81c22f495/src/ui/task-actions.ts
- Existing detail/read truth rules: https://github.com/trungtaottn/cf-agent-hub/blob/cfc42e26044ff596124291ec8f6dacd81c22f495/src/ui/task-detail.ts
- Closed native events: https://github.com/trungtaottn/cf-agent-hub/blob/cfc42e26044ff596124291ec8f6dacd81c22f495/src/workspace/commands.ts and https://github.com/trungtaottn/cf-agent-hub/blob/cfc42e26044ff596124291ec8f6dacd81c22f495/src/audit/events.ts
- DTO/API contract: https://github.com/trungtaottn/cf-agent-hub/blob/cfc42e26044ff596124291ec8f6dacd81c22f495/spec/openapi.json
- Design baseline: https://github.com/trungtaottn/cf-agent-hub/issues/124 and https://github.com/trungtaottn/cf-agent-hub/blob/a4dfd79e0b7a5d5551026c1cd1672b50380a1188/design/mockups/README.md

Task has no parent-task, repository/path, acceptance revision, source digest or iteration/cost ledger fields. Run has task/agent/runtime, status, run_version, fence and lease deadline. Event has workspace sequence, actor, resource, task version, run/fence, server occurrence time and request correlation; it is not arbitrary telemetry ingress. No public human runtime-presence read exists in the current task UI.

Three sharp gaps:
1. retry_count is not review-loop budget: requeue preserves it; safe failed-attempt retries consume it. Unlimited review cycles cannot be advertised as budget-enforced.
2. requeue then patch is unsafe for criteria amendments: Ready is claimable between requests. Done cannot be reopened by existing patch/requeue/cancel. Changed intent requires separately handled successor work, not rewritten history.
3. current accept binds exact current result/run/task version, not acceptance criteria, tested source, evaluator identity or every contributor. Immutable artifact bytes are not proof that their test claims are true.

Mockup corrections: sheet26's simulated900-second lease must not replace canonical60 seconds; sheet03's Doing+Review WIP text must not replace actual active-run WIP; obsolete illustrative scope names in03/08 must not become permissions. Mockup terminal output, quota gauges and movements are not telemetry.

## 4. Three surfaces

### 4.1 Factory overview

Departments derive from authorized projects/work roles; work orders remain canonical tasks. Show six states plus cancelled archive, bounded-page counts, current observation time and explicit unavailable/partial sections. A worker marker denotes an observed task/run association, not online presence. Do not derive hidden counts from workspace totals.

Actions in A: select department/task, filter, refresh, paginate and open existing task/composer views. No mutations on load, hover, diagram movement or diagnostic GET. Consequential commands remain in the existing explicitly opened task action interface and repeat current authority/version preparation. No new drag-to-state implementation.

### 4.2 Workstation / engineering map

A: exact task, assigned logical agent, observed run/runtime/fence/deadline, latest versus historical result, links to authorized evidence. Runtime presence reads 'Unavailable'; lease text says observed deadline, not live authorization. No fake terminal.

B: add repository-relative file/module map from bounded reported paths, not an exhaustive repository index. Distinguish intended scope, observed activity and authoritative task ownership. All B file markers read 'Reported by adapter [version], received [time]'. Display coverage gaps alongside the map. Full code topology/dependency indexing is not required for the pilot.

Overlap panel: same repository-relative path in different worktrees means 'Potential integration overlap', not collision. Same declared checkout identity and path means 'Reported shared-checkout overlap; not write-enforced'. An inconsistent checkout mapping is an incident, not a reason to silently merge identities. No lock/unlock/force-write button.

### 4.3 QC / evidence drawer

Show current versus historical result, submitting agent/principal, run, artifact metadata/content availability, and matching retained acceptance event if observed. Missing event on a bounded page is not proof of no acceptance. Optional report JSON is inert, labelled as reported claims. A test count inside an artifact is not independently verified CI.

Open existing Accept/Requeue interface only on deliberate user action. Accept uses tasks:review and current submitter exclusion; Requeue uses tasks:schedule. Cancel uses tasks:cancel. Ready uses tasks:schedule. Human claim remains unavailable. Missing evidence/authority in the new view must never manufacture eligibility; the existing controller and backend remain authoritative.

## 5. Six operator scenarios

S1 Intake: Lena/user captures task through existing composer; Monos sees authorized Backlog and sends context in a fixed-participant thread. Task creation, message admission, ACK and execution remain distinct.
S2 Delegation: lead creates separate assigned tasks using existing grants. Reported parent/child links may be displayed as context only. Runtime claims atomically under installed eligibility/WIP; responsibility labels never issue credentials.
S3 Parallel coding: two runs/two worktrees produce B observations. Same-path overlap is advisory; unsupported runtime shows unknown coverage, not idle/no-conflict. Old run/fence observations remain historical.
S4 Repair loop: runtime tests/fixes, submits result, independent reviewer requeues or accepts. Display native retry count separately from reported review rounds and unavailable cost budget. Do not automatically retry unknown effects.
S5 Changed criteria/regression: compare reported dossiers manually; do not auto-accept based on digest equality. Changed intent creates a proposed successor Backlog task through existing controls; old-task cancellation is separate and does not undo effects. A regression after Done creates new work.
S6 BA/design: use document/prototype artifacts and threads, with objective evidence separate from owner subjective selection. Engineering file map is unavailable/not applicable, not the universal company metaphor. Adding a recipient requires a new thread, not expanding old private history.

## 6. Phase A projection contract

Reuse Task, Run, TaskResult, Event and Artifact DTOs. A local Observed<T> carries source endpoint, receivedAt, data and loading/ready/empty/stale/partial/forbidden/error/disconnected status using existing read-state conventions. It is not an authorization object. No authoritative state is stored in browser persistence.

Reads use existing current session/native transport, per-resource access and bounded pages. Start with existing board20-item pages; do not fan out all task histories. Load run/results/events/artifacts only for selected task. Retain at most current selected page per section; switching workspace/principal clears it. Independent section failures do not turn into global zero/empty.

Optional WorkOrderReport/WitnessReport artifact viewing is manual only; not necessary to complete A. Native artifact owner/hash/run association is distinct from claimed criteria/source/evaluator fields. No VerifiedWitness constructor or caller-supplied verified flag is introduced.

## 7. Phase B NEW observation contract proposal

B is not reuse of the audit-event POST: no such public ingress exists. Define a separate observation lane, disabled by default, for the isolated pilot. New routes and storage require separate source/security/recovery review before implementation activation. Use a dedicated diagnostic handler with existing current identity/runtime-proof checks and synchronous withTransaction storage guards. Do NOT run observation writes through generic executeCommand, which appends native domain events/outcomes; the observation lane owns only its bounded diagnostic rows/receipts. These routes are proposed names, not existing availability.

### 7.1 Bounded pilot configuration

Explicit fixture/deployment pilot config identifies one repository ID, the two allowed agent IDs, their two allowed checkout IDs and the one adapter ID/version. Configuration supplies mappings; reporter labels cannot broaden them. Existing credentials/scopes remain unchanged. No automatic credential issuance. Live installation is a separate operator action, not authorized here.

Proposed nonproduction design limits (not measured capacity or existing policy): max2 open observation sessions/workspace, one per current run; max32 records/batch; max32768 UTF-8 request bytes; max1024 UTF-8 bytes per relative path; max256 retained records/session; max512 records/workspace; max262144 retained UTF-8 encoded record-plus-session-metadata bytes/workspace, including at most16384 bytes of session/receipt metadata across both slots; max50 records/read. Session metadata shares the fixed two pilot slots; a new run replaces a terminal slot and explicitly truncates its observation history. Retained record/count/byte caps use deterministic oldest-server-receipt-order eviction across the two slots inside the same transaction, updating retained-range/truncation metadata; latest batch/replacement receipts are not record eviction candidates. Reject before writing if session metadata would exceed its cap, a single incoming bounded batch cannot fit even after permissible eviction, or any safe-integer sequence would overflow. Every eviction is disclosed through retained-range metadata. Capacity accounting includes IDs, pinned mapping/config identity, coverage metadata, latest batch and replacement receipts; no unbounded tombstone chain is retained. Receipt reconciliation lasts only while that exact latest receipt remains in the active slot, not a promised wall-clock TTL. A later replacement/slot reuse or restore may remove it; missing/older receipt returns conflict/unavailable and cannot be reported as known success. Client keeps such a diagnostic outcome unknown and never infers domain work completion from it. No infinite historical telemetry retention is promised. No age-based GC or retention expansion of existing events/artifacts.

The accepted payload has no file contents, command stdout/stderr, prompts, secrets, absolute filesystem paths or private endpoint URLs. A path is normalized repository-relative text; reject absolute, traversal, NUL and ambiguous separator forms. This normalization does not implement symlink-safe write mediation.

### 7.2 Writer identity and operations

Proposed POST /tasks/{task_id}/observation-sessions establishes/retrieves the exact current run-bound session with run_id, fence and adapter ID/version. Current native credential, runtime proof, tasks:execute, current task visibility, exact run owner/runtime, unexpired lease and allowlisted pilot mapping are mandatory. The server assigns observation_session_id, binds workspace/task/run/agent/runtime/fence/config identity and server receipt time. A session ID is not a bearer credential. No human report writer or generic actor field.

Proposed POST /tasks/{task_id}/observation-sessions/{id}/batches accepts first_sequence and records. Every call repeats current authority/run checks; old/expired/revoked owners cannot append. A record contains producer observed_at (claimed), relative_path, activity enum(read-observed|write-observed|test-started|test-finished), source_revision claim and optional criterion/test label bounded inside request size. Server derives actor/run/workspace/checkout association from session, not record JSON. Adapter coverage declaration is pinned at session establishment and displayed, never interpreted as filesystem enforcement.

The adapter serializes ALL session creation, replacement and batch operations: exactly ONE operation may be in flight for a reporting lane, and the next batch is not sent until the preceding receipt is settled. Records must be contiguous within session. Server keeps high-water sequence and the latest accepted batch fingerprint/range/receipt in bounded session metadata, independent of observation-row eviction. Identical retry of latest batch returns original receipt; changed-body retry conflicts. Earlier overlapping sequences are rejected, not silently reinterpreted. A forward gap returns expected sequence; adapter does not fabricate missing records. If its bounded local queue lost records, it stops sending and reports coverage loss; it does not invent sequence entries. Proposed POST /tasks/{task_id}/observation-sessions/{id}:replace requires expected_session_id, expected_high_water, a frozen replacement_request_id and explicit coverage_loss reason. It repeats current native proof/run/fence/config checks and atomically replaces the current slot with a new server session ID/epoch at sequence0; all old IDs become invalid for writes, retained rows for that slot are removed and the new view records that prior coverage was truncated. A changed expected session/high-water conflicts. Keep the latest replacement request fingerprint and original replacement receipt in slot metadata so an identical lost-response retry returns the same new session, not another epoch. Changed-payload replay conflicts. Ordinary client boot never authorizes reset. Do not replace while a batch outcome is uncertain: settle the serialized exact batch first. If local crash lost its bytes, read current owner-visible high-water/receipt under the required read scopes, disclose the unrecoverable local coverage gap, and explicitly replace using that current expected high-water; do not claim lost records were delivered. Session/epoch replacement never resets run authority or revives an ended run.

No background worker, task transition, lease renewal, outbox dispatch or domain-success event occurs from accepting observations. Observation writes are diagnostic only.

### 7.3 Reads and provenance

Proposed GET /tasks/{task_id}/observations requires current tasks:read and events:read plus task/project visibility. Native writer readback also needs those existing read scopes; do not silently grant them. List is task-bound, max50, cursor bound to caller/workspace/task/session and fixed high-water. No workspace-wide hidden-agent totals. Proposed native-only GET /tasks/{task_id}/observation-sessions/{id}/status is the reconciliation operation: require current proof, exact current run ownership, tasks:execute plus tasks:read/events:read and current task visibility. Return current session ID/epoch, accepted high-water, latest batch range/fingerprint/receipt and latest replacement request fingerprint/receipt, all within metadata bounds. Ordinary human ObservationView omits those request/receipt reconciliation fields. If the old session/run is no longer eligible, return unavailable/conflict without asserting whether forgotten diagnostic data was accepted; it never licenses domain replay.

Returned ObservationView separates:
- server-bound identity: task/run/agent/runtime/fence, configured repository/checkout, session ID;
- transport evidence: server_received_at, server sequence, authenticated uploader;
- reported claims: observed_at, source revision, path and activity;
- coverage: adapter/version, declared supported events, disconnected/truncated/unsupported state;
- retained range: first/last sequence, truncation marker and read observation time.

A server-bound checkout is a configured association, not proof the external process truly used that filesystem. Label accordingly. Source SHA and activity are reports until an independent trusted producer verifies them.

Normal polling starts at2 seconds only while the selected task map is visible; pause when hidden/offline, and no overlap of polls. An explicit Compare action may select exactly TWO task IDs from currently authorized task views for the pilot overlap scenario. Read each task/run/observation page independently under its own current authority; retain at most50 observations per task in this view. If either task becomes denied/unavailable, remove its nodes, paths and derived overlap edges immediately and show comparison coverage unavailable, without counts or identifiers from that task. No workspace-wide fanout or implicit second task selection. Two valid separately observed pages are not an atomic workspace snapshot; show both observation times. This is a proposed client setting, not a service SLO. Last-observed time remains visible. Current ownership comes from separate authoritative Task/Run reads. Late reports cannot overwrite newer task state. Sequence order is local to a session; timestamps from separate runtimes never establish total order.

### 7.4 Recovery and storage

Observation rows never confer execution authority. Ordinary Durable Object/process restart preserves SQL sessions, high-water and latest receipts and permits exact authenticated retry; an adapter restart does not reset them. On an actual restore-authority/config generation change, discard diagnostic observation sessions and records and require fresh current-run admission; show 'observation history unavailable after recovery'. Existing task/results/events remain governed by their existing recovery contract. This deliberately ephemeral choice must be registered explicitly in recovery schemas/validation, not silently omitted from a generic backup.

Any migration adding observation tables must preserve schema17 backup compatibility and frozen native proof profiles; actual next schema number is discovered at implementation time. A new migration may require versioned native/recovery witness work, as the prior schema17 work demonstrated. Do not start B tables without that compatibility inventory and separate review.

## 8. Invariants and failure behavior

I1 Actor/grants/resource checks remain server-owned and current.
I2 Task delegation does not delegate authority; role labels do not grant scopes.
I3 Presence, lease, intended scope, reported activity and enforced writes are distinct.
I4 Native event gaps under paging/authorization do not prove missing activity.
I5 Observation/session sequence cannot be compared across tasks/runtimes; task fences are task-local.
I6 Old run/expired session/report cannot revive execution or clear unknown effects.
I7 Artifact hash authenticates bytes, not test truth; Done is not merge/release permission.
I8 No hidden-resource leakage via nodes, edges, counts, filenames or overlap badges.
I9 New UI GETs never mutate/repair state; A introduces no database migration.
I10 Unsupported/partial coverage remains visible. No 'no conflict' assurance without full coverage—and B never promises enforcement.
I11 Admission limits (batch/request/path/read/metadata and safe integer sequences) reject at exact+1 before mutation; retained-record/total-byte caps instead enforce deterministic disclosed eviction as specified. No unlimited queues/DOM accumulation.
I12 No automatic acceptance, credential issuance, merge or deployment in A/B.

## 9. Acceptance and test matrix

A tests:
- Real-session task projection covers all six canonical states Backlog/Ready/Doing/Waiting/Review/Done plus separate cancelled archive. Use actual implemented transitions for the enabled lifecycle and explicitly labelled retained/seeded Waiting read fixture with unavailable approval controls; this does not claim request-decision or approval lifecycle implementation. Verify actual run attribution and retained result history.
- Bounded partial pages never become totals; independently failing artifact/events reads do not manufacture zero or erase confirmed task state.
- Old run/event arrives after new task version: current owner unchanged; historical evidence labelled.
- Two principals/projects and revocation: protected nodes/edges/counts/content clear; delayed callbacks cannot repopulate them.
- Keyboard/narrow viewport/reduced motion: three surfaces and list equivalents expose same reads; animation pause does not pause authority checks or server lifecycle.
- Existing Ready/Cancel/Requeue/Accept controllers remain unchanged or receive separate review if integration requires edits; no human claim, mutation-on-hover or hidden auto-accept.
- Hostile names/paths/report JSON render inert; no remote HTML/terminal execution.

B tests:
- Two authenticated runtimes on two worktrees send real adapter observations; UI shows exact server attribution, reported paths and timestamps. Adapter input fixture alone is not the final acceptance.
- Replace one runtime with unsupported mode: coverage unknown; no inferred idle/no-conflict; task execution remains independent.
- One-inflight serialization rejects a second pending operation. Lost latest-batch response/retry: one retained sequence; changed payload conflicts; forward gap/older overlap rejected; bounded row eviction retains latest receipt; replacement races/replays preserve one new epoch and retire old IDs; reconnect cannot fabricate lost records.
- Out-of-order network completions and session replacement: no newer observation overwritten; old run cannot append after revoke/cancel/expiry/new claim.
- Explicit two-task comparison authorizes both independently; denying either removes its paths/edges without hidden counts. Two worktrees same relative path => advisory integration overlap; same checkout declaration conflict => incident/advisory only, never enforced lock.
- Exact limits and+1 for batch/count/path/request/storage/read; retention truncation truthful and high-water does not roll backward after eviction.
- Scoped cross-project reads, session-ID guessing and changed config mapping reveal no protected observation existence/content.
- SQL tripwires prove observation writes do not touch task/run/approval/outbox/domain-outcome rows or renew leases.
- Ordinary DO restart preserves sessions/high-water/receipts and exact retry. Actual restore/config generation change clears observation admission; no authority resurrected; native/recovery compatibility suite retains genuine old backup evidence.
- Sustained bounded fixture run records actual payload bytes/query counts/poll behavior; report measured values only, without turning pilot results into production SLA.

## 10. Rollout and kill criteria

A begins as a transient explicit Factory view toggle INSIDE the already authorized /tasks shell; the existing board remains default. No new navigation route, persisted default-view preference, profile enum or backend configuration flag is required. It uses existing authorized data only. Do not hide existing board or replace the user's default view until reviewed. Roll back by disabling view; no data migration to undo.

B is nonproduction and opt-in. Start one supported runtime, then two, then mixed-coverage scenario. Disable observation intake/view immediately on cross-scope disclosure, raw-secret/file-content ingestion, task authority mutation, unbounded storage/query behavior, fabricated verification labels, or stale-owner admission. Disabling observations does not cancel tasks or change grants. Keep ordinary task UI available. Failures in observation reporting must not be silently transformed into work completion or permission denial of unrelated domain work.

B cannot be called accepted from screenshots, synthetic adapter messages or source tests alone: require actual two-runtime adapter journey, supported/unsupported coverage receipt, negative authority tests and exact-head full CI. A is never presented as fulfilling this live observation gate.

## 11. Future contracts deliberately excluded

AcceptanceBinding and cumulative loop budget are separate proposals. Existing acceptance cannot be upgraded through report JSON. A future binding needs immutable criteria/source/evaluator policy identity, server admission and atomic checks at claim/submit/accept. Existing Ready PATCH must reject/invalidate bound-field drift; bind-beforeReady alone is insufficient. Smallest future behavior may prohibit changes after binding and require successor work; no requeue→patch shortcut.

Loop budget must survive requeue/restart and differ from native retry_count. Its cost measurement/source, authority and exhaustion behavior need their own reviewed contract. File reservation/enforcement, contributor-lineage independence, PR/dev-merge gates, stable release and credential delegation are also excluded.

## 12. R3/R4 and unresolved activation choices

A is a presentation proposal over implemented R2/R3 source; it does not close partial52/54 or unblock decision/MCP dependencies. B is new observability scope adjacent to R4 operational/adapter work and must receive an explicit plan amendment rather than pretend existing R3 acceptance requires it. Teams/invitations and real connectors retain their R4 gates.

No true product question blocks drafting A/B. Before live B activation an operator must select actual permitted repository, agent/runtime identities, existing grants and deployment target; this document does not supply them. Adapter implementation selection must use the user's existing authorized runtime tooling and verified supported observation hooks. If no such hook is available without new credentials/settings, report that exact activation blocker; do not fake coverage.

## 13. Phased implementation plan (not execution authorization)

Required implementation method after approval: isolated worktree, test-first bounded tasks, independent review, immutable candidate and exact-head CI. Preserve genuine failure receipts and environment limitations.

### A1 Authorized projection model
Proposed new src/ui/factory/read-model.ts and test/ui/factory-read-model.test.ts. Reuse existing read-state/client; no new backend DTO.
Interface: FactoryReadModel.selectTask(id), refresh(), dispose(); readonly independent Observed sections.
- [ ] RED late-response/principal-switch/partial-page tests.
- [ ] Implement selected-task-only bounded loading and resource clearing.
- [ ] GREEN focused tests, typecheck; independent diff review; scoped commit after approval.

### A2 Three semantic surfaces
Proposed new src/ui/factory/{overview,workstation,evidence}.ts; test/ui/factory-view.test.ts.
Interface: render functions consume readonly projection and explicit callbacks; no transport or authority mutation inside rendering.
- [ ] RED labels/current-versus-history/unknown/runtimepresence/inerttext/keyboard DOM tests.
- [ ] Implement blueprint tokens using existing semantic DOM/styling conventions, not copied mockup innerHTML.
- [ ] GREEN focused tests; review source/provenance wording and narrow layout.

### A3 Navigation and real-browser acceptance
Modify src/ui/app.ts to add the transient Factory toggle within existing /tasks; do not expand route/preference enums; proposed test/ui/factory.spec.ts and existing UI fixture registration.
- [ ] RED actual session/project/revocation/lateresponse/keyboard/list-equivalence browser cases.
- [ ] Integrate optional read-only surface and explicit links to existing actions; serialize shared app edits.
- [ ] GREEN actual pinned browser, full Node/Workers/CLI/types/build/generated/docs; independent final review; draft publication only under separate implementation/publication approval.

### B0 Contract and compatibility closure BEFORE schema edits
Proposed spec/observation.schema.json, docs/contracts/observations.md, source-generated DTO/validator additions; exact API/schema/generator touchpoints discovered from current registry before editing.
- [ ] Freeze closed pilot config, endpoint semantics, payload limits, session replacement/truncation and scope mapping.
- [ ] RED contract fixtures for forbidden actor/credential/content fields, exact bounds and invalid sequence.
- [ ] Map next migration/recovery/native-profile compatibility and independently review explicit ephemeral recovery rule.
- [ ] GO only with no unresolved material auth/storage/recovery finding. This is not adapter activation.

### B1 Run-bound observation producer/storage
Proposed src/observations/{sessions,batches,reads}.ts and src/http/observation-routes.ts; test/observations/{authority,sequence,bounds,recovery}.test.ts; migration/registry files only as identified in B0.
- [ ] RED genuine Worker tests for current proof/fence/currentconfig, sequence retry/gaps, bounds and domain no-write tripwires.
- [ ] Implement synchronous authoritative guards and bounded transaction writes; no imported caller actor.
- [ ] GREEN focused Worker plus recovery/native compatibility; independent review of all authority/storage deltas.

### B2 One adapter, bounded reporting queue
Proposed packages/observation-adapter/src/{reporter,paths}.ts and adapter tests; concrete host hook binding chosen/verified in B0.
- [ ] RED bounded queue/loss disclosure/path normalization/unsupported capability tests with actual supported hook contract.
- [ ] Implement reporting only; no shell interception, credential installation, file enforcement or background auto-start.
- [ ] GREEN two isolated worktree adapter journey and mixed-coverage scenario; preserve raw sensitive logs privately only if permitted, publish sanitized receipts.

### B3 Map projection and pilot acceptance
Proposed src/ui/factory/observations.ts and test/ui/factory-observations.spec.ts plus exact existing browser fixture registration.
- [ ] RED stale session/out-of-order/coverage/privacy/advisory-overlap/browser tests.
- [ ] Implement selected-task polling and bounded relative-path map; never infer topology or authority from omitted data.
- [ ] GREEN real-session/browser+actual adapter journey, kill-switch test, exact-head full CI and independent complete-diff review.

## 14. Review focus and handoff

Focus on: (a) hidden project leaks through aggregates, (b) old actor/run responses after navigation, (c) source clocks/sequence gaps mistaken for authority, (d) reported witness content mistaken for verified evaluation, (e) observation ring/session replacement weakening retained history or recovery fences. Each is covered by named matrix cases above.

This draft is ready for builder/design critique, not for unattended implementation. All file paths under proposed new modules are proposed ownership boundaries; existing integration/registry paths must be re-scouted at the approved implementation base. Do not create a parallel task state machine, change canonical scope enums casually or add a generic telemetry capability disguised as an existing event.

## 15. Reproducible command plan

The pinned package.json actually defines the following scripts. New test paths below are proposed and must first be registered in their owning runtime suite; collection/listing is not execution. No command was run as part of this read-only design task.

- A focused model/view: `npm test -- test/ui/factory-read-model.test.ts test/ui/factory-view.test.ts`.
- B focused actual Workers: `npm run test:workers -- test/observations`.
- Actual browser: `npm run test:ui -- test/ui/factory.spec.ts test/ui/factory-observations.spec.ts` (run only the phase's existing registered specs; require pinned browser execution, not merely --list).
- Types/generated/build/boot: `npm run typecheck`, `npm run verify:generated`, `npm run build:ui`, `npm run check:runtime`.
- Aggregate: `npm run check`, `npm run test:recovery-cli`, relevant versioned native suites and complete exact-head CI, plus actual browser suite. B additionally requires the real adapter/pilot receipt outside synthetic unit fixtures.
- Retain RED-before-fix and exact-head final results. Known environmental failures remain labelled failed/not executed; an isolated empty command-scoped XDG directory may address a writable-config harness issue, but no credentials, browser sandbox or security settings are changed to obtain green.
