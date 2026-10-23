# Use cases and acceptance walkthroughs

Status: Design baseline · Contract revision 0.1 · Implementation pending.

These walkthroughs describe intended CF Agent Hub outcomes and the evidence required to accept an implementation. They are contract scenarios, not demonstrations of a running service. HTTP and CLI are the core interaction surfaces; adapters must preserve the same domain checks. Consult the [feature matrix](feature-matrix.md) before treating any step as available.

## Coordinate a research handoff

A human creates a task with a clear question, project reference, expected evidence, and acceptance criteria. After an authorized transition makes it Ready, an eligible external research agent claims it. Claiming binds one runtime instance to the current run. The hub records task changes, events, and delivery intent locally before attempting notifications.

The runtime gathers evidence outside the hub, uploads permitted artifacts through the staged artifact flow, and submits a result referencing committed artifacts. The task moves to Review and releases the lease. An independent authorized reviewer evaluates the result against the original criteria and explicitly accepts it to reach Done.

Acceptance evidence must show one successful claim under contention, a traceable artifact, a result event, and a distinct acceptance actor. A result whose artifact upload never committed must not be presented as a complete evidence package. A delivery acknowledgement must not move the task to Done. Artifact upload and reconciliation details belong to [delivery semantics](delivery-semantics.md).

## Pause for a human decision

An operations agent encounters an action outside its permitted autonomy. It records a checkpoint and an exact proposal describing the intended action and scope. Requesting a decision moves the task to Waiting and releases the run lease. An authorized human reviews the current proposal, including relevant evidence and expiry, through a protected browser session.

Approving the matching proposal moves the task to Ready. A new claim establishes fresh ownership before work proceeds. Rejecting returns it to Backlog. Expiry leaves it Waiting for explicit triage. A changed proposal requires a new matching decision; a cached approve button cannot authorize revised work.

Acceptance requires a denied decision from an unauthorized human, a denied self-decision from an agent credential, a denied stale proposal, and a successful matching decision. The runtime must not perform the external action merely because it sent an approval request. The complete contract is in [task lifecycle](task-lifecycle.md) and [security model](security-model.md).

## Recover from an unavailable runtime

An agent runtime loses connectivity after claiming a task. The interface shows its last observed presence separately from its run lease. Lease expiry invalidates owner commands using the old fence. If bounded retry remains, the task returns to Ready; otherwise Backlog displays an attention flag.

Before assigning a replacement, an authorized operator reviews checkpoint evidence and whether the first runtime already performed an external effect. The replacement must obtain a new claim. It cannot inherit a stale runtime ID or fence. If the first runtime reconnects, its obsolete owner commands must fail even when it uses a formerly valid credential.

Acceptance evidence must include a rejected stale command and a successful fresh claim. For irreversible actions, the external integration must supply its own deduplication or reconciliation evidence. Task retry eligibility cannot establish that repeating the external action is safe. Timing bounds are owned by [limits](limits.md).

## Adapt a workspace to a team

An administrator imports the optional delivery profile after inspecting a preview. Its stable project and work-role IDs are upserted. Existing records omitted from the preset survive. A human sets a personal theme and default view within the workspace's allowed presentation choices.

The same administrator later renames a project and archives a work role through explicit reviewed changes. Historical tasks retain stable references. Profile export contains portable appearance and organization data, without secrets, membership, activity, or user preferences.

Acceptance requires an atomic rejection of prohibited profile fields, preservation of omitted records, and equivalent authorization before and after changing branding. Follow [customization](customization.md) for the detailed flow.

## Bring existing task records into the hub

An authorized operator prepares generic external task records with source identifiers, source timestamps, and provenance. A dry-run review must identify duplicate mappings, unsupported states, missing references, and the intended cutover boundary before applying an import. Source identifiers are reconciliation keys, not trusted authorization.

Imported records must map to the canonical lifecycle explicitly; a foreign “complete” label must not be interpreted as an independent reviewer acceptance without an approved mapping and evidence rule. A repeat import must reconcile by stable provenance rather than duplicate tasks. Concurrent external edits require an explicit reconciliation policy and visible conflicts.

Acceptance requires a repeatable preview, no partial application on a rejected batch, preserved provenance, and an inspectable reconciliation report. The [HTTP API](http-api.md) owns the proposed import contract; no source-specific connector or live synchronization is claimed.

## Invite a collaborator to an existing workspace

In the R4 team scope, an authorized administrator invites a human to a catalog-provisioned workspace. Verified identity and current policy govern acceptance. Membership affects only that workspace. Removing the member blocks subsequent commands and preserves audit history. It does not erase their historical reviews or silently decide their outstanding approvals.

Acceptance must test invitation replay, expiry, revocation, wrong-workspace access, and a pending approval whose assigned human loses access. Read [teams](teams.md) for the release-specific boundaries. The deployment's workspace catalog remains operator-controlled throughout the flow.
