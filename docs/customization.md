# Customization and portable profiles

Status: R1 server settings transport implemented in source · Contract revision 0.1 · Live deployment verification pending.

Workspace profiles let an operator adapt CF Agent Hub to a team's vocabulary and visual identity without changing the coordination contract. A workspace may present a delivery board, a research queue, or an operations desk while using the same task state machine, agent identities, and review boundaries. R1 implements the server profile preview, versioned upsert, export and personal preference transport described below; browser settings controls remain a later task.

## What a profile can express

A portable profile contains a stable profile identifier, a display name, descriptive copy, branding tokens, visible navigation, projects, and work roles. Projects organize work. Work roles describe responsibilities such as Researcher or Reviewer; the label Reviewer does not grant permission to accept a result. Both use stable IDs so display names can change safely.

The [neutral fixture](../examples/profiles/neutral.json) is intentionally empty of projects and work roles. The [delivery demonstration](../examples/profiles/delivery-demo.json) is opt-in example content. Neither fixture asserts that tasks, users, or agents already exist. A profile ID identifies the portable preset, not a workspace and not an authorization scope.

Branding is limited to validated product surfaces: a short workspace label, approved color tokens, and an administrator-controlled asset reference in a later contract revision. Arbitrary HTML, JavaScript, stylesheet injection, remote tracking pixels, and executable theme templates are outside the baseline. The profile must never replace security warnings, actor-kind labels, provenance indicators, or canonical state labels. See [design guidelines](design-guidelines.md).

## Import flow

An authorized editor selects a profile and the destination workspace. The server must validate the closed contract, then prepare a preview showing proposed changes and conflicts. Previewing must not modify state. The editor reviews the destination workspace identity, current revision, stable IDs, and any archive effects before applying the change through the domain service described by the [HTTP API](http-api.md).

Application must atomically commit the permitted profile changes and audit event against the expected profile revision. Stable IDs are upserted; missing existing IDs are preserved. If a preset renames `role_research`, assignments keep that ID and show its new label. A preset introducing `role_analysis` creates a separate work role even if its label matches an existing one. The importer must surface that possible duplication rather than merge by name.

Archiving a project prevents new selection while retaining historical task references. Archiving a work role requires an explicit review of current agent metadata and task eligibility configuration. If references require remapping, an authorized actor must choose the destination explicitly. A profile import cannot rewrite the workspace's policy layer as a side effect.

## User preferences

A user's theme, density, and default view can override only fields allowed by the workspace. The [preferences fixture](../examples/config/user-preferences.json) is a separate contract; it must not be embedded in a shared preset. Workspace policy and permission checks remain in effect regardless of a preference. If a previously selected view becomes unavailable, navigation must explain the fallback and offer an allowed destination.

Workspace branding must remain legible in light and dark themes. User preference controls should identify when a workspace policy restricts a choice. A profile may hide a navigation entry to reduce clutter, but the interface must still surface authorized urgent approvals or lease failures requiring attention. In R1 the UI keeps Overview as a safe fallback and Settings reachable, intersects optional profile navigation with actually supported routes, and reports `VIEW_UNAVAILABLE` when a stored default view is hidden or not implemented. Hiding navigation does not revoke underlying route permissions or grant any new scope.

## Export and recovery

Export includes portable profile data only. It excludes secrets, verification hashes, runtime endpoints, memberships, invitations, agent enrollment credentials, task content, activity history, user preferences, and deployment catalog mappings. An export preview must list its included categories so an editor understands what will be shared. If a later contract adds asset references, their export must not grant access to otherwise private artifact bytes. The current profile schema has no asset field.

Validation failure leaves the current profile intact. For R1 browser preview/apply, locally invalid JSON documents remain editable: malformed JSON receives a parse/correction message, while well-formed but schema-invalid requests show a sanitized canonical field location (for example, `/profile/projects/0/display_name`) without sending a mutation. Unknown property names are not reflected in the interface. An apply conflict requires refreshing and comparing revisions. A lost response must be retried with the original idempotency key and identical body, not by generating another import. An explicit restore of a previous profile creates a new audited revision; it must preserve later-created projects and roles unless archival or remapping is separately approved.

## Acceptance criteria

A fresh workspace must render coherently with no demo data. The demo preset must be visibly optional. Export/import between two workspaces must reproduce permitted presentation settings without transferring access. A stale preview must fail safely. Omitted projects must survive import. Every invalid field must receive a useful validation message. A rejected import must produce no partial settings changes. All canonical task states must retain recognizable labels and semantics across profiles.

## Implemented R1 server behavior

The server now provides closed preview, apply and export transport; the browser controls are a later task. Preview contains only the canonical merged portable profile, base revision, bounded JSON Pointer changes, and bounded archive/remap conflict categories. It creates no durable preview row, outcome, event or revision. Its required Idempotency-Key correlates advisory recomputation. Apply revalidates the installed policy, current human authority, expected revision and referenced project restrictions inside the one synchronous transaction that commits state, one accepted event and the durable command outcome.

Stable-ID upsert preserves omitted projects and work roles. Label matches never merge different IDs. Current project grant restrictions count as references: changing a referenced project's archived flag in either direction is rejected. R1 has no work-role assignment or task reference table; later domain owners must extend the reference predicate when those persisted relationships exist. No R1 profile route remaps references.

Exports contain exactly profile_revision, profile and included_categories `['presentation','projects','work_roles']`. They do not include preference state or deployment/identity data. The profile-edit-only human lane can preview, apply and export without workspace:read. Workspace:read gates ordinary profile/configuration reads; preference access additionally requires a human session.
