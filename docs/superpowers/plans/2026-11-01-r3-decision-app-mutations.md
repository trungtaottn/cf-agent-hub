# Next finite decision app integration — retained design plan

Status: Reviewed source implemented; exact-head CI and real-session browser acceptance pending. No released product action.

The plan body retains its original pre-implementation instructions; the current status above supersedes historical progress wording and does not grant runtime authority.

**Prerequisites:** read panel/projection source and model ef3186d independently
ACKed. Parent supplies a NEW isolated combined base after PR144 source freeze.
No app/source edits in the current lane or inference of publication approval.
Prior model design 2d14a175 remains the contract; this closes concrete host seams.

## Exact source scope and sequence

1. First checkpoint: model callback signatures + existing host/read owner, tests.
   Files: decision-actions.ts, host.ts, decision-detail.ts, decision-list.ts and
   test/ui/decision-actions.test.ts / decision.test.ts. No buttons yet.
2. Second checkpoint, separately owned after first review: new
   decision-action-view.ts; narrow app.ts wiring; human-only approvals:decide
   workspace display projection plus actual Workers projection regression.
   Existing read-only users/navigation/Factory/composers unchanged. No grant,
   production policy, descriptor, credential or native inventory changes.
3. Browser/private fixture composition remains a separately reviewed checkpoint,
   NOT implied by either source checkpoint. No positive intercepted HTTP DTOs.

## One lifecycle predicate reaches side effects

Change observe to (id, mode, current:()=>boolean) and readAccess to
(current:()=>boolean). Model supplies immutable invocation predicate comprising
its preparation/command lifecycle epoch, captured principal/connection/view
binding, and (for refreshOutcome) the monotonic outcome-read token. The predicate
is checked by model as today AND passed through the actual host adapter. It is
not an authority token or public request field. A stale callback cannot restore
CSRF, call onAuthDenied/onAccess/onTaskDenied, clear current caches, or publish.

Extend existing createDecisionReader with optional invocation-current predicate;
compose it with existing primitive context snapshot guard. Check both BEFORE
any shared hook, after each awaited hook, and before final same-client CSRF
restoration. Do not create an independent second host lifetime or token registry.
Use one same HubClient. Optional metadata/content reads precede final actual
session/workspace refresh; nothing optional follows fresh token restoration on
first send OR replay. Response 401/403 clears client token as today; a superseded
read may still clear transport token, but cannot log out/redact newer UI or restore
an older token. Next command always performs fresh final session access.

## One bounded inspection owner, explicit metadata-only path

DecisionReads remains sole owner of InputInspector, read abort/cleanup and single
unfinished native digest. Add fixed observeForDecision(id, 'exact'|'metadata',
current) method using that owner; no second inspector inside DecisionActions.
An exact action observation cancels/serializes existing detail content work and
uses existing loadDecisionView. It returns the exact snapshot subsequently shown
by the action view; no public verified flag or verifier receipt is created.

Extract bounded metadata loading from loadDecisionView into a fixed loader in
that existing module. It reads current access, approval, task, artifact metadata,
then rechecks current authority and unchanged snapshots, but never downloads
bytes. Both branches reuse matchesProposalMetadata. Exact branch adds existing
complete EOF/hash/exact-JSON check and post-byte freshness validation. Artifact
metadata denial/retention/binding failure disables both paths and redacts. Reject
explicitly requests metadata mode and wipes prior exact text; the confirmation
says “Reject using current metadata; exact input was not inspected.”

Each action observation uses createDecisionReader with its model-issued current
predicate, so old per-read hook effects are fenced, not merely returned values.
Shared content-flight generation is separate from displayed-observation revision:
internal final metadata rereads do NOT silently change the reviewed revision.
Expose a read-owner displayed revision incremented on selection, explicit detail
refresh, staleness or disposal; model confirmation binds it. While action review
is active, render its frozen original observation, not a newer independent detail.
No duplicated raw text cache: clear old read detail when transferring observation
to action review, and clear action observation when returning to ordinary detail.

## App controls and capability

Use existing /tasks?panel=approvals only. Current read users keep the read-only
panel. Assigned current human decide-grant users may explicitly prepare approve
or metadata-only reject, edit reason, inspect current versions/expiry and confirm.
No client action registry: label these requests and disclose server policy/action
availability checks. The empty production registry cannot admit a supported
product action, even if synthetic fixture grants expose generic controls.

Reason input and errors bind reasonRevision/frozen intent; textContent only.
Pending/UNKNOWN disables local edit/select/new-intent controls but never navigation,
logout or disposal. Explicit refresh of current outcome does NOT resolve UNKNOWN;
only exact correlated replay success establishes historical admission. Preserve
separate current observation vs historical status. Expired/conflict requires
explicit new preparation. User edits cannot silently rebase versions or key.

Every existing disposeDecisions path also invalidates model authority immediately;
raw text/reason/body/results disappear before render/await. In-flight disposal
retains only non-sensitive unresolved warning. Memory-only means navigation may
lose the replay body/key; do not promise durable reconciliation. Detached callbacks
include existing paint guard plus model current state/revision. Success refreshes
list/current detail without claiming execution or force-changing task cache.

## Required proof before source acceptance

- Actual same HubClient/host: overlapping outcome reads, newer success then older
  403/401/success, old onAccess hook crossing selection/principal/view change;
  no newer cache clearing/logout/CSRF restoration. Current denial still redacts
  canonical task/global-event caches as existing read integration requires.
- Actual shared read owner: detail byte stream pending then prepare/reject/dispose,
  late stream cancellation, one read/digest budget, no auto repeated large reads;
  metadata rejection publishes no old bytes and approve remains unavailable.
- Model/current-view: three versions, expiry between awaits, reason edit during
  final auth, UNKNOWN locks/replay exactness, newer errors/focus attribution,
  A→B→A navigation, fresh-session requirement after optional403.
- Actual Workers: decide scope appears only for current human grant and disappears
  after revocation; absent native/read-only; no grants/policy added by projection.
- Renderer keyboard/focus/disabled-reason proof is not real-session acceptance.
  Existing supported CI must run actual app/real OIDC paths. Positive source-only
  service fixture must first receive separate fixed compile-time binding review,
  prove absence from production artifact/import graph, retain actual HTTP/CSRF/DO
  and committed R2 bytes. Production empty-registry fresh request503 and unchanged
  state remain a separate required negative receipt, never a fabricated success.

No heavy command without parent global lease. Parent serializes integration,
publication and CI; source gates do not close issue60/61 or activate an action.

## Integration regression inventory

Before the final app source freeze, search all AST-extracted actual app function
and listener tests for every newly referenced free dependency. Update explicit
adapters/spies with positive, unrelated-principal negative and disposal-order
assertions, preserving existing Factory/composer semantics; do not wait for the
full Node suite to discover missing dependencies. Initial inventory includes
factory-host.test.ts, factory-observation-app.test.ts, factory-authority.test.ts,
factory-explorer.test.ts and all tests selecting app function/listener source.
Any extra test path ownership is coordinated before edits. Actual functions and
late-response behavior remain required, not only equivalent renderer logic.

## App candidate source receipt (pending independent review/types/browser)

- Isolated c207f8f base with reviewed model and host units only. No shared
  integrator edits. Typed host addendum2edd09f passes UI types; earlier root pass.
- Added request-view rendering, exact app wiring, current-human decide display
  projection (not a grant), and no change to empty production registry.
- Actual app-body held inspection RED exposed prior private detail staying
  visible; preparing branch now synchronously chooses action view with no bytes.
  Disposal clears both owners under paint suppression then paints once.
- Actual app global refresh RED exposed hidden content rereads behind retained
  pending/UNKNOWN; now preserves intent and refreshes metadata outcome only when
  permitted, never another large raw-input read behind action review.
- Actual same-client list-hook RED exposed old session401 after newer list success;
  list now uses existing invocation-aware reader factory, and current401 still
  redacts. No second host token or retry machinery.
- Human decide projection actual Workers RED1fail/2pass (missing display scope)
  then GREEN3/3. Tests include revoked, read-only human and native absence.
  /tmp/r3-decide-projection-{red,green}.log. No actual grants/policy changed.
- Focused current app/model/transport plus all five AST-app harness families:
  194/194 pass /tmp/r3-decision-app-focused.log. Existing Factory/composer
  dependencies did not change; old explicit disposal spies remain tested.
- New actual-browser-DOM held-read spec executes the actual renderApprovals body
  and detached callback, but is AUTHORED, NOT EXECUTED locally. It is explicitly
  not a real-session/HTTP positive decision fixture. Existing six real OIDC
  read-only specs and the new DOM spec await supported CI; no local retry/install.
- App candidate root/UI types and UI build await parent global heavy lease.
  No source acceptance or issue60/61 closure is implied by these unit receipts.
