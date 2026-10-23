# Deployment

Status: Design baseline · Contract revision 0.1 · Implementation pending.

This is the proposed deployment and promotion runbook for CF Agent Hub, dated 2026-10-23. It defines operator acceptance requirements. It is not an installation recipe for a released service: no application package, working deployment script, or verified production environment is claimed. Release-specific executable instructions must accompany implementation before promotion.

## Deployment boundary and ownership

The planned topology is a Cloudflare Worker for ingress, authentication and request validation; one SQLite-backed Durable Object per workspace for authoritative coordination; and private R2 storage for artifact bytes. Human browsers and external agent runtimes call the same domain services through authenticated entry points. Agent processes, model calls and execution environments run outside the hub. No executor, shell or container service is provisioned by this design.

| Resource | Operator responsibility | Required evidence before use |
|---|---|---|
| Worker and public route | Account, environment, compatibility date, exact release version and permitted hostnames | Release receipt and public-edge authentication checks |
| Workspace Durable Object namespace | SQLite storage, class lifecycle configuration, immutable workspace-to-object mapping | Mapping review, schema compatibility and persistence after restart |
| R2 bucket | Private access, scoped bindings, retention and recovery copy policy | Authorized round trip and denied anonymous/cross-workspace reads |
| Human identity provider | Trusted issuer, audience, keys, callback settings and initial memberships | Verified identity and rejected invalid assertions |
| Native credentials | Authorized issuance, workspace grant policy and revocation | One-time reveal, scoped request and next-request revocation denial |
| External runtime | Client version, credential custody and local effect deduplication | Claim/lease/fence and interrupted-request recovery tests |

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

Planned application routes and request examples are owned by the [HTTP contract](http-api.md). This runbook does not introduce separate health, admin or bypass endpoints.

## Readiness and release receipt

A reachable Worker is only evidence of ingress liveness. Readiness must separately show valid bindings, compatible workspace schema, correct catalog mapping, secret-key availability for enabled features, successful transactional write/read, artifact round trip, and durable scheduling recovery. A dependency outage may degrade delivery while the task engine remains operational; report that distinction without marking every feature ready.

Use a disposable synthetic task and restricted principals to prove atomic claim, stale-fence denial, review submission and independent acceptance. Confirm bearer authentication without the matching `X-Runtime-Token` cannot claim or execute work; enrollment must reveal `runtime_token` once and persist only its bound verification hash. Parent-credential revocation must invalidate runtime proof, and credential rotation must require fresh enrollment and a new claim after old authority ends safely. Verify `outcome_unknown` creates a Backlog hold blocking Ready/requeue/claim and approved Ready intent cannot be patched under its existing decision. Include a rejected cross-workspace request, rejected CSRF mutation, credential revocation, and orphan upload cleanup. Do not use real customer tasks as a deployment probe. Store sanitized request IDs and outcomes with the exact deployed versions and bindings.

## Upgrade and failed deployment

Prefer additive schema evolution: deploy compatible readers before new writes and remove old fields only after rollback compatibility ends. Document whether two Worker versions can safely operate on the same workspace schema and outbox format. Do not assume gradual traffic promotion proves Durable Object version mixing safe; consult the platform's [Durable Object deployment guidance](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/) and validate the selected strategy.

Before a risky migration, pause mutations and delivery, capture a coherent recovery set using [backup and restore](backup-restore.md), and record the last known good release. If the candidate fails, keep new traffic gated, determine whether the prior code accepts the current schema and data, then either redeploy compatible code or restore into an isolated recovery environment. Worker [rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) does not constitute a coordinated restoration of workspace data, artifacts, identity-provider configuration or external effects. A first-install failure has no known good predecessor; leave ingress disabled and retain diagnostic evidence.

Resume service only after the restored or rolled-back candidate passes readiness and reconciliation. Never reset a namespace, remove a bucket or weaken authentication merely to obtain a successful deployment indicator.
