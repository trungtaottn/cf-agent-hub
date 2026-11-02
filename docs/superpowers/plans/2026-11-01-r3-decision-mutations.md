# Bounded current-human decision controls — retained design plan

Status: Reviewed source implemented; exact-head CI and real-session browser acceptance pending. No released product action.

The plan body retains its original pre-implementation instructions; the current status above supersedes historical progress wording and does not grant runtime authority.

**Historical design-stage status:** design only; no mutation UI code authorized by this document.
**Base:** read-panel source ed8743d plus parent-reviewed integrated human core
7ff526c/fe498 and HTTP c8c21ba; implementation must start from parent-provided
combined frozen tree, not cherry-pick guessed partial dependencies.
**Goal:** truthful generic approve/reject requests by the actual assigned human,
with current inspection, immutable intent, explicit unknown-outcome hold, and
real-session evidence. Production descriptor registry remains empty.

## Reuse and exact ownership

Reuse current HubClient.decision, canonical dedicated decision validators,
DecisionReads/InputInspector, ReadModel, current host authority/callback fences,
and classifyWriteResult. Follow TaskActions' separation of preparation from
retained mutation evidence and current-authorized exact replay. Do NOT widen
TaskActions' closed operation enum or copy its approval-null success predicate;
human decisions retain task.approval_id. Do not use durable DraftStore or create
another retry scheduler, CSRF owner, policy registry, or lookup-by-key endpoint.

Proposed files: new src/ui/approvals/decision-actions.ts and
src/ui/approvals/decision-action-view.ts; bounded edits to decision-detail.ts,
decision-list.ts (selection lock), host.ts, app.ts; tests in existing
 test/ui/decision.test.ts and new test/ui/decision-mutations.spec.ts. Existing
client seam needs no change unless a concrete canonical mismatch is reproduced.
DOM module requires existing narrow tsconfig partition update. Parent retains
HTTP/core ownership. A separate, explicitly reviewed projection change must add
human-only approvals:decide to implementedDisplayScopes now that HTTP exists:
otherwise the real current grant cannot be observed. No grant/schema changes.
This design does NOT silently add decide to the preceding read projection fix.

## Current observation and request eligibility

Actual human identity, workspace, connection generation and view lifetime must
match; access must include approvals:read/decide, tasks:read, artifacts:read;
principal must occur in approval.assigned_human_principal_ids. Require pending,
current task waiting with same approval_id and no active_run_id, matching current
proposal version, safe positive versions with safe successors, and now strictly
before original expires_at. These are request preconditions, NOT action support.
No inferred support from action name/scope badge/schema. Always explain that
server checks current installed policy and action availability. No execution or
completion claim follows approval. Empty production registry remains failclosed.

Approve requires the full original input already displayed by existing bounded
metadata/EOF/completion/SHA/exact-JSON checks, bound to unchanged current
approval/task/artifact snapshots; never treat that display check as backend
opaque evidence. Initial preparation and each changed snapshot require deliberate
rereview. All existing 10 MiB/30s/depth64/nodes100000/single-read/single-digest
budgets and teardown redaction remain.

Reject does not grant execution and server explicitly does not need R2 bytes.
Add a typed metadata-only observation alongside (not masquerading as) DecisionView:
{approval,task,artifact,access}; fresh closed DTO identity/reference metadata and
post-read authority checks remain required. InputUnavailable is explicit; approve
stays disabled. A failed optional binary read may permit a new explicit metadata
review for reject only, never automatic rejection eligibility or denial bypass.
Artifact metadata403/404, retention loss or reference binding mismatch disables
both; raw bytes are erased immediately. No repeated automatic 10 MiB retries.

## Immutable in-memory state machine

DecisionActions fixed methods: prepare(id,operation), setReason(reason),
confirmReview(), submit(), replay(), refreshOutcome(), invalidatePreparation(),
invalidateAuthority(). Operations only approveApproval/rejectApproval.
States idle/preparing/review/ready/confirming/pending/uncertain/conflict/rejected/
succeeded/unresolved. Prepare obtains current observation; confirmReview freezes
operation, approval/task IDs, three CURRENT versions, complete reason revision,
observation revision and exact serialized ApprovalDecisionRequest. Generate one
key on confirmed first dispatch; retain exact key/body separately from observations.
Reason is canonical nonempty string (no invented trim/minimum/max count), with
full serialized envelope <=65536 UTF-8 bytes and safe integer versions. Fields
are reason + expected_version + expected_proposal_version + expected_approval_version.
Any reason/selection/action/input revision edit BEFORE dispatch invalidates ready
and cancels confirming; late final auth must not dispatch. Pending/uncertain lock
only in-component edits/selection/new intent, never logout/navigation/disposal.

After all optional/resource reads, final same-client host.readAccess obtains real
/auth/session and /workspace, validates current principal and scopes, restores
only its fresh CSRF token, and returns under original lifetime fence. Dispatch
immediately with no intervening optional reads. Final metadata changes require
new explicit review, not silently rebased expected versions. Check deadline again
at dispatch. Current server remains authoritative across races. Replay repeats
fresh session/access and current assignment/reference metadata visibility but
must NOT gate on obsolete pending/deadline/version; it sends original key/body.

Use classifyWriteResult: malformed/mismatched success, timeout/network and 5xx
remain UNKNOWN. A production DEPENDENCY_UNAVAILABLE503 is not relabeled success
or safely retriable/new-intent admission. Explicit same-key replay only. Current
reads may show a winning state but cannot prove which request committed; they
never clear UNKNOWN or manufacture an admission receipt. Exact correlated replay
can establish historical command result; current read stays a separate observation.
Known version conflict/APPROVAL_EXPIRED retains reason and refreshes current view;
new submission requires deliberate new review/confirmation/key. 401/403 or current
identity/resource authority loss wipes raw input/reason/body/results immediately,
leaving only non-sensitive unresolved warning if dispatched. Navigation/logout
always tears down and fences; memory-only means outcome may remain unknowable
following disposal and the UI must say so, not promise durable recovery.

Success correlation: canonical TaskCommandResult, same workspace/task/approval,
approval status approved/rejected and task state ready/backlog respectively,
task_version and approval_version exactly expected+1, unchanged proposal_version,
retained task.approval_id, run=null, same immutable proposal/checkpoint/request
anchor/expiry, actual human decided_by and original reason. Historical
 task_version_at_request is NOT current expected_version. Response attribution
and reason validation focus/aria-invalid bind frozen revision, never a later edit.
Refresh current reads after success without converting historical result into
current execution authorization. Late callbacks cannot populate another view.

## Finite TDD checkpoints and evidence

1. Model RED/GREEN: exact displayed input vs metadata-only reject; required scopes,
assignment/native denial; all three version/revision changes; exact expiry boundary;
reason Unicode/full-envelope limit; confirm/edit race; duplicate submit;
UNKNOWN same-body/key replay and current reads not resolution; malformed-success
correlation; current scope loss/logout/A-B-A privacy; optional403 clears CSRF then
fresh final auth restores it or prevents dispatch. Use actual HubClient/host for
CSRF tests, not only injected boolean authority. Independent source checkpoint.
2. App wiring/view RED/GREEN: inert input and reason, explicit confirm, disabled
reasons, keyboard/focus, old errors not attached to new fields, detached controls,
success vs current status copy, unknown selection lock with allowed navigation.
Real workspace decide projection regression is required before UI claim.
3. Browser evidence uses two DISTINCT service compositions, never positive DTO
interception. Normal production worker remains empty registry: real OIDC session,
actual reads and POST prove unsupported request503 with unchanged SQL and UI
UNKNOWN hold. Synthetic pending record must be created by the private trusted
source producer, not hand-forged public approval JSON; this is not evidence that
production can admit a request.
4. Positive generic browser fixture needs separately reviewed test-only worker
build composition: compile exact existing Worker/DO/HTTP code with only fixed
commands.ts binding to createDecisionCommands([privateSyntheticDescriptor]);
no request/env-selectable registry and no production source injection API. Separate
fixture entry/build output under test/helpers, never production bundle. Use source
command producer + actual committed R2 input and isolated synthetic grants/policy
for that fixture only. Browser is unchanged application with genuine OIDC cookie,
Origin/CSRF/HTTP/DO. Assert approve and reject SQL/event/outcome once, stale version,
expiry, optional binary failure then metadata-only reject, dropped committed
response then exact replay, competing reviewer, and post-success authoritative
refresh. Prove production build still imports empty registry and rejects same
unsupported fresh command. Parent must ACK exact harness/build seam before coding.

Browser positive fixture is generic private-source plumbing evidence only, not
production descriptor activation or issue60/61 completion. Supported CI required;
local Chromium remains unavailable, no install/retry authorized. If test harness
cannot select an isolated build without altering production seams, stop that
checkpoint for a reviewed alternative; do not fake positive route responses.
All checkpoints stay source-only: no live grants/hooks/credential changes,
publication, merge, deploy, or external effects. Parent serializes integration.

## Independent review clarifications

- Replay ordering is explicit: assignment/reference metadata reads FIRST, then
  final actual same-client session/workspace refresh LAST, then exact dispatch.
  No optional read after fresh CSRF restoration for either first send or replay.
- Freeze original human principal and immutable approval anchors with the intent.
  Success decided_by must equal that frozen principal, human kind and null agent;
  anchor/proposal/checkpoint comparisons use the frozen intent, never a newer view.
- Metadata-only rejection has a distinct UI heading and confirmation text:
  “Reject using current metadata; exact input was not inspected.” Its state never
  retains input bytes or inherits approve eligibility from a previous inspection.
  Artifact metadata authority denial clears both paths as specified above.
- The positive fixture compile-time replacement must be absent from production
  artifact AND import graph, demonstrated by independent bundle/import checks.
  No runtime/environment registry switch is permitted, even test-labeled.

Reviewer f0f519c3 conditional GO is limited to parent-assigned model TDD; fixture
composition and mutation source activation require separate explicit ownership
and exact source review. Current read never resolves UNKNOWN.
