# A2A adapter design

Status: Design baseline · Contract revision 0.1 · Implementation pending.

A2A is a future R4 adapter for exchanging work with external agent systems. The hub remains the authority for its own tasks, runs, decisions and artifacts. A remote agent remains responsible for execution in its own environment. This page defines a proposed compatibility boundary, not an available endpoint, completed implementation or broad standards-conformance claim.

## Version and initial subset

The proposed adapter target is the official **A2A specification v1.0.1**, with protocol version **`1.0`** on the wire. The [versioned specification](https://a2a-protocol.org/v1.0.1/specification/) distinguishes specification patch releases from negotiated major/minor protocol versions and defines Agent Cards, tasks, messages, artifacts and multiple bindings. This is a deliberately pinned target; a release must verify its exact upstream schemas and selected binding before exposure.

The initial proposal is a JSON-RPC binding limited to discovery, asynchronous work submission, task inspection and authorized cancellation. The specification names the relevant operations `SendMessage`, `GetTask`, `ListTasks` and `CancelTask`. This document does not reserve native HTTP paths for them: their deployment endpoint, Agent Card and public adapter schemas require a separate implementation review. The [OpenAPI contract](../spec/openapi.json) describes native HTTP only.

| Capability | Planned treatment |
| --- | --- |
| Agent discovery | Describe only enabled adapter skills and authenticated interface requirements; no credentials or private roster |
| Send work | Map accepted, validated work to a durable native Backlog task and correlation record |
| Inspect/list tasks | Return caller-visible adapter-owned task projections with bounded history |
| Cancel | Apply the native cancellation policy; cannot undo completed external side effects |
| Streaming/subscriptions | Deferred; do not advertise before reconnect and retention behavior are verified |
| Push notification registration | Deferred; no arbitrary callback URL accepted in the initial subset |
| Binary/file exchange | Resolve through authorized artifact handling; no unrestricted remote URL fetching |
| Human decision | Remains a verified human-only native command; an A2A message cannot approve |

These choices are CF Agent Hub design decisions. They are not assertions that implementing this subset alone meets every A2A requirement. Before release, any required operation outside the proposed subset must either be implemented or the advertised compatibility scope narrowed and explained.

## Identity and correlation

The adapter must authenticate the remote caller and map it to a specific workspace-scoped agent grant. A peer-supplied agent name, Agent Card, tenant value, task ID or context ID cannot grant membership. Operator-provisioned routing selects the permitted workspace; each native command rechecks the mapping. Never forward an incoming credential to a third-party service or treat a protocol message's role field as a verified human identity.

Persist a correlation record containing workspace, authenticated peer principal, adapter protocol version, peer context/task/message identifiers, native task/thread identifiers and an immutable request fingerprint. Scope peer identifiers to that principal and workspace. Reject a repeated message identity with different content; do not let identical IDs from distinct peers collide or expose another peer's work. A peer-provided context must not widen access to an existing private thread.

An accepted work submission creates Backlog, not an execution lease. An eligible registered runtime must claim through the native domain service using both native bearer and runtime proof. The adapter must not fabricate a heartbeat merely because a peer connection is alive. If a peer executes outside that runtime contract, its results are untrusted incoming evidence and require an explicitly designed ingestion/review path; they cannot be reported as a valid native run result.

## Task-state projection

A2A and hub task states are not interchangeable. The following mapping is a proposed adapter projection; uppercase values use the target specification's enum naming. It preserves the hub's independent acceptance requirement.

| Hub state | Proposed A2A projection | Additional explanation |
| --- | --- | --- |
| Backlog / Ready | `TASK_STATE_SUBMITTED` | Accepted work may still be unscheduled or held; expose sanitized reason |
| Doing | `TASK_STATE_WORKING` | Native active run remains authoritative |
| Waiting | `TASK_STATE_INPUT_REQUIRED` | Human decision needed; no execution lease remains |
| Review | `TASK_STATE_WORKING` | Result exists but independent acceptance is pending |
| Done | `TASK_STATE_COMPLETED` | Only after authorized independent native acceptance |
| Cancelled | `TASK_STATE_CANCELED` | Native cancellation recorded; external effect rollback is not implied |

Retry exhaustion and uncertain outcome remain Backlog holds, with an explicit status explanation. They do not become completed work or trigger a fresh remote attempt. Do not emit a terminal A2A failure while the same mapped hub task could later become eligible again. A future terminal-failure policy requires its own state mapping review. Approval expiry stays Waiting. A peer's text saying “approved” cannot change it.

## Delivery, errors and release evidence

The adapter must translate native conflicts and authorization failures to the chosen binding's error model without hiding correlation IDs or disclosing private state. Lost responses are reconciled through the persisted correlation record. Polling returns the latest permitted projection; it does not imply notification delivery or exactly-once execution. If streaming or push is added later, specify event identity, reconnect gaps, duplicate handling, destination authorization and retry budget before advertising those capabilities.

Acceptance evidence must include schema checks against the pinned release, actual cross-client requests for every advertised operation, version mismatch handling, peer-ID collision isolation, duplicate submission, uncertain response recovery, cancellation races and the Waiting/Review projections. Verify a remote client cannot decide a human approval or self-accept a result. The [feature matrix](feature-matrix.md) records status; [integrations](integrations.md) describes connector boundaries, and [delivery semantics](delivery-semantics.md) owns the failure model.
