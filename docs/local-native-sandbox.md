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

## Local route capture and commit-before-publication fixture

Local report version 2 adds bounded source-owned route observations to each
fresh round. The version 1 schema remains unchanged; neither version can be
used as native conformance evidence. The observer forwards exact bounded
request bytes to the real local Worker, records response digests and sizes,
and does not retain enrollment response bodies or credential headers.

A one-shot synthetic task creation is armed by credential reference, request
body digest and idempotency-key digest. An independent parameterized SQL read
first establishes absence of that exact outcome. After the real 201 response,
a fixed join checks the idempotency outcome, task, event and task history,
including original request ID, canonical outcome, actor, versions and times.
Only then is response publication intentionally suppressed. This is not a TCP
fault, built-CLI lost-response test, or permission to retry a retained intent.
A non-201 response means commit was not established, not proof of no commit.

Safe observations bind the local run, instance, ordinal, arm ID and commit
proof digest. Candidate/scenario binding and durable protected-original
publication remain responsibilities of the later native composition; this
local producer does not claim those absent bindings. Originals are memory-only.
The fixed plan allows 32 requests, 65,536 bytes per body, 8,192 header bytes per
direction per request, and 4,096 bytes per safe record. Invalid, mismatched or
duplicate arms fail closed before another dispatch. Unread or late responses
remain owned and cancellation failures prevent a closed-cleanup claim.

The three isolated slot/generation/principal-only swap obligations remain
blocked: supported credential lifecycle operations also change runtime-proof
provenance. Compound lifecycle tests do not satisfy those exact obligations.
No typed roster, release-root verdict or acceptance requirement is replaced by
this local fixture. Installed host authority and the remaining native adapter
composition are still required; formal acceptance remains scheduled after R4.

The independent commit projection byte-gates each SQL cell before the bridge.
For its maximum two selected rows, raw scalar payload is at most 22,064 bytes
(excluding object overhead); a conservative JSON encoding bound including fixed
keys and escaping is 132,823 bytes. Neither bound measures process memory or
wire/bridge metadata. These bounds are distinct from
the accepted canonical 16 KiB per observation and 32 KiB retained SQL total.
No overbound observation is truncated into valid evidence. The real two-round
fixture currently performs 17 handler requests and 43 SQL statements per round.

## Synthetic human revocation producer (local report version 3)

A dedicated third synthetic credential is separate from the submitter/reviewer
journey. It has only workspace-read and runtime-management scopes. Its real
runtime enrollment and admitted workspace read precede a human-authenticated
credential revoke; a fresh read with the exact same token must then return the
validated unauthenticated envelope. Independent fixed SQL observations require
unchanged installed epoch/digests and human grant/delegation, exact credential
version/revocation changes, and the complete bounded runtime transition set.
This is not the older configuration-disable control: that separate submitter
check remains in place after the revocation observation.

The local runner reuses the existing synthetic OIDC provider. The owned outbound
bridge allows only its discovery/JWKS/token routes; private code issuance is not
reachable through Worker egress. Actual login state, code, cookie, session and
CSRF checks run through the product handlers. No auth session is inserted into
SQL and no human actor is fabricated. All fixture authentication material stays
private and ephemeral; no real OAuth service, listener or installed host trust
is created. Teardown drains owned activity, closes the Worker and fixture-owned
SQLite resource, then restores the previous fetch function only if cleanup is
known complete. Failed cancellation leaves cleanup unknown, not a green result.

The fixed host reserves 20 bearer calls and four human application calls, plus
at most eight issuer calls and one private issuance call. Native/human responses
are bounded to 64 KiB; issuer/private responses to 32 KiB, totaling at most
1,867,776 bytes. The report's response-byte count includes issuer/private bytes;
its HTTP-request count refers only to application calls. Eight additional fixed
SQL reads are capped to 16 KiB accepted canonical data each. No request-selected
SQL, route, authentication header or budget is exposed. Versions 1 and 2 remain
unchanged; version 3 cannot be downgraded into either schema or native evidence.

Actual execution receipts, not this implementation description, determine which
checks passed. Genuine native process/installed-authority integration and the
three tuple-only swap limitations remain separate unfinished requirements.

Late issuer acquisition is registered inside the actual owned initialization
promise, even when an outward abort has already won. Cleanup drains that actual
promise before disposing its resource. Credential expiry is checked again around
the final denial, so a token that expires during the flow cannot be reported as
a revocation-caused denial merely because it returned 401.

## Cross-workspace resource producer (local report version 4)

Version 4 adds a second fresh, independently mapped workspace with a distinct
synthetic credential and a genuinely created foreign task. Separate submit and
fail controls each create, ready and claim their own A task. An A request naming
the existing B task and valid A run must return the validated forbidden envelope
without disclosing the foreign identifier, title or description. Only after
independent selected-state observations show no change may the same A proof and
run perform the own-target positive control. The fail control preserves the
product's `outcome_unknown` flag; it does not install a replay rule or clear holds.

The exact claim is **cross-workspace/resource mismatch**, not an isolated
same-workspace wrong-run test or proof that A can see B. Read-only SQL observers
bind both installed workspace identities, the current A credential/grant/proof,
run lease and selected resources. Snapshots include tasks, runs, results,
acceptances, events, history and idempotency outcomes for the selected identities.
Idempotency selection does not filter away an incorrectly attributed mutation.
Each positive requires the joined actual task/run/outcome/event/history state,
with the result row for submit, rather than mere row existence.

The additional fixed producer admits 12 application calls and 74 SQL reads.
The combined round admits 36 application calls and 125 SQL reads. Its separately
reserved 12 responses of 16 KiB bring the response envelope to 2,064,384 bytes,
below the unchanged 2 MiB cumulative cap. Each accepted canonical SQL projection
is at most 16 KiB. Typed cell gates and overflow rows bound bridge projections
separately: the largest conservative JSON bound is 532,237 bytes for the
17-row idempotency projection, not a wire-size or process-memory claim. Per-query
deadlines retain ownership of unsettled SQL and prohibit further reads after
failure. The local version 4 schema retains explicitly false native-conformance
and issue-complete fields; prior versions and native release schemas are unchanged.

This closes a local producer path only. Durable native-original composition,
protected process execution and genuinely installed authority remain distinct.
The three unchanged tuple-only swap obligations are not satisfied by this flow.

## Private captured bytes and record pairing

The local foreign and revocation producers retain the bounded bytes behind their
safe digests instead of discarding them after validation. HTTP entries retain
actual received response-body bytes before JSON parsing. Selected SQL entries
retain canonical typed rows returned by the owned observer before their safe
hash projection. The human revoke acknowledgment is explicitly a canonical
returned-object capture, **not** a claim to retain its original HTTP body.

Each producer has an internally generated capture identity, pinned by the host
before the run. Fixed rosters admit 74 foreign-state entries, 12 foreign-route
responses and 12 revocation entries (eight SQL, three native responses and one
returned acknowledgment). Per-kind admission occurs before copying. Invalid
append attempts poison the capture; incomplete or failed stores cannot pass
completion pairing. Exact total retained payload reservation is 1,802,240 bytes,
excluding metadata and detached verification copies; it is not an RSS bound.

After both actual producer flows succeed, the host consumes each private store
once and verifies every sequence, selector, digest and byte length against the
corresponding safe records. It rejects missing originals, wrong instances,
changed bytes, record substitutions and raw-response/returned-object confusion.
Returned buffers are detached; mutation cannot rewrite retained capture bytes.
Malformed bounded bodies may remain privately available for failure diagnosis
without becoming a successful safe observation.

These accessors are private source APIs, not an independent authentication or
filesystem custody boundary. Enrollment response originals contain synthetic
runtime secrets and must never be printed, included in ordinary JSON reports,
committed to source, or included in recovery backups. Only secret-free source,
validation results and safe commitments are deliverables. Captures remain
memory-only, local and source-test-only; pairing does not turn them into native
process originals, installed observer authority or durable release evidence.
Local report version 4 and the native release evidence schemas are unchanged.
