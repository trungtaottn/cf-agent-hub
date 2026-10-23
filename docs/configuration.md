# Configuration

Status: Design baseline · Contract revision 0.1 · Implementation pending.

Configuration in CF Agent Hub has four separate owners: deployment operators, workspace policy administrators, workspace profile editors, and individual users. The separation prevents a harmless visual preset from becoming a way to grant access or redirect stored workspace data. These are proposed configuration contracts; no loader, settings screen, or deployment command is delivered by this documentation baseline.

## Ownership and precedence

| Layer | Owner | Contains | Must never be changed by |
|---|---|---|---|
| Deployment and authentication | Deployment operator | Workspace catalog, object-name mapping, verified identity provider settings, platform bindings, static participants | Profile import or user preferences |
| Workspace policy | Authorized workspace administrator | Grants, eligibility, review rules, WIP rules, notification destination policy | Branding or navigation controls |
| Workspace profile | Principal with profile-edit permission | Workspace name, descriptive copy, appearance, projects, work roles, visible navigation | Agent self-description |
| User preferences | Authenticated human for their own account | Allowed theme, density, default view | Another user's preset import |

Appearance resolves from neutral defaults, then allowed workspace profile values, then allowlisted user preferences. Policy is evaluated independently on every command and is a ceiling on behavior. A personal default view cannot reveal a forbidden resource. Hiding Kanban or Approvals in navigation cannot pause the engine, waive a review requirement, or remove an outstanding decision.

A fresh workspace profile has empty project and work-role collections. Demo content is explicitly imported. See the contract fixtures [neutral profile](../examples/profiles/neutral.json), [delivery profile](../examples/profiles/delivery-demo.json), and [user preferences](../examples/config/user-preferences.json).

## Fixture schemas and semantic checks

The proposed portable contracts use JSON Schema 2020-12:

| Contract fixture | Schema |
|---|---|
| Neutral and delivery demonstration profiles | [Workspace profile schema](../spec/workspace-profile.schema.json) |
| User preferences | [User preferences schema](../spec/user-preferences.schema.json) |
| Deployment review fixture | [Deployment configuration schema](../spec/deployment-config.schema.json) |

All object shapes are closed: unknown fields are rejected at every level. Stable identifiers are lowercase slugs beginning with a letter and using letters, digits, underscores, or hyphens. The baseline accent palette is `blue`, `teal`, `indigo`, `violet`, `amber`, or `slate`; arbitrary CSS values are not allowed. Profile branding currently carries the accent only; asset support requires a later explicit contract revision. Preference themes are `system`, `light`, or `dark`, and densities are `comfortable` or `compact`.

The deployment fixture permits HTTPS issuer URLs and HTTPS allowed origins; origins cannot include a path, query, fragment, user information, or port. Example namespace values are placeholders and do not establish a verified provider or reachable service. URL parsing, host safety, identity-provider discovery, and exact issuer/audience verification remain implementation requirements.

JSON Schema checks shape and bounded string values. Semantic validation must additionally enforce unique stable IDs within each collection, unique workspace catalog identifiers and object mappings, unique participant identities within a workspace, participant-to-catalog referential integrity, valid existing references, and current policy precedence. `uniqueItems` cannot enforce uniqueness of one object property. Schema validity never authorizes an import or settings change. Runtime quotas and other operational numeric defaults remain owned by [limits](limits.md).

## Deployment catalog

The operator-provisioned catalog maps a public workspace identifier to its Durable Object name. The hub must resolve the authenticated route against that catalog and then check workspace membership or credential scope inside the command. The mapping is immutable through profile settings. Renaming a workspace changes its display name, not its identity, object location, artifact namespace, or existing grants.

The [deployment fixture](../examples/config/deployment.example.json) is a secret-free review example, not a runtime manifest. Its identity-provider values are placeholders. Actual issuer, audience, platform bindings, and allowed origins must be validated before admission is enabled. Signing and encryption secrets belong in the deployment's secret facility. Native credential verification hashes belong in protected workspace state; a profile must contain neither credential material nor its hashes.

Static participant references describe operator-approved R1 participants. They are deployment-only configuration. Dynamic enrollment belongs to the R2 agent registry and must not be simulated by editing a profile. See [agents](agents.md) and the [deployment runbook](deployment.md).

## Validating and applying a settings change

A planned settings operation must authenticate the actor, authorize the affected layer, validate a closed schema, check the current settings revision, and commit the resulting settings plus an audit event transactionally. Exact routes and request shapes belong to the [HTTP API](http-api.md). Fixture envelopes describe portable data, not implicit API request bodies.

Unknown fields, prohibited fields, duplicate stable IDs, invalid references, unsafe links, and unsupported contract revisions must fail validation. The interface must show a field-specific error without partially applying accepted fields. A stale revision requires rereading the current settings and reviewing the difference; blind last-write-wins behavior is forbidden. A client recovering from a lost mutation response must use the same idempotency key and identical request, following [delivery semantics](delivery-semantics.md).

Project and work-role imports are stable-ID upserts. Omitting an existing record never deletes it. Archiving or remapping a referenced record requires an explicit operation and a preview of affected tasks or agent assignments. An importer must not turn an archived role into an authorization role: work roles describe work; grants authorize it.

## Boundaries and operational recovery

An invalid deployment must fail admission with an operator-visible diagnostic instead of silently falling back to another issuer, workspace, or weaker authentication mode. A rejected profile edit leaves the previous valid profile active. A malformed user preference falls back only to an allowed appearance value and must not affect policy.

Restoring a configuration snapshot requires checking the catalog mapping separately from workspace profile revisions. Restoring visual settings cannot revive revoked credentials or memberships. After an authentication change, operators must test a permitted principal, a forbidden principal, and a principal from another workspace before reopening writes. Recovery requirements are in [backup and restore](backup-restore.md).

Numerical bounds and proposed lease behavior are owned by [limits](limits.md); this page does not introduce a second limits inventory.

## Implementation acceptance

- Profile import rejects authentication, policy, membership, and secret fields before writing anything.
- Cross-workspace reads and writes fail even when display names match.
- A visual rename preserves task, agent, artifact, and audit references.
- Reimporting a preset updates matching IDs, preserves omitted records, and reports conflicts.
- A hidden view remains reachable only when authorized, and active engine obligations remain visible through appropriate attention surfaces.
- Settings audit records identify actor, workspace, changed layer, revision, and outcome without recording secrets.
