# Product design guidelines

Status: Design baseline · Contract revision 0.1 · Implementation pending.

The planned CF Agent Hub interface should help a person answer three questions: what needs attention, who currently owns the work, and what evidence supports the next action? Visual design must expose the coordination contract clearly. A polished board that conceals a stale lease, an unanswered approval, or an unverified result fails that purpose.

## Information architecture

Use workspace identity as a persistent context cue. A page heading should identify the current workspace and resource; sensitive confirmations must include the stable workspace ID when display names could be ambiguous. Primary navigation may expose Overview, Inbox, Tasks or Kanban, Agents, Approvals, Activity, and Settings according to permission and profile. Navigation visibility is presentation, never authorization.

The six board columns are Backlog, Ready, Doing, Waiting, Review, and Done. Cancelled tasks appear in the archive. Canonical state names must remain recognizable across custom profiles. A work role, project, label, or preferred language must not create a second state machine. The authoritative transitions are in [task lifecycle](task-lifecycle.md) and board behavior in [Kanban](kanban.md).

A task detail should keep title, state, project, current ownership, latest checkpoint or result, and next permissible action close together. Historical runs and events should remain accessible without competing with the current state. Show stale observations with their timestamp rather than projecting them as live truth.

## Meaningful states and actions

| Display situation | Required explanation | Appropriate next action |
|---|---|---|
| Doing with valid lease | Agent, runtime instance, and lease posture | Inspect progress or authorized cancel |
| Waiting for a decision | Proposal, requested scope, authorized decision-maker, expiry | Review the current proposal |
| Review | Submitted result and independent acceptance requirement | Authorized accept or defined revision action |
| Backlog after retry exhaustion | Failure reason and previous run evidence | Triage before making Ready |
| Notification delivered | Delivery outcome and acknowledgement separately | Inspect authoritative task state |
| Runtime presence stale | Last observed timestamp | Check runtime or provision a replacement |

Do not label a request “Completed” because a webhook returned success. Do not call an agent “Online” when only its durable registration exists. Do not equate a human approval with execution or accepted result. Unknown metrics must read “Not reported” or “Unknown,” never zero.

## Interaction and concurrency

Use command-specific controls instead of unrestricted state editing. The current human board must not drag Ready to Doing: only a bound native runtime can claim execution. Optional Backlog-to-Ready and Review-to-Done drags open the same version-bound confirmation as keyboard buttons. If a movement cannot express the required command or actor, open a task detail or disable the movement with an explanation. A generic metadata editor must not set owner, run, state, decision, or fence fields.

While a mutation is pending, the control must prevent accidental duplicate submission and preserve its idempotency identity. A stale-version conflict must explain that the task changed and offer a current-state review. It must not silently replay the user's intent against new facts. After a lost response, the client must reconcile the original operation before inviting another attempt.

A decision dialog must show the precise current proposal, scope, relevant artifact references, expiry, and impact. Approval requires the authorized human and matching proposal version. Changed proposals invalidate the old decision surface. Destructive confirmations must name what changes; typing an unrelated phrase adds friction without clarifying intent.

## Accessible presentation

Use text labels and icons in addition to color for state, errors, and urgency. Maintain usable keyboard focus, logical tab order, descriptive field labels, and announced status changes. Kanban must have an equivalent list or table path for reading and acting without drag gestures. Narrow layouts must preserve task identity, state, and the next action without forcing a full desktop board into tiny cards.

Dialogs must move focus predictably, retain it while open, and restore it to a sensible control when closed. Form errors must identify the affected field and how to correct it. Respect reduced-motion preferences; motion should explain a change, not delay an operation. Accessibility acceptance should use the relevant [WCAG 2.2](https://www.w3.org/TR/WCAG22/) criteria; this baseline claims no conformance certification.

The local issue45 task dialog is mounted outside replaced read projections. It retains one reason input node, names the exact reviewed task/result, and uses an ordinary disclosure with normal tab order. Escape hides the dialog without cancelling an in-flight command. Completion focus belongs to the original interaction token, not merely the same page; a newer dialog or navigation invalidates that ownership. Only a fresh destination observation may receive moved-card focus. Current source/structural verification is not browser accessibility certification.

## Branding and trust boundaries

Semantic visual tokens should distinguish surfaces, text, focus, state, and action emphasis. A workspace accent cannot override warning meaning or make content unreadable in another theme. User theme and density preferences follow [configuration](configuration.md). Product text must remain neutral with no required personal identity or deployment branding.

Render task bodies, agent names, external labels, and imported descriptions as untrusted content. Do not render arbitrary profile HTML or execute remote templates. Show a credential only in its one-time reveal flow; clear it on dismissal or navigation, avoid drafts and analytics capture, and never place it in durable browser storage. UI permissions are helpful guidance; the server must repeat all authorization checks.

## Design acceptance

Review empty, loading, permission-denied, partial failure, stale-version, revoked-session, and recovery states before promotion. Exercise keyboard-only task handling, a narrow viewport, both supported themes, and long untrusted labels. Verify that hidden navigation leaves active obligations visible to authorized actors. Confirm that the interface distinguishes specification-only features from implemented ones using the [feature matrix](feature-matrix.md).
