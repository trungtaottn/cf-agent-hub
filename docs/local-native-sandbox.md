# Local R2 backend sandbox

Status: Synthetic local source integration implemented; native conformance and post-R4 acceptance remain pending. No released capability is claimed.

`npm run test:native:r2 -- --local-sandbox` runs a **synthetic local source
integration check**, not built-native conformance. It uses the installed
Wrangler test harness, real Worker routes, SQLite Durable Objects and emulated
R2. No Cloudflare deployment, external target, real credentials, browser,
protected native store or TLS exception is required or configured.

The flag is exclusive: it cannot be combined with `--config`, a target, module,
credentials or other options. The existing `--config PATH` route remains
fail-closed until a real independently authorized host adapter is supplied.
The local mode is not such an adapter and does not call `executeNativeScenario`.

## What the check does

Each of two rounds starts a fresh ephemeral harness instance and routed Durable
Object with synthetic
submitter/reviewer credentials kept only in memory. Actual public HTTP handlers
perform enrollment, Backlog → Ready → Claim → artifact stage/upload/commit →
Submit Review → independent Done. Source-owned SQL observations independently
check persisted selected task/run/result/acceptance/artifact state, rather than
inferring persistence from a response DTO.

Negative checks use meaningful current permissions and real local handlers:

- The submitter has `tasks:review` but cannot accept its own result. A distinct
  reviewer then accepts the same result/run. Selected domain SQL state is
  unchanged across the denied attempt.
- A valid submitter proof cannot heartbeat the reviewer's existing runtime.
  Valid own-runtime heartbeats surround the denied request; selected SQL state
  is unchanged across the denial.
- A successful own-workspace read precedes a real local configuration update
  disabling the synthetic credential. SQL confirms the exact version increment
  and epoch 2 before a fresh same-token read is denied. This is **configuration
  disable** through the existing owned control binding; routing and secret references
  remain exact, with no Worker restart. It is not a human credential-revocation operation or same-epoch proof.
- The first harness must finish its operations and close before the second is
  created. The second uses fresh ephemeral storage and a newly routed object,
  verifying empty selected domain state before creating work. This is fresh
  isolation, not evidence of persistence across a restart.

SQL projections are fixed, bounded and exclude tokens, runtime proofs, sessions
and arbitrary payloads. Equality claims concern those selected columns only,
not every table, audit/authentication effect or complete workspace state.

## Bounds and cleanup

Per round: at most 32 HTTP route calls and 128 SQL statements; at most 128 rows
per SQL query; 64 KiB request bodies/query results, 256 KiB individual HTTP
responses, and 2 MiB each of cumulative HTTP-response and SQL-result bytes.
No retries or user-supplied query/target is supported. Setup and all checks share
120 seconds; fixture operations additionally have 10-second deadlines. The
owned cleanup protocol shares one further 10-second deadline.

Timeouts abort new work and cancel response readers. Actual pending operations
are tracked beyond timeout races. Cleanup interrupts the owned harness, waits
for actual operations to settle, closes again after late setup, and removes
only its owned temporary build directory. Unknown settlement/closure is a
failure, never a successful cleanup report.

## Interpreting output

Success is a closed [`local-r2-sandbox-result`](../spec/local-r2-sandbox-result.schema.json)
report with `status: local-source-checks-passed`, `transport:
local-worker-dispatch`, `nativeConformance: false`, `issue48Complete: false`,
`acceptance: not-evaluated` and `cleanup: closed`. Exit 0 means only that these
local checks and cleanup passed. Invalid arguments exit 2; failed checks or
uncertain cleanup exit 5 with sanitized diagnostics and no success report.

Worker dispatch is an in-process test-harness path, **not network TLS or a built
CLI subprocess**. The SQL observer is independent of the HTTP readback path,
not an independently authenticated external observer. This report has a
separate schema and cannot substitute for native37/global380 originals, F24,
release approval or final acceptance after R4.

The real native path still needs eligible protected runtime/store/input roots,
a trusted HTTPS/DNS route, current authority and independently authenticated
observer/control interfaces. No Node ownership change, `.git` removal, arbitrary
proxy or TLS-ignore flag is part of this local mode. If ordinary Wrangler app
configuration needs an existing writable `XDG_CONFIG_HOME`, it may be selected
for normal tool setup; that does not relocate or weaken protected native stores.
