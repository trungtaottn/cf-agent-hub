# Kanban workspace

Status: Design baseline with local issue42 reads and issue45 four-command source. Browser and live acceptance remain pending.

The Kanban is a view of durable tasks, their execution ownership and their review state. It is not a second task database. All UI actions issue the same authorized domain commands as the native API, then reconcile the returned task version.

## Local read and command subset

The `/tasks` shell uses the existing authenticated browser transport and canonical task, run, result, artifact-metadata and event reads. Issue45 adds Ready, Cancel, Requeue and Accept-result through the existing canonical cookie-authenticated HTTP commands. It has no approval, human claim, artifact-byte fetch or local authority store. Broader R3 descriptions below remain design targets, not enabled controls. See [issue42 execution evidence](r2-task-plans/issue-042-execution.md).

Each of the six canonical columns and the separate cancelled archive has an independently authorized page of at most 20 tasks. Next replaces the page rather than accumulating records; refresh resets cursors. A page count is never a workspace total, and an unavailable page boundary is not a terminal result. Loading, stale, empty, error and unavailable observations remain separate.

Detail reads the selected task first, then independently reads its latest observed run, retained result page and optional authorized event page. Current result and historical result are distinguished using the canonical current result run, not the latest run alone. Acceptance actor/time appears only from matching current-result event evidence; absence on a bounded event page is not proof that acceptance never occurred. Artifact metadata is limited to the current result's five possible references and requires `artifacts:read`. No public human runtime-presence read exists, so presence is explicitly unavailable; an observed lease deadline does not prove an online runtime or current execution authority.

A denied session/read clears sensitive projections. A missing selected task, including a task-results 404, purges its detail children and cached board card and invalidates pending reads. Unrelated cached observations can remain stale until explicit refresh. Hidden navigation does not disable backend task processing. The `tasks` and `kanban` preference aliases resolve to the same view only when profile visibility and current task-read scope permit it.

Semantic sections, headings, lists and links expose the board without a misleading interactive ARIA grid. Focus restoration, literal dynamic text and narrow-screen wrapping are implemented and covered by source/structural tests. Real browser geometry, keyboard behavior and accessibility acceptance are not established when the pinned browser cannot launch. Waiting approval/reject controls are unavailable R3 placeholders, never active decisions.

## Version-bound task commands

The Actions disclosure offers ordinary keyboard buttons, not a partial ARIA menu. Every new action first reads current workspace access and the exact task; Accept also corroborates the latest submitted run and excludes the stable submitter principal or agent. Displayed grants are coarse guidance, never per-resource authorization. The backend repeats the current grant, project, version and domain checks. Backlog → Ready and eligible Review → Done are optional internal drags that open the same confirmation. No drag manufactures Doing, Waiting, a run or approval.

The persistent native dialog names workspace, task and version; Accept includes the exact reviewed result/run. Cancel, Requeue and Accept require an unmodified reason. Cancellation cannot undo external effects already performed. Navigation, offline state and renewed reads invalidate preparation, not a dispatched intent. A known version conflict keeps the draft, observes the current task and requires explicit review before a different version/key can be submitted.

One in-memory task intent owns its exact operation, path, expected version, body, principal and idempotency key. Pending or uncertain outcomes block new task intents. A network loss, invalid receipt or any 5xx remains uncertain; only deliberate same-key/same-body replay under current access can reconcile it. Replay does not rebase against a newer task version. Even a local replay preflight failure leaves the earlier uncertainty intact. Success receipts must match the original task/workspace, exact next version and command state; Accept additionally preserves the original result/run/submitter/artifacts. Real authentication revocation clears sensitive state and says the prior outcome remains unresolved. No intent enters local storage, URLs or telemetry.

After confirmed success, bounded reads refresh independently. Failed refresh never erases the known command outcome or makes stale cards current. Focus restoration is bound to the originating interaction and a successfully refreshed destination card; otherwise the stable main heading is the fallback. Background updates preserve the reason node/caret and do not reclaim focus after navigation or a newer dialog. These source behaviors do not substitute for pending real-browser verification. See [issue45 execution evidence](r2-task-plans/issue-045-execution.md).

## Board model

| Column | What a person needs to understand | Main available action |
| --- | --- | --- |
| Backlog | Work exists but is not scheduled; flags explain blockers or exhausted retries | Edit allowed metadata; schedule eligible work |
| Ready | Work can be claimed by an eligible agent/runtime | Adjust eligible assignment through allowed commands; cancel |
| Doing | Current agent/run, lease freshness and last checkpoint | Inspect execution; cancel with permission |
| Waiting | The exact human decision requested, affected scope and expiry | Authorized human approve/reject |
| Review | Submitted summary and committed evidence awaiting independent acceptance | Accept or requeue with a revision reason |
| Done | Accepted outcome, independent reviewer and time | Inspect retained evidence and audit |

Cancelled tasks appear in the archive, with the actor and reason. They do not disappear from search or history merely because the main board excludes them. Empty workspaces start without demo projects, roles or tasks; users can explicitly import an example profile.

## Actions are commands

Dragging Backlog to Ready invokes a schedule command with the displayed `task_version`. Dragging Review to Done is only offered to an eligible independent reviewer and invokes accept-result. Dragging into Doing must not invent a run; only a bound native runtime can claim work. Waiting is reached through a proposal from an active run, not by changing a column name.

The UI may offer selection shortcuts, but it must not turn unsupported transitions into a generic state PATCH. For complex transitions, a dialog presents the actual command and its required inputs. A human approval displays the proposal, action scope, artifacts/checkpoint, expiry and version before submission. A hidden button is not an authorization boundary; the server enforces every guard.

## Card and detail information

A card shows title, project/work-role labels when configured, assignment, state, meaningful flags and current ownership freshness. It distinguishes the logical agent from its runtime instance. A stale presence badge is separate from an expired task lease. Counts are calculated from authorized query results; a partial page must not be presented as a workspace-wide total.

The task detail brings together intent, state history, run attempts, discussion, decision proposals and result artifacts. Each section identifies its source and timestamp. A referenced message ACK appears in delivery history, never as a completion indicator. The latest submitted result remains visible after a request for revision, but is clearly historical rather than the current accepted result.

## Concurrent use and recovery

The browser stores a displayed version for each editable resource. If another actor changes it first, a conflict preserves the user's input, refreshes authoritative state and explains why the action no longer applies. Do not blindly retry a drag with a new version; the user's intended action may have changed meaning.

Loading, empty, stale, partial, unavailable and permission-denied states are visually distinct. After a disconnected browser resumes, it refreshes active tasks and pending decisions before re-enabling consequential actions. It must not simulate success with local storage. Filters and user preferences may persist locally only when the deployment's privacy policy permits; authoritative state remains server-side.

## Personalization and accessibility

Workspace profiles choose a workspace display name, an allowed accent token, visible views, and project/work-role catalogs. Individual user preferences may select an allowed default view. Internal state IDs and authorization remain stable. The current profile schema does not expose arbitrary navigation or column-label overrides; a later localization contract must preserve canonical state meaning. Hiding the board does not stop leases, alarms or task processing.

Every drag operation needs a keyboard-accessible menu equivalent. State must be communicated through text as well as color. Focus should return to the moved or updated card, and live updates must not repeatedly steal focus. On narrow screens, a list view retains the same state and command semantics. See [design guidelines](design-guidelines.md) and [customization](customization.md).

## Acceptance evidence

The release gate requires a real task journey from capture through claim, optional human decision, result submission and independent acceptance. Tests must cover stale versions, a denied self-review, a disappearing permission, cancelled tasks in archive, restart persistence and a board hidden by profile. A polished static board only demonstrates presentation; it cannot satisfy these domain requirements.
