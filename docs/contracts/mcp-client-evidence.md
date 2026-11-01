# MCP source evidence and launch boundary

Status: Partial local source evidence; independent source review pending; no full17-tool native parity, deployed acceptance or release.

## Scope

The adapter discovers **17** native transport mappings. The closed
[manifest](mcp-stdio-tools.json) includes `hub_task_request_decision` through the
existing protected native client and retained mutation journal. The production
action registry remains empty, so a fresh otherwise-authorized decision request
returns the actual server's unavailable outcome; discovery is not action
activation or positive decision parity. This is not completion of issues62–64,
and does not expose approval/admin/upload/enrollment tools. The seventeenth tool
uses `NativeClient.call`; it does not add a CLI command or expand frozen R2
CLI33/native37-case or54-operation isolation receipts.
The [design amendment](../superpowers/specs/2026-11-01-mcp-source-design.md)
records why a separate nonprunable local replay profile is necessary.

## Build and explicit launch

Use the repository-pinned Node24.22.1/npm11.19.1. From the repository root:

```sh
npm ci
npm ci --prefix packages/mcp-stdio --ignore-scripts
node packages/mcp-stdio/scripts/check.mjs
npm audit --prefix packages/mcp-stdio --audit-level=low
```

The SDK package is exactly1.32.2 with an independent integrity lockfile; the root
package/lock remains unchanged. The build is `packages/mcp-stdio/dist/main.mjs`.
SDK1.32.2 supports2025-11-25 but has older defaults; this adapter offers only
2025-11-25, following the pinned specification's negotiation response. A client
that cannot support the offered revision must disconnect. No newer protocol or
external desktop-client compatibility is asserted.

An operator must already have an explicitly initialized native protected state
root, a credential and its genuinely captured runtime association for the exact
origin/workspace. This adapter neither imports credentials nor enrolls runtimes.
Create the separate local journal deliberately, once, before launch:

```sh
node packages/mcp-stdio/dist/main.mjs --init-journal --state-dir /absolute/operator/state
node packages/mcp-stdio/dist/main.mjs --origin https://hub.example.invalid --workspace ws --state-dir /absolute/operator/state
```

These are launch templates, not commands executed against a user store. The
initializer creates only `mcp-journal` beneath the existing protected root.
Normal launch opens existing `secrets` and `mcp-journal` only. There are no secret
command-line arguments, token environment fallback, arbitrary module/provider
loader or tool-selectable origin/store/profile. Existing protected storage's
Linux filesystem/ownership restrictions apply. Same-UID hostile code/root remain
outside that existing custody boundary; this is not encryption or a sandbox.

## Replay and capacity

Each mutation requires the caller's exact1–256-byte printable ASCII native
idempotency key. The adapter never adds a prefix or generates a replacement.
A single journal transaction finds/reuses the original exact semantic request
and principal binding, or inserts one explicit-key intent. Conflicting keys,
multiple historical matches and changed principals fail closed. Original
first-dispatch clocks and expiry/reconciliation states survive process restart.

The dedicated MCP journal has application_id0x43464d4a; legacy native journals
use0x4346484a. Both retain their existing version1/table shape. They cannot be
opened as each other or automatically converted. MCP history never prunes;
existing1000-entry/64MiB total/128KiB per-entry limits are unchanged. Capacity
exhaustion holds new intents rather than evicting replay evidence. There is no
supported clear/reset/force-replay operation. Manual state deletion retires
reconciliation evidence and must never be presented as safe replay recovery.

A retained settled intent does not store its complete native DTO. Repeating it
therefore returns a fixed reconciliation-needed tool error with no fabricated
historical result. Use authorized native current-state reads and operator
reconciliation. Unknown outcomes preserve the original identity; no fresh key,
automatic retry, cancellation or domain completion follows from connection loss.
An old claim result is never renewed execution authority.

## Protocol and error bounds

- STDIO input buffer:131072 aggregate bytes, including coalesced messages. A
  sufficiently large burst of individually valid messages may be refused.
- At most one tool call in flight; no unbounded request queue.
- Output:2MiB per message, at most8 pending messages and4MiB pending bytes. A
  stopped consumer/overflow closes admission synchronously; late EPIPE is handled.
- Fixed short text accompanies complete **native-client canonical** structured
  envelopes, retaining page/request correlation/versions/fences. Existing native
  client sanitization of remote messages/details is preserved, not a claim to
  forward untrusted raw HTTP bytes. Protocol failures are distinct from native
  domain errors. Local or uncertain faults use fixed `isError:true` text without
  fabricated correlation or structured native data. The pinned SDK client was
  exercised with this error lane and output schemas.
- Protected secret checks cover entire output messages, including correlation,
  structured fields and protocol errors; diagnostics never echo arguments.
- EOF/signals stop admission but allow already admitted native work to settle
  under its finite native deadline before closing custody. Forced termination
  leaves the durable intent ambiguous; it never certifies no effect.

## Observed source evidence

These observations belong to the current local source checkpoint, not a published
or deployed release. Exact final commit/tree and review receipts remain in the
execution handoff.

| Evidence | Observation / limit |
| --- | --- |
| Protocol/client/runtime | SDK1.32.2, protocol2025-11-25, Node24.22.1/npm11.19.1 on Linux |
| Closed contract | All17 mappings validated through existing native request validators; input/output schemas compiled, unknown fields/wrong workspace denied; decision native envelope/body schema reused |
| Process canary | Actual built child process initializes, discovers17, calls native-client fixtures; pinned SDK client exercises structured success/domain denial and text-only uncertain errors |
| Production entry | Actual built main starts with existing protected state and calls a loopback HTTPS fixture with an ephemeral explicitly trusted CA; no TLS validation bypass |
| Local decision chain | Actual SDK → built production STDIO → protected provider/journal → trusted-CA HTTPS proxy → exported Worker entry/SQLite DO; real enrollment and claim precede matching native/MCP503 and current-revocation401. Exact body/key/proof and Worker request correlation retained; domain/outbox/ledger unchanged. Ambiguous heartbeat blocks the next SDK owner request before send across process restart |
| Custody/replay | Real protected provider/client/coordinator fixtures; two-process atomic reuse, crash during transaction, restart/expiry, changed binding, old-reader refusal and bounded-cap denial |
| Streams | Stopped-reader output flood, oversized aggregate input, near1MiB native-sized output, late EPIPE, input loss during pending work and secret canaries |
| Dependencies | Package-local full audit observed zero vulnerabilities; this is not security signoff |
| Native host regression | Shared journal change builds/imports under unchanged4MiB cap; executor is not invoked by that check |

The local HTTPS fixture maps only its ephemeral loopback upstream URL origin to
configured `https://hub.example.invalid`; method/path/query/body and auth/proof/key
headers are preserved. It does not rewrite an Origin header to bypass policy,
fabricate a domain response, bypass TLS validation, or relax deployment-origin
rules. This is local reverse-proxy test composition, not deployed hostname/proxy
certification or a live credential run.

Missing: allowed/denied comparisons against the actual native domain for every
tool, positive decision action activation/parity, full two-workspace persistent-effect
matrix, live current-authority/fence races, external advertised desktop clients,
deployed credentials, independent security acceptance and release evidence.
Synthetic fixtures do not satisfy those gates. No arbitrary client configuration
is labeled verified.
