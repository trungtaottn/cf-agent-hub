# Bounded MCP STDIO source design

Status: Reviewed finite source design; implementation and acceptance pending.

Base: local restoration ad0f1b39a1431aa29726b5fc3b77c1a13e08118b has tree
6c1e3df81b9b2ff72bb531438085a7d860b3182f, identical to public PR141 head
bfe621c3dab2a0cab672feadd1916ec154188db9. No public commit identity is invented.

## Scope and approaches

Implement the action-independent portion of issues62–64, not their completion.
The closed manifest records17 planned names; discovery exposes16 executable
native operations. requestTaskDecision is absent from the enabled native
inventory; its reserved tool is not advertised and calls receive protocol
unknown-tool (-32602), never a fabricated domain result. No decision action,
human/admin/upload/enrollment tool, remote MCP or client certification is added.

Use pinned SDK1.32.2 and existing native client/protected provider. A handwritten
protocol engine or raw environment-secret provider would duplicate existing
contracts and is rejected. SDK source pins2025-11-25 but accepts older revisions
by default; adapter initialization must offer only2025-11-25, with normal
operations gated until initialized. Unsupported requested versions receive the
supported revision per the official lifecycle, not invented negotiation rules.

## Local replay amendment

Preparing a fresh journal entry on every call would reset replay clocks. Add an
atomic explicit-key lookup-or-record path in the existing Journal transaction
(BEGIN IMMEDIATE). Validate every bounded row; identical key, principal and
semantic request returns the original entry unchanged. Conflicts or duplicates
deny; current protected authority is checked before lookup and insertion.
No new key, replay clock, cached DTO or successful outcome is invented.

Use a separate `mcp-v1` local journal profile: application_id0x43464d4a versus
legacy0x4346484a, user_version1 and existing table shape. Old native readers must
reject before journal operations; reciprocal profile mismatch rejects without
conversion. Legacy default bytes/APIs remain unchanged. MCP entries never prune;
1000-entry/64MiB/128KiB-entry caps remain unchanged and exhaustion fails closed.
This is explicit local-store versioning, not a domain migration or new credential
lane. Prefix-only retention was rejected because older CLI binaries could prune
it. Caller keys preserve exact printable ASCII1–256 bytes; no hidden rewriting.

Production opens an existing native secrets directory and dedicated MCP journal.
An explicit local initializer creates only the MCP journal, not credentials,
proof, enrollment or domain state. Tool JSON cannot choose stores/profiles.
Manual deletion/re-provisioning retires evidence; it is not safe replay recovery.
Settled retained entries without full response data return reconciliation-needed,
not a fabricated historical response. Unknown writes retain original identity.

## Transport and custody

Reuse ProtectedCredentialProvider, createNativeClient and DurableMutations.
Reads use the native client; mutations use atomic prepareOrReuse then one explicit
dispatch. Workspace and closed native schema validation precede dispatch. Runtime
proof remains inside the existing protected dispatch seam. No automatic retries,
heartbeat, enrollment or connection-triggered domain writes.

Input buffering is capped at131072 aggregate bytes, including coalesced messages;
a legal line coalesced into an excessive chunk may be refused. At most one tool
call runs, with no unbounded call queue. Outbound messages cap at2MiB, with at
most8 pending messages/4MiB total reserved synchronously before send. Overflow
closes admission immediately. Release reservations once, including EPIPE/close.
Fixed short text summaries do not duplicate full structured output. Entire
protocol output and diagnostics must pass protected secret checks; no echoed
arguments/errors. Native responses retain canonical request correlation, page,
versions/fences and error details. Local/uncertain failures use fixed isError text,
not invented request IDs. Test the pinned SDK client's error-schema treatment.

EOF/signals stop admission, not cancel/complete domain work. Pending native work
settles under its existing finite deadline before resources close. Forced process
loss leaves retained ambiguous intent. Stdout contains protocol only.

## Evidence and ownership

First unit: additive Journal/DurableMutations profile/reuse APIs and focused real
protected-store/process tests. Second unit: isolated MCP package, closed schemas,
SDK transport, genuine protected-store launch and subprocess/client tests.
Parent owns root package/lock/runtime-runner integration. No live provider setup,
publication, issue closure or release is authorized. All17 native parity and
actual advertised client evidence remain gated on upstream decisions and later
execution. Independent review follows each exact source unit.

Primary sources: [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
[transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports),
[tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools),
[SDK1.32.2](https://github.com/modelcontextprotocol/typescript-sdk/tree/1.32.2).
