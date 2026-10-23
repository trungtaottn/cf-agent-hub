# Kanban workspace

Status: Design baseline · Contract revision 0.1 · Implementation pending.

The Kanban is a view of durable tasks, their execution ownership and their review state. It is not a second task database. All UI actions issue the same authorized domain commands as the native API, then reconcile the returned task version.

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
