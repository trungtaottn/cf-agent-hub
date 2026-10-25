# Development workflow

Status: R1 source candidate · Contract revision 0.2 · Integrated/deployed acceptance pending.

R1 has executable Worker, operator, client and browser code. Start with [R1 implementation and acceptance](r1-implementation.md) and the pinned [toolchain runbook](runbooks/toolchain.md): install the lockfile, build UI assets, run generated/type/contract/Node/Workers checks, run the separate browser gate, then validate the documentation. Local checks retain their observed scope; deployment and release require their own actual evidence.

## Start from a coherent slice

Select one feature-matrix capability and read its canonical contract, security boundary, release dependency and acceptance scenarios. Write the observable outcome before changing code. For example, an atomic claim slice is complete only when two eligible clients race and one durable run wins; a button labeled Claim is insufficient.

Use an isolated branch or checkout for implementation and preserve a clean reviewable base. Keep infrastructure credentials outside tracked files. Development fixtures must use synthetic workspace, agent and artifact IDs and reserved example origins. Never point tests at a personal or production workspace by default.

## Proposed module boundaries

| Logical module | Responsibility | Forbidden shortcut |
| --- | --- | --- |
| Entry/authentication | Verify identity, bound parsing, resolve workspace | Trust arbitrary identity headers or client-supplied actor IDs |
| Domain commands | Policy, versions, state transitions, events and idempotency | Put state rules only in the UI or protocol adapter |
| Storage/repositories | Scoped records, transactions, bounded queries and schema versions | Global fallback lookup for foreign resource IDs |
| Outbox/scheduler | Due work, bounded attempts and reconciliation | In-memory-only retries or unbounded external calls |
| Artifact service | Stage/upload/commit/access/cleanup | Treat R2 write success as a committed task result |
| Native client | Envelopes, request IDs, retries and error classification | Retry a different payload under the same idempotency key |
| UI/CLI/adapters | Intent and presentation | Alternate authority or lifecycle implementation |

These are responsibilities, not existing source paths. Choose concrete directories when implementation starts and document them in that release. Shared domain rules matter more than a particular framework choice.

## Data and compatibility changes

Version application SQL migrations separately from platform Durable Object class configuration. Rehearse migrations against representative synthetic snapshots, including partially applied/restarted cases. A migration must preserve task/run attribution and invalidate authority safely when a compatible active state cannot be retained. Back up first; do not assume a code rollback reverses data changes.

API changes update OpenAPI, prose, examples, client behavior and negative tests in the same review. Additive fields are not automatically safe when clients use closed schemas. State/authorization changes require an ADR amendment and an explicit compatibility decision. Pin protocol compatibility targets rather than silently following “latest.”

External-task import needs a dry run, stable external-to-internal ID mapping, provenance, invalid-row report, idempotent retry policy and reconciliation counts. Do not import bearer tokens, memberships, live leases or approved authority from an untrusted file. Imported tasks start without an active run; any state conversion must be explicit and auditable. The import endpoint/format is a separate R2 contract, not implied by task-create.

## Review and validation

For behavior changes, first demonstrate the invariant with a meaningful failing test, then implement and rerun the relevant tests. For documentation-only changes, schema/link/fixture checks and review are normally sufficient. Expand verification only to address a concrete regression risk or required release gate.

Reviewers should trace one request from ingress through policy and transaction to external effects. Check actor/workspace binding, stale versions, expiry, replay, partial failure and redaction. A successful happy path does not prove the same checks apply through CLI/MCP/A2A. [Testing](testing.md) defines the expected evidence layers.

## Release handoff

An implementation handoff includes exact revision and toolchain, feature-matrix updates supported by evidence, known limitations, configuration reference, reproducible deployment steps, schema migration/recovery notes and a tested rollback plan. A maintainer must be able to explain what runs, which features are disabled and how to recover uncertainty without relying on an author's private environment.

Follow [CONTRIBUTING](../CONTRIBUTING.md), [documentation maintenance](docs-maintenance.md) and the [release checklist](release-checklist.md) for contribution and promotion rules.
