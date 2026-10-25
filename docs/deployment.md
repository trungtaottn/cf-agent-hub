# Deployment

Status: R1 implementation candidate · Contract revision 0.2 · Isolated deployment acceptance pending; no released artifact.

R1 includes application and operator Workers, authenticated messages and settings, a browser dashboard, logical SQL recovery and executable local verification. The candidate still requires an authorized isolated deployment, real identity-provider and operator journeys, a clean reviewed toolchain inventory and the release evidence gate before promotion. Local fixture results do not establish production readiness. See [R1 implementation and acceptance](r1-implementation.md) and the [runtime evidence contract](runtime-evidence.md).

## Deployment boundary and ownership

R1 uses a Cloudflare Worker for ingress, authentication and request validation, one SQLite-backed Durable Object per workspace, and private R2 storage for bounded recovery chunks. A separate operator Worker authenticates installation and recovery operations. Human browsers and native clients use the public application boundary. R2 artifact APIs, tasks and runtime claims remain unavailable; agent execution environments run outside the hub.

| Resource | Operator responsibility | Required evidence before use |
|---|---|---|
| Worker and public route | Account, environment, compatibility date, exact release version and permitted hostnames | Release receipt and public-edge authentication checks |
| Workspace Durable Object namespace | SQLite storage, class lifecycle configuration, immutable workspace-to-object mapping | Mapping review, schema compatibility and persistence after restart |
| R2 bucket | Private recovery access, scoped bindings, retention and recovery copy policy | Actual operator capture/read/write/restore; R1 does not claim an artifact API round trip |
| Human identity provider | Trusted issuer, audience, keys, callback settings and initial memberships | Verified identity and rejected invalid assertions |
| Native credentials | Authorized issuance, workspace grant policy and revocation | One-time reveal, scoped request and next-request revocation denial |
| Native client | Client version, static credential custody and local effect deduplication | Authorized messaging, own inbox/ACK and original-intent replay; runtime claims are R2 |

Separate test and production accounts or resource sets are required. An environment must not silently inherit production namespaces, bucket bindings, credentials or callback destinations. Workspace catalogs are operator-provisioned configuration; editing a profile cannot select a different Durable Object or create a new tenant. Teams can later manage membership in existing workspaces without introducing automatic tenant provisioning.

## Preflight

Record the desired public hostname, all alternate routes, Worker version, namespace identity, bucket identity, workspace map digest, policy revision, schema version and secret key identifiers. Record identifiers rather than secret values. Inspect any existing route and resource ownership before creating or replacing it.

Pin the deployment toolchain and choose its supported Durable Object provisioning mode. Cloudflare's current [class lifecycle documentation](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/) describes declarative `exports` and the legacy `migrations` flow; a Worker cannot combine both. The release must document the actual selected mechanism. Class creation, rename, transfer and deletion are platform operations, distinct from application SQL schema changes. Deleting a class must never serve as a schema repair strategy.

Review [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/) alongside [product limits](limits.md). No supported throughput or account-plan assumption is established by this baseline. Check actual account entitlements and quotas in the target environment. Keep deployment/auth settings separate from editable workspace profiles as specified in [configuration](configuration.md).

## First deployment sequence

1. Provision isolated resources with reviewed account permissions. Keep production ingress disabled until identity and storage checks pass.
2. Install secret material through the platform's [secret mechanism](https://developers.cloudflare.com/workers/configuration/secrets/), not workspace JSON, source control or ordinary profile fields. Verification hashes for opaque native credentials belong in workspace state; signing/encryption key material belongs in separate secret storage.
3. Provision the immutable workspace catalog and initial authorized human membership. Require an auditable bootstrap process, then disable bootstrap access. An unknown principal must not become an administrator merely because the membership table is empty.
4. Deploy the exact reviewed Worker version and its compatible Durable Object class/schema configuration. Apply application migrations with an exclusive, version-checked transaction and an explicit recovery plan. A migration failure must block writes for the affected workspace.
5. Exercise authenticated storage and policy checks in a disposable workspace. Recreate the object instance or trigger a controlled restart and confirm committed state survives. Cloudflare distinguishes [durable storage from in-memory state](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/); process memory is not a recovery record.
6. Validate the public route with both human and native credential lanes. Check every alternate hostname and preview exposure against the same intended boundary; remove unnecessary exposure.
7. Promote only after the [release checklist](release-checklist.md) has actual evidence for the intended release gate. Enable external delivery last, with a controlled receiver.

Application routes and request examples are owned by the [HTTP contract](http-api.md). R1 adds minimal public liveness and a separately authenticated operator recovery gateway; neither is a product admin bypass.

## Readiness and release receipt

`GET /health/live` returns the closed JSON value `{"status":"alive"}` and makes no dependency claim. `GET /v2/workspaces/{workspace_id}/readiness` and `/operations` require a current human session with unrestricted `operations:read`; native bearer credentials do not grant diagnostic access. These GETs inspect persisted evidence and never run probes or repair alarms. A missing or expired probe remains unknown. The operator probe performs an actual SQL write/read, verifies forced rollback and checks the real alarm before publishing its receipt.

Readiness checks the exact compiled migration sequence, current configuration/grants, required keys, recovery binding, admission barrier, fresh matching storage/scheduler probes and persisted scheduler/delivery state. A matching probe expires after five minutes. A delivery failure degrades delivery while a valid storage probe remains healthy. R1 always reports artifact APIs as unavailable; a configured private recovery binding does not prove an artifact round trip.

Run the local candidate gates with the exact Node/npm versions in the [toolchain runbook](runbooks/toolchain.md):

```sh
npm ci
npm run build:ui
npm run check
npm run check:runtime
npm run test:ui
python -B scripts/validate_docs.py
```

After an authorized isolated deployment and an actual operator probe, read protected readiness with a user-owned 0600 config and credential file outside the checkout:

```sh
node scripts/verify-readiness.mjs --input /secure/readiness.json 3</secure/readiness-credentials.json
```

The closed config binds `origin`, `environment_id`, `workspace_id`, `expected_actor_id`, `expected_config_epoch`, `expected_schema_version` and `credential_fd` (for example `"3"`). The descriptor contains `session_cookie` and, when the public application additionally requires Access, `access_client_id` and `access_client_secret`. The tool uses exact-origin HTTPS, rejects redirects/challenges and bounds response size/time. Its final operations read binds the fresh probe to the expected current schema and epoch. This result proves authenticated readiness only; it does not prove a provider login journey or deployed artifact provenance.

Use disposable messages and restricted principals for the R1 deployed ingress matrix. Retain actual provider signature/issuer/audience rejection, allowed and forbidden human login, origin/CSRF denial, static bearer access, acknowledged revocation followed by next-request denial, and alternate-host exposure results. A supplied cookie is not evidence of how the provider authenticated it. HTTP denial alone does not prove unchanged SQL; the actual Workers matrix records SQL effects separately. Keep these results bound to the reviewed candidate/build/deployment. Task claims, runtime tokens, review acceptance and artifact cleanup belong to later release gates.

## Upgrade and failed deployment

Prefer additive schema evolution: deploy compatible readers before new writes and remove old fields only after rollback compatibility ends. Document whether two Worker versions can safely operate on the same workspace schema and outbox format. Do not assume gradual traffic promotion proves Durable Object version mixing safe; consult the platform's [Durable Object deployment guidance](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/) and validate the selected strategy.

Before a risky migration, pause mutations and delivery, capture a coherent recovery set using [backup and restore](backup-restore.md), and record the last known good release. If the candidate fails, keep new traffic gated, determine whether the prior code accepts the current schema and data, then either redeploy compatible code or restore into an isolated recovery environment. Worker [rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) does not constitute a coordinated restoration of workspace data, artifacts, identity-provider configuration or external effects. A first-install failure has no known good predecessor; leave ingress disabled and retain diagnostic evidence.

Resume service only after the restored or rolled-back candidate passes readiness and reconciliation. Never reset a namespace, remove a bucket or weaken authentication merely to obtain a successful deployment indicator.

## R1 static authority and protected recovery

The R1 deployment contract is revision 0.2. Review the closed [deployment configuration](../spec/deployment-config.schema.json), exact catalog, human grants, static credential references, workspace policies, OIDC issuer/client/redirects and destination allowlist before admitting traffic. A static participant label alone gives no authority. A valid identity without an installed grant is denied even on first install.

Use the operator helper's `create`, `assemble` and `install` subcommands with a protected authenticated [bootstrap bundle](../spec/r1-bootstrap.schema.json). `create` generates exactly one new 32-byte token to a user-selected protected descriptor and writes the hash bundle to a named exclusive 0600 file outside the repository. `assemble` performs config-only epoch updates or explicit retirement without generating a token. Updates require `--prior-config` and authenticated `--prior-bundle`; only `--initialize` against empty authority omits them. Verify prior signature, config digest and epoch, immutable actor/hash bindings, retained hashes and retired tombstones. Every new config epoch is strictly greater than installed epoch; same-epoch digest mismatch conflicts. The combined installation digest covers config, current hashes and tombstones. Installation is via the separate authenticated operator gateway and binding-only reconciliation, never a public product admin route. Record operator receipt and `configuration.installed` event; read installed authority on each command.

Protect the OIDC client secret, bootstrap authentication key, notification signing keys, recovery integrity key, recovery encryption key and Access service-token material separately. The R1 OIDC profile supports RS256, exact HTTPS issuer and callback URI per workspace; unsupported providers fail admission. Rotation installs a fresh credential ID at a greater epoch, verifies scope, then disables the predecessor at another epoch. Lost reveal is replaced and retired, never retrieved. Revocation is effective across all affected workspace authorities only after their new epochs are acknowledged. Old Worker startup cannot reinstall a removed grant.

The [R1 recovery runbook](runbooks/r1-recovery.md) describes the separate operator Worker, bounded logical SQL capture and protected binary transport. A probe is an actual transactional write/rollback and scheduling check, recorded only by that gateway. Readiness and queue diagnostics require human `operations:read`. Recovery reapplies the latest separately authenticated authority ledger, invalidates sessions, resolves uncertain delivery and proves exclusive authority before resume. A failed restore, missing operator access or unretired source leaves admission disabled. Actual deployed recovery evidence is still required before R1 verification.

Preflight must review and install the closed OIDC authorization, token and JWKS endpoint pins alongside the issuer. Reject discovery mismatch before fetching token/JWKS or constructing an authorization URL; refuse server-side redirects. The pin strings are canonical HTTPS exact host/path values, with no query, fragment, credentials, explicit port, IP literal or local/private/metadata target. The browser's ordinary provider login redirects remain allowed after starting from the pinned authorization URL.
