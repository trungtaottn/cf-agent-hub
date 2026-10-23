# ADR 0001: Workspace coordination authority

Status: Accepted design direction · Contract revision 0.1 · Implementation pending.

## Context

Task claims, agent eligibility, WIP limits, decisions and audit must agree within a workspace. Splitting those checks across unrelated storage services would add distributed coordination before the product has evidence that it needs it. External agents also have heterogeneous execution environments that the hub should not need to host.

## Decision

Use a Worker entry for identity and routing, one SQLite-backed Durable Object per operator-provisioned workspace for domain state, and R2 for artifact bytes. Run code and model tools in external runtimes. The workspace command service validates membership/grants and commits state, event, outbox and idempotency outcome in one local transaction. R2 and external effects use explicit staged/recoverable workflows.

Workspace IDs map to stable object identities through deployment configuration. Profile changes and team invitations cannot change that mapping. No automatic tenant provisioning or global workspace directory is included in the baseline.

## Alternatives considered

A shared global database can simplify aggregate reporting but broadens isolation risk and makes cross-workspace coordination attractive by accident. An object per task reduces one object's load but complicates workspace WIP and policy transactions. Hosting execution within the hub adds sandbox lifecycle, untrusted code isolation and capacity management that are separate from coordinating work.

## Consequences and review trigger

Workspace-local invariants are easier to reason about, while a busy workspace can become a hot coordination boundary. Retention and measured capacity matter. Cross-workspace queries and transactions are deliberately absent. Revisit partitioning when recorded workloads show a bottleneck, with an explicit plan to preserve claim and WIP atomicity.

Acceptance requires isolation, claim contention, restart and artifact reconciliation evidence in [testing](../testing.md). See [architecture](../system-architecture.md) for the authoritative boundary map.
