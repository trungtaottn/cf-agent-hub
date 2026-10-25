# Getting started

Status: R1 source candidate · Contract revision 0.2 · Deployed acceptance pending; no released executable.

This is the entry path for reviewing and locally verifying the R1 source candidate. There is no released executable to install. The [R1 implementation page](r1-implementation.md) identifies the implemented HTTP/client/operator surface and its local checks. The native agent [CLI reference](cli.md) and later-round routes/examples still describe future capabilities; the R1 operator recovery CLI is documented separately in the [recovery runbook](runbooks/r1-recovery.md).

## Review the baseline now

1. Read the [overview](overview.md) and select the intended release gate in the [roadmap](roadmap.md). A personal workspace can use the same contract as a future team workspace without enabling invitations.
2. Follow one task through [task lifecycle](task-lifecycle.md). Check who may schedule, claim, request a decision, submit and accept a result. Do not infer those permissions from a UI role name.
3. Read [configuration](configuration.md) and inspect the examples in `examples/config/` and `examples/profiles/`. Confirm that deployment secrets, security policy and presentation data remain separate.
4. Inspect the [OpenAPI document](../spec/openapi.json), native request fixtures and [delivery semantics](delivery-semantics.md). Pay particular attention to versions, idempotency, workspace boundaries and recoverable upload stages.
5. Use [testing](testing.md) to turn each selected capability into executable acceptance evidence. Keep its matrix status Specified until implementation exists.

The documentation validation command is described in [documentation maintenance](docs-maintenance.md). It validates project documentation assets only; it does not execute deployment acceptance.

## Prepare a first implementation

Before provisioning resources, choose a Cloudflare account/environment, a workspace ID, a stable object mapping, the verified human identity provider and an initial operator. Record the chosen toolchain and platform compatibility in a release manifest. Select workspace policy for WIP, retry budget, approval expiry, retention and allowed webhook destinations. Avoid copying fixture identifiers into a production environment without replacing and validating them.

Provision separate development and production bindings and secrets. The candidate has explicit application and operator Wrangler configurations, a SQLite-backed workspace Durable Object and private recovery R2 bindings. Start with disposable isolated resources and reviewed exact catalog/host settings. [Deployment](deployment.md) defines the resources, local runtime checks and evidence required before promotion; no production target is selected by a default test command.

## First-run acceptance journey

The first durable-work implementation should make the following journey reproducible in an isolated test workspace:

| Step | Expected observation |
| --- | --- |
| Open the workspace as an authorized human | Correct workspace identity; neutral empty state; no seeded personal activity |
| Load a valid profile and reject a prohibited field | Presentation updates; policy and membership remain unchanged |
| Create two logical agents and scoped native credentials | Tokens reveal once; stable agent IDs remain independent of token rotation |
| Enroll runtimes and create/schedule one task | Presence and task ownership are distinct; task is Ready |
| Race two eligible claims | Exactly one current run/lease exists; loser receives an explicit conflict |
| Submit committed evidence | Task enters Review; execution authority is released |
| Attempt self-acceptance, then independent acceptance | First action denied; independent reviewer moves task to Done |
| Restart and reconnect | Tasks, versions, audit and idempotency outcomes remain consistent |

A human-decision journey is added when that release gate is implemented. It must include approval of the current proposal, denial of a stale proposal and expiry without automatic execution.

## When something fails

Preserve the request ID, resource IDs and relevant versions without copying tokens. Start with [troubleshooting](troubleshooting.md) and distinguish authentication, authorization, conflict, delivery and runtime failures. Re-reading current state is safe; replaying an uncertain external action with a fresh idempotency key may not be. Operators use [operations](operations.md) and [backup and restore](backup-restore.md) for recovery.

Do not promote the deployment based only on this journey's happy path. Complete the release's isolation, concurrency, crash, recovery and secret-handling evidence in the [release checklist](release-checklist.md).
