# Configuration

Status: R1 server settings transport implemented in source · Contract revision 0.1 · Live deployment verification pending.

Configuration in CF Agent Hub has four separate owners: deployment operators, workspace policy administrators, workspace profile editors, and individual users. The separation prevents a harmless visual preset from becoming a way to grant access or redirect stored workspace data. The R1 source implements the closed deployment loader and server settings transport described below. Browser settings controls and live deployment verification remain later gates.

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

A planned settings operation must authenticate the actor, authorize the affected layer, validate a closed schema, check the current settings revision, and commit the resulting settings plus an audit event transactionally. The R1 route shapes belong to the [HTTP API](http-api.md). Fixture envelopes describe portable data, not implicit API request bodies.

Unknown fields, prohibited fields, duplicate stable IDs, invalid references, unsafe links, and unsupported contract revisions must fail validation. The interface must show a field-specific error without partially applying accepted fields. The R1 browser client rejects invalid profile and preference write payloads locally as `INVALID_REQUEST` before HTTP dispatch and returns `error.details.field` as a bounded JSON Pointer containing only canonical field names and numeric indexes. Unknown property names and submitted values are never included in this hint; unsafe paths fall back to `/profile` or `/preferences`. These client hints do not replace server-side authorization and closed-schema validation. A stale revision requires rereading the current settings and reviewing the difference; blind last-write-wins behavior is forbidden. A client recovering from a lost mutation response must use the same idempotency key and identical request, following [delivery semantics](delivery-semantics.md).

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

## R1 deployment and settings amendment

Only the deployment schema advances to revision 0.2. It requires a positive `config_epoch`, `human_grants`, `static_credential_refs` and one `workspace_policies` entry per catalog workspace. Static participants remain identity records. Human grants bind exact issuer/subject to a stable `principal_id`, scopes, project restrictions and enabled state per workspace. Native references bind credential ID to an existing agent, explicit R1 scopes and project restrictions, expiry and enabled state. Expiry is at most 90 days from provisioning. The closed [bootstrap schema](../spec/r1-bootstrap.schema.json) and secret-free [example](../examples/config/r1-bootstrap.example.json) describe hashed verification material; an authenticated operator bundle is protected outside source control. The helper and monotonic installation process are specified in [deployment](deployment.md).

Authentication requires exact HTTPS issuer, `client_id` equal to audience, one exact HTTPS `/v2/workspaces/{workspace_id}/auth/callback` redirect per catalog entry, secret binding reference, session TTL 300–28,800 seconds and initial algorithm list `['RS256']`. Discovery issuer and endpoints require review. Each workspace policy declares its unique `allowed_user_overrides`, notification destinations and `retry_after_max_seconds` (0–3,600, default 3,600). Destination URL safety and exact allowlist rules are in [security](security-model.md). Schema shape validation is followed by semantic uniqueness, exact mapping, references and epoch checks; failures name the field without echoing secret material.

R1 transports deployment/policy changes only as operator file → closed validation → authenticated protected bundle → monotonic per-workspace install through the separate operator gateway. The public `GET /configuration` is a redacted capability projection. It is not a deployment export or write endpoint. Human `profile:edit` permits closed profile preview, revisioned upsert and portable export. A preview is advisory; changed revision produces conflict on apply. Closed changes/conflicts are bounded to 200 each and a 65,536-byte response envelope; overflow fails rather than truncating. Stable-ID upsert preserves omitted records; referenced archive/remap waits for the R2 operation. Each human's portable preferences are keyed by workspace and principal, and only policy-allowlisted overrides take effect. Stale writes return 409 with the current revision.

The [recovery manifest](../spec/recovery-manifest.schema.json) preserves a complete bounded logical SQL history, while a separately authenticated current-authority ledger supplies current grants/revocations during restore. Snapshot data cannot replace the latest ledger. Restored sessions and login attempts are invalidated. The [R1 recovery runbook](runbooks/r1-recovery.md) owns the protected operator protocol and exclusive-authority admission.

The required closed `authentication.reviewed_oidc_endpoints` contains exact pinned `authorization_endpoint`, `token_endpoint` and `jwks_uri`. All are canonical absolute HTTPS operator-approved host/path URLs, 9–2,048 characters, with no query, fragment, credentials, explicit port, IP literal or local/private/metadata target. Exact discovery issuer and all three endpoint strings must match the installed values before they are used; server-side redirects are refused. Browser login redirects remain a normal provider interaction from the pinned authorization endpoint. See [ADR 0007](adr/0007-r1-ingress-and-settings.md#endpoint-pinning-closure).

### Human auth Worker bindings

`DEPLOYMENT_CONFIG` contains the complete validated deployment JSON and supplies only the stable workspace catalog for public auth routing. The target Durable Object reads its own installed configuration and epoch for proof and grant authority; changing the routing binding does not install grants. Missing or invalid configuration fails closed. The installation and public bindings must preserve the reviewed stable workspace mapping.

The binding named by `authentication.client_secret_ref` contains the provider client secret. `CSRF_SECRET` is a separate protected secret containing at least 32 random bytes, encoded for storage as a string. Never derive it from a cookie, session digest, client secret or provider token. These secret values are provisioned through protected Worker secret bindings, not deployment JSON, browser storage, command-line arguments or repository files. The application returns a session-bound HMAC CSRF token only through the no-store authenticated session response.

Register the exact configured GET callback with the provider and choose the Basic confidential-client profile described in ADR0007. Keep provider/application clocks aligned for the zero-tolerance proof policy. No refresh token is used; the local cookie expires no later than the ID token. Real-provider compatibility, gateway and deployment verification remain separate release gates.

### Executable R1 settings transport

The R1 source implements the settings routes described above using the canonical OpenAPI DTOs and generated validators. [Browser settings screens](../src/ui/settings.ts) are also implemented; live deployment verification remains a separate pending gate. Public deployment and policy writes remain outside these routes.

An absent personal preference has revision `0`, neutral values (`system`, `comfortable`, `overview`), and no stored row or edit event. A first `PUT /preferences` supplies `expected_preferences_revision:0` and commits revision `1`. Stored row versions, profile revisions, installed epochs and settings event resource versions remain positive. A stale first-write request can report `current_revision:0`.

A preferences PUT is a complete closed portable document. The service compares each theme, density and default-view value against the validated stored document, or neutral defaults when it is absent or malformed. An unchanged field outside `allowed_user_overrides` can carry through. Changing any disallowed field rejects the entire command with a field pointer such as `/preferences/theme`; no other field, revision, accepted event or outcome commits. Effective values are always filtered through the current installed policy. A malformed stored document produces a fixed redacted server diagnostic and safe values while retaining its actual revision; a read never repairs or inserts a row.

The response-only `default_view_fallback_reason` is required and is `null`, `VIEW_UNAVAILABLE`, or `PREFERENCE_NOT_ALLOWED`. It is null when the effective view equals the normalized stored/default preference. Policy takes precedence when default_view is disallowed and differs; otherwise an unavailable or unauthorized selection uses VIEW_UNAVAILABLE. R1 human inbox, tasks, Kanban and approvals cannot become available through a profile or preference. Overview is the deterministic authorized fallback. Stored enum intent survives feature unavailability; navigation visibility remains presentation and supplies no authority. In R1, a stored Activity default also falls back to Overview with `VIEW_UNAVAILABLE` when the current profile hides Activity. The profile cannot hide the Settings entry or grant access to a hidden/deep-linked resource.

Preference rows have an immutable, unique opaque server record ID bound to their workspace/principal. Forward SQL migration 3 backfills legacy rows without changing their document or revision; new IDs are allocated before the first committed write. The ID is not portable preference content and never encodes a principal slug. The actual settings event predicate checks current scopes and the persisted owner association before projecting a preference event ID or summary. Configuration events require a human with events:read and operations:read. Profile events require events:read and workspace:read.

An ordinary same-intent replay returns the original outcome and creates no new event. Replays reauthorize the current actor and resource; a preference outcome whose former effective projection conflicts with current policy is denied, and a fresh GET supplies the current effective values. This preserves both immutable command outcomes and the current policy ceiling.

## R2 contract amendment — 2026-10-26

These are source/design contracts, not available R1 endpoints or an installed policy. The selected technical direction was made under the owner's research-and-review delegation; it is not a claim of personal owner selection or live acceptance. See [ADR 0008](adr/0008-r2-authority-and-history.md).

The closed [ExecutionPolicy schema](../spec/execution-policy.schema.json) requires `policy_version >= 1`, `agent_wip_limit` in 1–100, `task_retry_limit` in 0–10, `artifact_upload_ttl_seconds` in 60–3,600, and explicit `eligibility_rules` and `replay_safety_rules`. All numeric values are integers. Missing policy never permits unlimited execution. WIP 1, retries 2 and TTL 900 are fixture choices, not production defaults. Rule project/work-role components are exact nullable identifiers, not wildcards. Eligible IDs must be distinct and currently eligible; duplicate eligibility tuples and duplicate/conflicting replay rules are rejected. Replay-safe classification must come from an operator-reviewed rule with evidence; no match is unsafe, and `outcome_unknown` overrides classification. Static shape/tuple checks do not establish current grants or evidence applicability.

### R2 recognized grant lanes

Human recognized scopes retain `workspace:read`, `messages:send`, `messages:read`, `messages:review`, `events:read`, `profile:edit`, `operations:read`, and add `tasks:read`, `tasks:create`, `tasks:edit`, `tasks:schedule`, `tasks:review`, `tasks:cancel`, `agents:read`, `agents:manage`, `credentials:manage`, `artifacts:read`, `artifacts:write`, `search:read`, `imports:manage`.

Native recognized scopes retain `workspace:read`, `messages:send`, `messages:read`, `messages:ack`, `events:read`, and add `tasks:read`, `tasks:create`, `tasks:edit`, `tasks:schedule`, `tasks:claim`, `tasks:execute`, `tasks:review`, `tasks:cancel`, `agents:read`, `runtimes:manage`, `artifacts:read`, `artifacts:write`, `search:read`.

Recognition is not a grant or route activation. New authority requires a strictly greater operator epoch and explicit valid grant installation. `imports:manage`, `profile:edit`, `operations:read`, `credentials:manage`, `agents:manage` and `messages:review` are human-only. No approvals actor lane is enabled. Runtime-execution operations still require the native credential plus current server-verified runtime proof; role labels do not authenticate.

## Native credential delegation ceiling

R2 local source accepts optional `human_grants[].delegable_native_scopes` in operator deployment configuration. It is an exact array of recognized native scopes, independent of the human's executable `scopes`. It accepts no wildcard, null, duplicates or human-only scopes. A human still needs current `credentials:manage`, enabled matching identity/epoch and the configured/current project ceiling. Delegation does not authorize that human to enroll a runtime, acknowledge as an agent, claim or execute native work.

Omission preserves legacy delegation of native-compatible executable human scopes; an explicit `[]` denies delegation; an explicit list replaces that fallback. Removing the field can restore broader legacy rights: use `[]` or remove `credentials:manage` to disable. No new grant is added automatically to existing config or examples. All edits are included in the existing canonical configuration digest and advancing-epoch installation rules. Current credentials/proofs are conservatively revoked across that epoch boundary. See [ADR 0008](adr/0008-r2-authority-and-history.md). This is source capability, not permission to provision or change a live installation.

## Installed task execution policy

Local issue 27 source adds optional operator-owned `workspace_policies[].execution_policy`, referencing the single ExecutionPolicy schema. Omission keeps existing installation documents valid but denies policy-dependent task creation and Ready with dependency unavailable. No retry, WIP, eligibility or replay-safe authority is inferred from omission. Duplicate eligibility tuples, replay tuples and rule IDs reject installation. The field participates in the existing canonical configuration digest and advancing-epoch rules; profile import and task PATCH cannot edit it.

Ready requires an exact nullable project/work-role tuple and at least one active eligible agent with a single coherent current native credential granting claim and execution on that project. Assignment narrows the candidate, never expands rights. Separate credentials, work-role labels and different grants cannot be unioned. Runtime presence is not required to schedule Ready; a later claim separately checks current proof, presence, WIP and lease ownership. Scheduling never clears uncertainty/exhaustion holds or resets fixed retry budget.

## Local issue 28 catalog implementation

Catalog profile lifecycle cannot rewrite deployment grants or execution-policy rules. Remap fails when a current eligibility/replay-safety rule names the source; an operator must separately review any policy change. Archive leaves rules and historical references unchanged while active-selection checks deny the archived ID. Preview never grants authority for later apply. Read [catalog semantics](customization.md#local-catalog-operation-semantics) and [local execution evidence](r2-task-plans/issue-028-execution.md). Ordinary profile imports retain omitted IDs and reject archive/reactivation bypass; duplicate labels are advisory only.


## Private recovery anchor declarations

Product `RECOVERY_ANCHOR` service bindings select only the default reader of the environment-matched private recovery-anchor Worker. `RECOVERY_ANCHOR_BINDING_ID` must also appear in the trusted release manifest's `binding_ids`; a string alone does not confer capability or prove infrastructure continuity. The [provider policy](../workers/recovery-anchor/README.md) is a closed environment/workspace/object allowlist with separate bootstrap/rotation scopes. Empty defaults deny access. Only separately authorized deployment tooling may receive named writer/bootstrap entrypoints; neither the ordinary operator gateway nor product Worker receives them or the provider namespace. Static `verify:anchor-bindings` checks source mappings, not deployed identity or freshness. No new product migration or snapshot table stores authoritative provider state.
