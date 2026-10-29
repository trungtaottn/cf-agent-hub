# Bounded fixture-controller core

Status: Source implementation and local synthetic integration; installed authority and full native conformance remain pending.

## Implemented source scope

The version 1 fixture protocol is a fixed client, Request/Response service core,
and owned SQL/control backend. It is not a generic RPC server or a deployed
identity provider. The three operations are `preflight`,
`observe-selected-state`, and `configuration-disable-local`.

`node scripts/test-native-r2.mjs --local-sandbox` now traverses this pair in
process against two fresh workerd/SQLite Durable Object/emulated R2 fixtures.
Each round performs 41 protocol calls: one preflight, 39 selected-state reads,
and one configuration-disable operation. The latter independently reads the
selected credential and workspace epoch before and after actual configuration
reconciliation. Thus the reported total is 41 SQL statements, not just the
39 journey-observer statements. Reported SQL bytes likewise include both
control observations. These are local source checks, not native conformance.

The local composition uses explicit `source-test-only` assurance and a synthetic
issuer, candidate identifier and scenario identifier. Its verifier is only a
private test fixture, not an authenticated operator. It creates no listener,
public SQL endpoint, persistent credential, or installed trust. Production
routing, TLS, runtime custody, and the default protected `--config` admission
remain unchanged.

## Versioned identity and admission

The closed policy binds service, issuer, audience, principal, run, fixture
instance, workspace, object, candidate/configuration/scenario digests, expiry,
and a fixed call plan. Structural policy validation and its SHA-256 digest do
not authenticate it. The composition root must supply an already trusted
verifier; caller `allowed: true` is not authority. No module path, SQL fragment,
credential material, backend callback, or trust hook is loaded from requests.

A verified grant must match the full policy digest and identities. Its explicit
capability set is intersected with the source-owned backend capabilities.
Preflight reports `partial-local-fixture` and `native_conformance: false` even
when all three operations are available. Requests for unsupported native host
capabilities fail closed before fixture effects.

The service snapshots backend methods and identities. Every response is bound
to the exact request sequence, request ID, operation, service, run and instance.
Selected rows use fixed projections, canonical SHA-256 and byte-size checks;
foreign workspaces, additional columns, malformed cells and substitution fail.
The grant deadline is checked before every backend SQL/control action and
again before returning a result. Expiry during an already-started effect does
not undo it or permit a retry.

## Joint budgets and lifecycle

A policy reserves its entire plan before any request: one preflight, at most
62 observations and at most one configuration-disable, with at most 64 calls.
Each call reserves 4,096 request bytes. The cumulative request reservation is
at most 262,144 bytes. Response reservations are 4,096 bytes for preflight and
control and 73,728 bytes per observation; the combined limit is 4,194,304 bytes.
Not every simultaneous per-kind maximum fits the combined limit.

Selected state is limited to 128 rows, 256 UTF-8 bytes per text cell and 65,536
canonical bytes per observation. SQL is fixed and parameterized by owned
identity, with at most 128 statements and 2 MiB of selected SQL output per
backend. Text is truncated by SQL to one over the allowed width and then
rejected, not accepted as a complete value. The local journey reserves 41 calls,
167,936 request bytes, 2,883,584 response bytes and 41 SQL statements.

Sessions last at most 120 seconds, each call at most 10 seconds. Admission is
serialized, per-kind quotas are not interchangeable, and failed/uncertain
attempts consume their slot. No retries, cached replay or restart continuity
are implemented. Actual pending operations and stream cancellation remain
owned until settlement. Failed cancellation or unresolved cleanup is not
reported as closed. Shutdown interrupts the real harness even if a protocol
session cannot settle; it never silently abandons a failed close.

## Remaining installation and source work

This core does not install an issuer, verify a particular deployment's signed
policy, start an HTTPS service, or provision runtime custody. The current
client transport is trusted-composition injection; an actual installed
transport and authenticated verifier must be bound to the chosen operator's
trust roots and service identity. Normal HTTPS validation must be preserved.
No operator has supplied those installation authorities in this source task.

The three-operation backend is intentionally insufficient for the full native
scenario. Host/process custody, transport/fault observation, retained-input
consumption, remaining scenario controls and the native recorder integration
still need their concrete installed adapters. Default `--config` must not
turn this partial preflight or local synthetic verifier into native success.
Authentic native evidence, complete release evidence and formal acceptance
remain separate; formal acceptance is scheduled after R4.
