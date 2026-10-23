# MCP adapter

Status: Design baseline · Contract revision 0.1 · Implementation pending.

The planned MCP adapter lets an externally running assistant discover and invoke CF Agent Hub coordination tools. It translates validated inputs to the native HTTP contract; it does not host a model, execute a task by itself or create a second state machine. The initial release gate is R3. No MCP server package, remote endpoint or client compatibility certification is currently provided.

## Protocol and transport boundary

This baseline chooses **MCP protocol revision 2025-11-25** as an explicit compatibility target. It is a pin, not a claim that this is the latest revision. A later revision requires a reviewed adapter contract and interoperability evidence. The pinned [transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) defines STDIO and Streamable HTTP; STDIO uses a client-launched subprocess with protocol messages on standard input/output and diagnostics on standard error.

The first planned transport is a local STDIO adapter configured with a hub origin, explicit workspace ID and a native credential supplied through protected process configuration. Runtime-bound tools also require the securely supplied runtime proof, translated to `X-Runtime-Token`; tool arguments never carry or reveal either secret. The client launches this adapter locally; CF Agent Hub never launches that client's runtime. Starting or maintaining an MCP connection does not wake an otherwise idle external agent or grant a task lease.

| Boundary | Responsibility |
| --- | --- |
| Assistant/MCP client | Choose tool, present arguments, preserve mutation identity, surface failures |
| Local adapter | Negotiate the pinned protocol, validate input, translate envelopes, avoid leaking credentials |
| Native HTTP entry | Authenticate workspace-scoped credential and enforce payload/egress boundaries |
| Workspace domain service | Recheck actor/grant/state, transact command/event/outbox/outcome |
| External runtime | Execute claimed work in its own environment and reconcile external effects |

The adapter is not an unrestricted gateway to arbitrary downstream MCP servers. There is no server registry, browser login proxy, shell execution tool or dynamic tool URL in this contract.

## Planned tool subset

Tool inputs use the corresponding OpenAPI request fields, plus explicit `workspace_id` and path resource IDs. Mutations also require `idempotency_key`, translated to the HTTP header. Read tools accept the native cursor/limit fields where relevant. Tools must not accept an arbitrary URL, actor identity, grant or task state override.

| Planned MCP tool | Native operation ID | Intended behavior |
| --- | --- | --- |
| `hub_workspace_get` | `getWorkspace` | Inspect current context and effective permissions |
| `hub_agents_list` | `listAgents` | Discover visible durable agent identities |
| `hub_tasks_list`, `hub_task_get` | `listTasks`, `getTask` | Read bounded work and current task version |
| `hub_task_create` | `createTask` | Capture a Backlog task |
| `hub_task_claim` | `claimTask` | Claim with current version and registered runtime |
| `hub_run_get`, `hub_run_heartbeat` | `getRun`, `heartbeatRun` | Inspect/renew the current run |
| `hub_task_request_decision` | `requestTaskDecision` | Save checkpoint/proposal and release lease |
| `hub_task_submit_result` | `submitTaskResult` | Submit committed evidence to Review |
| `hub_task_fail` | `failTask` | End failed attempt under retry policy |
| `hub_inbox_get`, `hub_thread_get` | `getInbox`, `getThread` | Page recipient messages or authorized history |
| `hub_message_send`, `hub_messages_ack` | `createMessage`, `ackMessages` | Enqueue and acknowledge messages separately |
| `hub_artifact_get` | `getArtifact` | Inspect authorized metadata |
| `hub_search` | `searchWorkspace` | Search only readable native resources |

The initial adapter omits binary artifact upload, agent/credential administration, human decisions and result acceptance. Runtimes upload artifacts and register presence through the native API/CLI. An independent reviewer uses its separately authorized review surface. Omitting a tool does not remove the corresponding domain guard: direct HTTP requests still enforce the same policy.

The chosen MCP [tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) provides tool discovery and structured outputs. The adapter must return a short human-readable text summary plus the complete native JSON envelope in `structuredContent`, with an output schema. A domain failure is a tool result with `isError: true` and the native error envelope. Malformed protocol messages or unknown tool names use protocol-level errors. Tool annotations describe intent; they are not authorization or a guarantee that a client displays confirmation.

## Credentials and human decisions

The pinned [authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) distinguishes environment-provided STDIO credentials from HTTP authorization and requires audience-specific token validation for its HTTP authorization flow. This design uses the native credential only for adapter-to-hub HTTP calls. It never presents that token as a human browser session or as a token for an unrelated MCP audience.

No `hub_approval_approve` or `hub_approval_reject` tool is planned. Requesting a decision returns the immutable approval context and exact input-artifact digest for a human to inspect in an authorized surface. Tool text saying “the user approved” cannot substitute for a verified human identity, current assignment and matching proposal version. The adapter must not store native credentials in a browser or print them to protocol output, errors or diagnostics.

A remote Streamable HTTP adapter is a separate future security project. Before exposure it requires explicit origin validation, protected-resource and authorization-server discovery, approved client onboarding, audience/resource binding, and token validation appropriate to the chosen protocol revision. Native HTTP bearer support does not establish that OAuth exists. Until the relevant contracts and interoperability checks pass, documentation must not advertise a remote MCP URL or an OAuth-ready client configuration.

## Retry behavior and acceptance

Clients must preserve `idempotency_key` when a tool response is lost. A new key is a new intent, not a network retry. Replayed claims may describe a run that has since expired; read current state before execution. A connection drop never means cancel, submit or complete. A notification delivered through another channel remains at least once and does not imply that the MCP host will schedule a model turn.

Required evidence includes initialization/version refusal, tool input/output schema validation, bounded pagination, lost-response replay, secret redaction, cross-workspace denial, run fencing and absence of human-only tools. Test each advertised client configuration against the built adapter before describing it as verified. The [feature matrix](feature-matrix.md) owns capability status; [delivery semantics](delivery-semantics.md) owns ambiguous outcomes and recovery.
