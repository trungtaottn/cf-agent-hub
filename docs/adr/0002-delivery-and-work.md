# ADR 0002: Delivery and work have separate lifecycles

Status: Accepted design direction · Contract revision 0.1 · Implementation pending.

## Context

Networks lose responses, receivers accept notifications before processing them, and runtimes can stop between an external action and a result report. Treating any single transport event as completed work produces false success and unsafe retries.

## Decision

Persist distinct records for command acceptance, notification attempts, recipient ACK, task state, run attempts and result acceptance. Commit the domain mutation and its outbox/idempotency outcome together. Deliver notifications at least once with a durable bounded retry schedule. A task reaches Done only through independent authorized acceptance of a submitted result.

Clients retry uncertain commands with the same idempotency key and payload. External runtimes use durable operation identities or reconciliation for external side effects. The hub does not promise exactly-once execution across external systems.

## Alternatives considered

Completing a task on receiver 2xx or ACK is simple but cannot show whether execution or review occurred. Synchronous end-to-end delivery ties request availability to runtime latency and still leaves an uncertain outcome after a dropped connection. A distributed transaction across SQL, object storage and arbitrary tools is not an available primitive in this design.

## Consequences and evidence

The model stores more state and needs a clear UI, but users can distinguish failed delivery from failed work and pending review. Operators can recover dead letters without inventing task outcomes. Artifact uploads have a staged lifecycle and bounded orphan recovery.

Lost-response, duplicate-delivery, partial-upload and independent-review scenarios must pass before release. [Delivery semantics](../delivery-semantics.md), [task lifecycle](../task-lifecycle.md) and [operations](../operations.md) define the resulting contracts.
