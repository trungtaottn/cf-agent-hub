# Teams, membership, and collaboration

Status: Design baseline · Contract revision 0.1 · Implementation pending.

Team collaboration is a planned R4 extension for inviting humans into existing workspaces. It is not automatic tenant provisioning, a global organization directory, or a way to create new Durable Object mappings from the browser. The deployment operator provisions the workspace catalog first. Until the team release gate is implemented and verified, documentation must describe team membership as specified behavior only.

## Membership model

A human principal is identified by verified issuer and subject. A membership connects that principal to one existing workspace with explicit permissions. Display names and email addresses are presentation or invitation hints; matching an email is insufficient to merge identities or grant access. An agent is a separate participant kind with separate credentials and grants.

Administrative capabilities must be distinct from work-role labels. A person described as a project Lead does not automatically administer membership. An agent labeled Reviewer does not become a human decision-maker. Policy owners must define who can invite, change grants, remove members, manage agents, review results, and decide approvals. Canonical requirements are in the [security model](security-model.md).

The baseline has no cross-workspace team directory. A person may hold memberships in several catalog-provisioned workspaces, but each command must check the membership for the requested workspace. A global navigation shell must not infer access from the existence of another membership or from a matching display name.

## Planned invitation flow

An authorized membership administrator selects an existing workspace and a permitted grant set. The system creates an auditable invitation with bounded validity and one-time acceptance semantics. A recipient signs in through the configured verified Access/OIDC boundary. Acceptance must bind the current verified issuer and subject through the invitation's intended-recipient rule and current policy; a UI email match alone is not sufficient.

Before acceptance, the interface must show the workspace's stable identity, invitation issuer, offered access, and expiry. Acceptance must atomically consume the valid invitation and create or update the membership. If the offered grant is no longer allowed, the invitation must fail rather than grant a silently altered privilege set. Invitation transport must avoid exposing credentials in logs, analytics, or referrers.

Invitation issuance, acceptance, revocation, and expiry contracts must be reviewed in the canonical [HTTP API](http-api.md) before implementation. This guide does not reserve route names or imply that invitation endpoints already exist. The [roadmap](roadmap.md) identifies the relevant release gate.

## Removing access and changing responsibilities

A membership change must affect subsequent commands. A stale browser tab cannot preserve permissions by retaining a rendered action button. Removing a person from approval scope prevents a later decision even if they received the original notification. Existing audit events retain their actor identity; membership removal does not erase accountability.

If the change leaves a task without an authorized reviewer or a pending approval without a decision-maker, the interface must surface that condition to an authorized administrator. Reassignment must preserve the proposal and task history. It must not fabricate approval, mark work Done, or silently transfer a live run. Active runs remain governed by the [task lifecycle](task-lifecycle.md) and current agent grants.

A workspace must not be left without a recoverable administrative path. The exact last-administrator guard and operator recovery procedure must be specified and verified before membership writes ship. Operator recovery must be audited and must not rely on matching a new identity's email to an old principal.

## Failure and recovery

Expired, revoked, consumed, or wrong-workspace invitations must not create membership. Retrying an accepted invitation must not create duplicate memberships. A lost mutation response follows the idempotency rules in [delivery semantics](delivery-semantics.md). Conflicting membership revisions require rereading current access before retrying.

An identity-provider subject change requires an explicit operator-reviewed identity mapping; it must never be guessed from profile data. A membership import is not part of profile import or export. Restoring a workspace snapshot must reconcile current revocations and identity-provider policy before admitting writes.

## Release acceptance

Before R4 promotion, verify wrong-workspace isolation, invitation replay and expiry, grant attenuation, immediate revocation on subsequent commands, last-administrator recovery, audit completeness, and approval reassignment. Tests must use multiple distinct verified principals, including an unauthorized principal. UI-only tests cannot establish the authorization boundary.
