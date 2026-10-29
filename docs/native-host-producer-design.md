# Native host producer integration design

Status: Proposed integration architecture; service implementation, independent trust installation and live native conformance remain pending. This document does not install an authority or enable execution.

## Why the protected entry is still blocked

The current `--config PATH` file identifies candidate/runtime/build hashes, actors,
workspaces, protected paths and budgets. Its authority-record digest is not a
trusted issuer identity or an authorization grant. The controller deliberately
requires a separately trusted adapter. A module path, self-signed document,
public workspace GET or successful local sandbox cannot fill that role.

Existing operator recovery and recovery-anchor APIs are real but narrower:
install/capture/restore/status and current identity-ledger operations do not
provide per-command SQL/transport observations, deliberately isolated swap
stores, response-loss fault control or same-credential human revocation.
Capturing a whole workspace through recovery is not an implicit authorization
for native fixture observations. No new public SQL endpoint is proposed.

## Selected implementation shape, not an installed service

Use a fixed source-owned adapter and a separately operated **fixture-controller
service**. Do not load JavaScript from the run configuration. The adapter should
use a closed separately versioned trust-policy document and one fixed protocol
version, with exact allowed service origin/path and method names. A proposed
`/native-fixture/v1` path is a design choice, not a discovered existing endpoint.

Normal HTTPS validation remains mandatory; no certificate warning bypass,
`NODE_TLS_REJECT_UNAUTHORIZED=0`, arbitrary redirect or caller-provided proxy.
Authentication can reuse an independently deployed operator identity mechanism
only after its issuer/audience/service identity and grants are explicitly
bound to this service. An identity key delivered in the same untrusted response
is not a trust root. Which installed mechanism to use is an operator decision,
not something a source test or protected-file mode can establish.

The transport must enforce bounded complete response bytes, fatal UTF-8/closed
JSON, content type/status, no redirects, abort/deadline, exact request/response
correlation and no automatic retries. Nonces/request IDs and monotonic operation
sequence bind replies to run, step, candidate/config/scenario digest, both
workspaces, actor/store identity, current authority epoch and expiry. Capture
original bytes before projection; signatures or hashes alone do not prove the
service actually observed state. Protected originals exclude bearer/proof
secrets from public reports. Key rotation and revocation must be defined by the
installed policy, never accepted from an arbitrary response.

## Fixed capabilities and producer responsibilities

| Capability | Real producer work | Cannot be substituted by |
| --- | --- | --- |
| Authorize scenario | Current least-privilege capability bound to exact host, candidate, deployment/object/namespace, actors, workspaces, limits and expiry | Config digest, TLS alone or a generic `allowed: true` |
| Provision isolated fixtures | Explicitly authorized primary/foreign fixtures and separate protected swap stores, operation grants and execution policy | Editing an existing store, inventing principal IDs or exposing credentials |
| Observe preconditions | Current relevant scope, credential/proof binding and causal positive-control originals | Scope strings or an unrelated previous success |
| Observe state | Bounded selected before/after SQL commitments from the actual isolated instance | HTTP DTOs, a different local database or blanket unchanged flags |
| Observe transport | Actual invocation-correlated request count/status and response-loss evidence | CLI exit code, expected operation counts or synthetic projections |
| Control response loss | Exact commit-before-response-loss arm/ack/disarm with bounded target and independently observed outcome | Dropping an arbitrary request before commit |
| Disable credential | Explicit same-credential authorized operation and acknowledgment after admitted positive control | Local epoch-changing configuration disable labeled as human revocation |
| Read originals | Protected exact records with identity/digest/size/correlation and cumulative budgets | Reconstructed or backdated receipts |

`describe` and source request preparation should remain local/pure wherever
possible. Any future remote authorization, discovery, preparation or observer
read is itself an external effect: reserve its request count, input/output
bytes and duration **before the first network call**, including repeated
fresh-authority checks. It cannot be hidden behind the current pure-adapter
contract or charged only after the main scenario reservation. Typed-evidence
and scenario reservations still share their existing global budgets; adding a
transport requires an explicit reviewed budget/version amendment.

An uncertain control response stops dependent work and preserves originals and
intent. It does not authorize retry with a new key, journal settlement, fault
cleanup, hold release or revocation repetition. The shipped one-shot CLI's
uncertain restart remains no-send; this design adds no replay clock authority.

## Work the implementation team still owns

1. Versioned protected trust-policy parser and fixed capability-preflight
   protocol, independently reviewed downgrade/replay/expiry tests.
2. Bounded authenticated transport and source-owned adapter wiring; current
   `--config` cannot claim this is installed. Keep absence/error explicit.
3. Actual fixture-controller service implementation with authenticated scoped
   control and observer interfaces, not only client scaffolding.
4. Protected storage/original custody, typed producer integration and full
   scenario orchestration using the existing source body plans and registry.
5. Safe eligible-host integration tests, retained uncertainty tests and complete
   native/global evidence assembly. Source mocks are not authentic originals.

These are architecture and implementation tasks, not instructions for the user
to design code or provide every low-level API. We can design/test the protocol
and adapter without production credentials, but cannot establish an installed
trust relationship by pretending it exists.

## Minimum operator inputs when installing or executing

- Select the operator-controlled Linux host and eligible protected root layout,
  with pinned Node/build provenance. Existing ownership/noGit guards stay intact;
  no hardware purchase is implied.
- Identify the isolated test deployment/namespace and fixture-controller owner,
  approved HTTPS identity and independently installed authentication/trust policy.
  Supply secret material only through the selected protected mechanism, not chat,
  issues, source or examples.
- Approve the exact capabilities/limits for isolated fixture provisioning,
  observer reads, deliberate response loss and same-credential disable, and name
  who owns uncertain-operation inspection and cleanup decisions.

No real credentials, persistent service, deployment or fault/revocation actions
are authorized or created by this design document. Formal integrated acceptance
remains deferred until after R4, separately from unfinished adapter code.
