# Fixed fixture HTTPS transport and verifier binding

Status: Source implementation; installed authentication, service authority and authentic native execution remain pending.

## Fixed composition

`createInstalledFixtureClient` combines the existing bounded protocol client
with the source-owned `node:https` sender. There is no default credential
lookup, module path, dispatcher, proxy, redirect setting, CA override or TLS
relaxation in its configuration. The constructor accepts only the validated
policy and a composition-owned `readAuthentication` function. Unknown keys and
getters are rejected. A function supplied by trusted application code is not
loaded from a run-config string.

The authentication function must read an already installed local credential;
it must not perform unbudgeted OAuth, remote refresh or discovery. Its actual
promise remains owned through abort, and a late result cannot open a socket.
The closed return contains an ASCII bearer token of at most 2,048 characters
and an expiry no later than policy expiry. The token is used only for the
Authorization header, not URLs, reports, logs or evidence.

The production sender uses normal certificate and hostname verification,
`rejectUnauthorized: true`, a non-reused connection and no redirect following.
It rejects the global TLS-disable environment setting. The separate explicit
source-test seam injects event producers for lifecycle tests; those tests do
not establish real TLS or an installed service identity.

## Exact request and response ownership

The sender independently admits the whole fixed protocol plan, sequence and
per-kind quotas. Direct use therefore cannot bypass preflight/accounting.
Only POST to the exact policy origin and `/native-fixture/v1` is accepted.
Outbound headers are built by source code; caller headers are not forwarded.
The exact bounded validated JSON snapshot is sent once. There is no retry.

Response status must be 200 and content type exactly application/json. Redirects,
compression, duplicate headers, informational responses, upgrades, CONNECT and
trailers are rejected. Body length is bounded before copying chunks. A complete
response is buffered before resolution; `IncomingMessage.complete`, response
close, request close and the assigned socket's close must all be observed.
Calling destroy is not proof of closure. Unknown close keeps the actual promise
pending and cleanup unknown. Unread request bodies and unexpected late streams
are cancelled/destroyed with settlement still owned.

The existing client then applies fatal UTF-8, closed response validation and
exact request/run/service/sequence/operation correlation. Credential expiry is
checked before connection, during receipt and before returning a result.
Effects already started at expiry remain consumed and uncertain.

## Transport budget version 1

Protocol v1 limits count JSON application envelopes. Transport budget v1 adds
at most 8,192 header bytes in each direction for each reserved call, with at
most 32 inbound header pairs. Node's parser also receives the 8,192-byte header
limit. The complete plan reserves at most 786,432 application request bytes and
4,718,592 application response bytes, including those conservative header
allowances. Per-kind and combined protocol limits still apply; the simultaneous
per-kind maxima need not fit the combined plan.

These counters are not TCP/TLS framing or packet measurements. Usage snapshots
are bounded application projections, while full reserved allowances cover
failed/uncertain attempts without refunds. The unchanged session limits remain
10 seconds per call and 120 seconds overall.

## Bound verifier

`createBoundFixtureVerifier` snapshots a validated policy and an independently
installed identity verifier. It rejects missing/default trust. The callback
must return exactly `{version: 1, request_sha256, claims}`. The request hash is
recomputed from the validated protocol request; claims must bind the full
policy digest, issuer, audience, service, principal, assurance, capabilities
and current expiry. Getters, extra fields, mismatches and expired/aborted late
returns fail closed. The wrapper returns the existing closed claims shape only
after those checks.

A matching hash or echoed claim is not authentication. The callback remains the
explicit installed authority boundary. No public keys, JWT algorithms, OAuth,
credential generation or issuer discovery are invented here. The local sandbox
uses this wrapper with its explicitly synthetic verifier against real workerd
state/control; it is not a real authenticated HTTPS run.

## Remaining source and execution gates

The fixed client/verifier are reusable code paths, not an installed service.
The full native host capability producers, concrete originals/recorder adapter,
protected installation descriptor and executable `--config` composition still
need integration. The three current fixture methods cannot authorize the full
native scenario. Missing installed trust remains a clean block, not a native
pass. See [fixture controller](native-fixture-controller.md) and
[host producer design](native-host-producer-design.md). Formal acceptance stays
after R4.
