# Integrations

Status: Design baseline · Contract revision 0.1 · Implementation pending.

CF Agent Hub plans an HTTP coordination core, a CLI, an MCP adapter and a future A2A adapter. No SDK, client certification, live connector or automatic external execution is currently claimed. [Feature matrix](feature-matrix.md) owns capability status; [roadmap](roadmap.md) owns release sequencing.

## Integration boundary

An external runtime receives or discovers work, authenticates with a workspace-scoped grant, claims an eligible task, performs work in its own environment and reports progress/results. Runtime enrollment reveals a one-time `runtime_token`, bound to the workspace, agent, runtime and issuing native credential. Claim, execution, run heartbeat, runtime heartbeat and run-bound artifact writes must send native bearer authentication plus `X-Runtime-Token`; knowing a runtime ID is insufficient. Keep proof material in secure runtime custody, out of logs and exports. Enrollment replay returns no token; a lost first reveal requires fresh enrollment. Issuing-credential revocation, expiry or rotation, and runtime expiry, invalidate it; rotation requires fresh enrollment and a new claim after old run authority safely ends. The hub coordinates leases, fences, messages, decisions and artifacts. It neither starts a model session on connection nor hosts the runtime's process. A displayed participant can be static configuration without a live process behind it; runtime presence is advisory and distinct from agent identity.

All adapters must call the same domain commands and preserve principal, workspace, expected version, idempotency identity and run fence. Adapters must not translate a failed authorization check into success or bypass a human-only action. See [HTTP API](http-api.md), [agents](agents.md) and [security model](security-model.md).

| Surface | Planned purpose | Required proof before support claim |
|---|---|---|
| Native HTTP | Canonical coordination contract | Auth, isolation, error, retry and concurrency tests |
| CLI | Human/runtime access to native HTTP | Credential custody, exit/error semantics and interrupted-request recovery |
| MCP STDIO | Local adapter forwarding to native API | Tool mapping, exact protocol revision and client-specific tests |
| Remote MCP HTTP | Optional authenticated remote adapter | Resource audience, authorization discovery and supported client flow |
| A2A | Future inter-agent adapter | Pinned protocol release, explicit supported subset and task mapping |
| External connectors | Future bounded import/delivery integrations | Real provider object IDs, permission tests and reconciliation receipts |

## MCP

STDIO is the first planned MCP transport. The adapter runs under the user's local account and obtains its native API credential from explicit secure local configuration. That local process can read credentials available to it; using STDIO does not make an untrusted binary safe. Do not print secrets to standard output, which belongs to the protocol. Installation, supported clients and launch commands require implementation evidence before publication as runnable onboarding.

Remote HTTP requires a deliberate protocol authorization implementation and audience checks. The [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) describes its authorization requirements; the presence of a native opaque bearer lane or a browser Access session does not establish that flow. This link is a protocol reference, not a declaration of implementation or broad compliance. Pin and test the selected revision in [MCP API](mcp-api.md). Do not forward an upstream client's token to arbitrary downstream services.

Connecting a client does not wake an external runtime, enroll an agent automatically, accept an approval or finish a task. A tool may expose only actions already allowed by the caller's native grant. Human-only decision methods must retain their actor restriction.

## A2A

A2A is reserved for a later release gate. Before enabling it, pin the exact upstream release, list supported discovery/authentication/streaming/cancellation behavior and publish the native task mapping in [A2A API](a2a-api.md). Upstream material is available from the [A2A project](https://a2a-protocol.org/); no particular current release is implicitly adopted here.

Remote task status must not overwrite native task state blindly. Incoming completion proposals must still enter native review; cancellation must invalidate the correct run; foreign identifiers require an explicit workspace-scoped mapping. Persist remote task/message identity and provenance so reconnects cannot create duplicate local work. Define how unsupported states and partial streams recover before claiming interoperability.

## Connectors and external task import

A connector is not live because a UI shows its logo or a configuration field accepts a URL. A supported connector must document granted account scope, actual provider resource IDs, source timestamps or versions, freshness, deletion policy, pagination and rate-limit recovery. Verify denied resources as well as allowed ones. External access tokens remain separate from workspace profile/preset exports.

Task import uses generic external records with source identity, source record ID, source version/time, import batch and reconciliation status. Dry-run validation must expose unknown fields, conflicting IDs and policy violations before writes. A cutover must identify whether the hub or the external system owns each field; simultaneous writers require an explicit conflict policy. Retries must use stable source mappings and idempotency keys. Never interpret missing records from a partial or failed page as deletion. Bidirectional or Google Drive sync is not part of the baseline support claim.

## Delivery and failure behavior

Notifications are hints backed by durable events; clients reconcile through authorized reads after reconnecting or finding a cursor gap. Receiving HTTP success does not mean the runtime has acknowledged or executed work. Preserve event identities, deduplicate retries and use the budgets in [limits](limits.md). A callback failure must not roll back an already committed task command. A runtime failure with `outcome_unknown` must enter a Backlog hold instead of automatic retry: Ready, requeue and claim stay blocked. Reconcile external effects before creating separately reviewed replacement work; the baseline provides no implicit hold-clear action. Adapters also must not use a generic PATCH to change approved Ready intent under an existing decision. A revoked grant or disabled destination must stop future sends.

Before enabling any integration, verify workspace isolation, safe destination handling, timeout recovery, duplicate delivery, revoked credentials and incomplete artifact upload. Keep connector capability flags disabled until these tests and a named maintenance owner exist. Unsupported client behavior must be reported precisely; do not widen authentication or remove review requirements to make a demo appear connected.
