# Implementation roadmap

Status: R1/R2 source integrated on dev · Contract revision 0.2 · Isolated release acceptance pending.

The roadmap is organized by verifiable release gates, not dates. Each gate builds on the previous gate's trust and persistence rules. The [feature matrix](feature-matrix.md) tracks individual capability status; this page explains ordering and deliverables. There is no runtime release in this package.

R1 source and local verification are tracked in [R1 implementation and acceptance](r1-implementation.md). Its deployed identity/recovery, dependency and final evidence gates remain open. The owner authorized R2 MVP development and subsequently merged its reviewed source stack. The [dated R2 integration handoff](r2-source-integration-2026-10-31.md) records the exact revision and source checks; formal integrated acceptance remains after R4. This does not silently authorize R3 or erase its issue-specific prerequisites.

## R1 — Neutral foundation and reliable relay

Build the validated deployment catalog, verified human ingress, operator-provisioned static participant grants, neutral profile and read interfaces. Implement durable message acceptance, bounded inbox/thread reads, recipient ACK and a persisted notification outbox. Provide real health/readiness and correlated redacted audit. Default projects/work roles remain empty; demonstration content is opt-in.

The gate requires isolated development/deployment configuration, no embedded credentials or personal content, cross-workspace denial for every exposed R1 resource, lost-response replay, restart-safe retry budgeting and truthful empty/stale/error UI. A successful message delivery must never be described as task completion. Record the toolchain, schemas and runbook evidence before exposing a release.

## R2 — Multi-agent durable work

Add the dynamic agent registry, human-managed opaque credentials, external runtime enrollment, durable tasks/runs and native HTTP/CLI operations. Implement atomic claims, WIP, leases/fences, cancellation, bounded retry, result submission and independent acceptance. Add the Kanban projection, authorized search, committed artifacts and external-task import with provenance and reconciliation.

This gate requires concurrency and crash tests, a two-agent independent review journey, two-workspace denial tests across all new surfaces, bounded payloads and tested restoration of SQL metadata plus artifact bytes. Native credentials must reveal once, store only verification material and revoke without changing agent identity. Import must not create active execution authority from an untrusted record.

## R3 — Human decisions and MCP

Add composition flows, checkpoints, versioned decision proposals and human-only approval/rejection. Waiting releases execution authority; approval returns work to Ready for a fresh claim. Build the initial MCP STDIO adapter over the existing native client/domain contract, with an exact protocol target and explicit tool-level grant mapping.

The gate requires stale approval denial, cancellation/revocation after approval, expiry without execution, duplicate form submission handling and MCP/native parity for authorization and errors. A connected MCP client must not be marketed as a continuously running agent unless a separate runtime scheduler exists and is documented.

## R4 — Teams and extension contracts

Add recipient-bound invitations and team memberships within existing workspaces; finalize last-administrator recovery and session revocation. Evaluate remote MCP authorization, a version-pinned A2A subset and real external connectors. Extend retention, quotas, operational dashboards and load-driven tuning only after measurement.

Each extension needs a separate acceptance record. A provider logo or token field is not a live integration. An A2A route name is not standards conformance. An invitation email alone is not proof of secure membership issuance. Automatic SaaS tenant creation, billing and a global organization directory remain separate future proposals.

## Implementation slices

| Slice | Deliverable | Review boundary |
| --- | --- | --- |
| Contracts and fixtures | This baseline, closed schemas, examples and validation | Documentation consistency only |
| Identity and storage | Workspace routing, authenticated actor, persistence transactions | Isolation and data ownership |
| Message reliability | Acceptance, outbox, ACK and retries | Lost responses, duplicate delivery and restarts |
| Task ownership | State machine, claim/lease/fence, WIP and versions | Concurrent owners and stale commands |
| Evidence and review | Artifact commit, result submission, independent acceptance | Integrity and attribution |
| Decisions | Checkpoint, versioned proposal, human decision | Scope/version binding and expiry |
| Clients and UI | Shared native client, CLI, board and adapters | Semantic parity and truthful presentation |
| Operations | Recovery, retention, observability and publication | Reproducible operator evidence |

## Deferral and scope control

If a required contract is unresolved, mark the affected capability unavailable and record the decision needed. Do not ship a fallback that bypasses grants, accepts arbitrary state patches, simulates a live connector or conflates ACK with Done. Any revised scope must update the feature matrix, OpenAPI where applicable, and operator documentation together.

Each gate ends with a runnable acceptance report and a maintainer review. No calendar estimate or throughput target is asserted here. Estimates become credible after the first implementation slice provides actual complexity, dependency and measurement evidence.

## Implementation plans

The [round-by-round implementation plans](superpowers/plans/README.md) define concrete work, dependencies, tests and review gates. They are planning artifacts; actual runtime feature status remains in the feature matrix.
