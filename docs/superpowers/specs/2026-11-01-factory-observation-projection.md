# Factory bounded observation projection

Status: bounded read-only UI integrated and locally tested; supported browser execution, visual inspection and live-pilot acceptance remain pending.

Technical design provenance: SHA-256 `213fdbe74009992877c6e3c98e21f0dad89a54435aa06979caf64296414b333e`; test-plan provenance: `af998b9696a886328668882e9c033e60c3510857f0b03edb07a36889b6da212e`. Source base: `662bfec766276cdb6e70f14b1bf19f34cb25d47b` (tree `eadf823433c49bd6202e0794563eb770cb2f17e1`). This document records the technical contract, not release evidence.

## Architecture and limits

A Factory-only observation controller reads at most two explicitly selected, independently authorized tasks. A semantic repository-relative path list integrates into the existing overview, Workstation and QC/evidence sections; no second application, graph engine or filesystem index. Existing task ownership and action preparation remain independent. Each slot retains only one page of at most50 records from one authorized retained session, not all sessions/runtimes that ever worked on the task. Comparison options come only from currently readable loaded task pages, never hidden search/fanout. Different configured checkouts sharing a reported path are advisory integration overlap, not a filesystem conflict.

The controller consumes existing getTask, getRun and listTaskObservations browser reads. Current authentication/workspace identity is verified before each cycle. The service owns current-task and captured-project authorization. No new scope, write operation, native owner operation, credential handling, content fetch, browser persistence, hook installation or live configuration is introduced.

## Data and provenance

Actual ObservationView contains status, binding, coverage, retained_range, truncated, records and read_at. Binding associates task/run/agent/runtime/fence, configured repository/checkout, session and epoch. Each record separates sequence and server_received_at from reported observed_at/path/activity/source_oid/optional label. Configured events and reported_loss do not change completeness from unknown. No adapter version or captured-project field exists in this public DTO; display unavailable rather than inventing one.

Pending Next hides prior-page rows until matching committed page metadata exists, rather than relabelling them as the new page.

Show declared task assignment independently from reported activity and server-bound configured association. Runtime presence remains unavailable. Source OIDs, activity and test labels are reports, not execution witnesses. Retained history may outlive the active run; absence is not proof of no execution. Keep browser receipt time, server read time, server receipt time and producer-reported time separately labelled. Never compare fences/sequences across tasks or infer total ordering from producer clocks.

## Selection, polling and continuity

Only deliberate primary selection starts reports; Compare explicitly chooses one different task. New primary/back/exit/global reset clears comparison and no previous-selection cache is retained. Selection and repeated unchanged capability/active updates are idempotent.

Report requests require both tasks:read and events:read. Independently permitted task/authentication revalidation may continue with tasks:read alone, including while reports are held, to clear current task denials; this is not observation polling or a presence signal. Poll2000ms after the whole preceding cycle settles, never overlapping cycles. Pause while hidden/offline; lifecycle and request generations fence all callbacks, page metadata, error redaction and timers. A pending explicit intent replaces at most one queued intent. No auto-pagination. A first read sends limit50; continuation sends cursor plus expected_session_id and replaces the page. Polling a continuation preserves its input cursor and server-fixed snapshot. Explicit Refresh current clears the old binding and starts an unbound current query.

Any non-user-driven clearing of a formerly bound slot—including report failure, no_retained_data, task-read failure, scope loss or disconnect—clears all report identities and sets a non-identifying explicit-refresh hold. Scope restoration/recovery cannot silently adopt another session. Only deliberate refresh/new selection clears the hold; global reset drops selection entirely. Initially unbound empty/503 may continue bounded availability polling.409/410 or403 requires explicit refresh. A pinned no_retained_data result is generic continuity unavailable, not proof of replacement or hidden history.

## Failure isolation and privacy

Observation403/503 clears report data, page identifiers and overlap edges locally, preserving independent task/result evidence. Generic stale ReadModel503 behavior must not retain these protected reports. Shared client403 CSRF clearing is preserved; only a fresh authenticated session response can supply a token. Existing action preparation still independently rechecks authority.

Required authentication/workspace failure remains global. Actual current-generation task403/404 also redacts the matching canonical selected detail/children and loaded card/filter/picker occurrences through the existing TaskReads redaction path, after both controller and app lifecycle checks. The same current denial discards the entire cached global activity page and resets its cursor/pending generation before navigation to Activity. It does not implement relation-aware client ACL filtering or keep a denied-ID registry; later explicit reads use fresh server authorization. Independent message-thread access is not inferred from task denial. A delayed denial cannot erase newly authorized data. Transient task503/network does not falsely invalidate an independently sourced canonical cache. Denied comparison data contributes no path, edge, count or stale identifier.

Reject mismatched task/run/session/workspace bindings, oversized report pages, incoherent cursor metadata and nonincreasing/out-of-range sequences. Paths remain inert exact Unicode/case-preserving text; no URL decoding, HTML, content links or filesystem claims.

## Acceptance

Controller tests cover explicit bounds, idempotence, serialized polling, scope/authority loss, historical reads, session-bound pages, empty continuity, failures, malformed success, callback races and stale canonical redaction. DOM and real authenticated browser tests must additionally prove actual three-surface integration, two-task service-backed reporting, optional failure isolation, principal/project revocation, action reauthentication, keyboard/narrow/reduced-motion behavior and inspected screenshots. Test collection is not browser execution. A synthetic fixture is not actual live adapter installation or pilot acceptance.

## Verification boundaries

Controller/DOM and actual app-function tests execute locally. The HTTPS service fixture uses real isolated B1 ingestion with two synthetic identities/checkouts, actual50+14 cursor pages, DO eviction, replacement coverage loss, bounded append-triggered record eviction and ended-run retained reads. Captured-project visibility is exercised through isolated fixture grant/task changes. The no-retained-data continuity scenario deliberately deletes diagnostic fixture rows; it is a labelled retention-loss simulation, not a production collector receipt. Replacement reported_loss does not itself imply retained-row truncated=true.

Real-session browser specs are authored separately. Local browser attempts cannot launch the pinned Chromium headless shell because its executable is absent; test bodies and screenshots have not executed. Neither static collection, DOM fixtures, app-function tests nor service self-checks substitute for actual browser/visual acceptance. No live adapter or pilot configuration has been installed.

## Local source evidence boundary

The integrated source checkpoint is `341b7f6a13307ee9ac598f771eae7f193a155325` (tree `000a0817fc27aba1f68ee785f39b7cd03b321c84`). Its local checks passed: Node2515, Workers1984 with4 intentional skips, adapter167, native source2834 with34 protected-custody skips, all typecheck scopes, generated contracts, artifact/anchor bindings, UI build, schema18 runtime boot, documentation validators and the isolated observation service fixture. The unchanged native host remains4,170,954bytes with SHA-256 `0362f94729789325c39c7c45d52ef039dafae164a1a2a40130268ee5bfb67cfa`; its build/import check does not execute or install the host.

Observation controls are bound to the current rendered context as well as authority, connection, principal and primary selection. Detached controls cannot act after selection round trips or newer renders; comparison candidates are also rechecked against current readable pages. Structural tests do not establish actual browser focus, layout or accessibility behavior.

All15 authored browser scenarios register successfully but remain **NOT EXECUTED** locally because the pinned browser executable is absent. Initial11 launch attempts stopped before test bodies. No screenshots or visual inspection are claimed. Local service evidence separately covers genuine append-triggered retention eviction, replacement loss, ended-run history and captured-project filtering; diagnostic-row disappearance is explicitly simulated. These checks are not supported-browser acceptance, hook installation, a real pilot or release authorization.
