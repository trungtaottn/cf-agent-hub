# Feature and evidence matrix

Status: R1 source candidate · Contract revision 0.2 · Isolated acceptance pending; no released artifact.

This is the canonical capability-status register. **The 14 R1 capabilities are Implemented in the reviewable source candidate; the 28 later-release capabilities remain Specified. None are claimed Verified or Released.** Implementation references and reproducible local checks are recorded in [R1 implementation and acceptance](r1-implementation.md). Real isolated deployment, recovery, toolchain and final evidence gates remain pending. A specification means behavior and acceptance expectations exist, not that every later-release field or UI has been finalized. Protocol adapters and team administration still require the additional contract work named in their pages.

Status advances in order: **Specified** → **Implemented** → **Verified** → **Released**. Implemented requires reviewable code; Verified requires reproducible evidence for the selected release; Released requires a tagged artifact, operator documentation and completed release gate. A screenshot, mocked response or successful documentation validator does not advance a runtime capability.

## Foundation and delivery

| ID | Capability | Gate | Status | Required evidence |
| --- | --- | --- | --- | --- |
| F01 | Verified human identity and browser session | R1 | Implemented | Invalid issuer/audience/signature, expired session and CSRF denial; no credential in browser storage |
| F02 | Operator workspace catalog and stable routing | R1 | Implemented | Rename preserves object identity; unknown workspace denied; profile cannot reroute storage |
| F03 | Operator-provisioned static participants | R1 | Implemented | Validated deployment registry and grants; no hidden demo participant or fallback identity |
| F04 | Message send with durable acceptance | R1 | Implemented | Atomic persistence/outbox; lost response replay returns original outcome |
| F05 | Inbox and thread views | R1 | Implemented | Authorized bounded pagination; stable order, empty/stale/failure states |
| F06 | Recipient ACK | R1 | Implemented | Idempotent recipient-scoped ACK; foreign message denied; ACK never changes task state |
| F07 | Notification outbox and retry recovery | R1 | Implemented | Restart preserves due time/budget; duplicate alarm safe; exhausted delivery visible |
| F08 | Payload bounds and cursor validation | R1 | Implemented | UTF-8 and aggregate-size boundaries; oversized batch rejected before mutation |
| F09 | Truthful read dashboard | R1 | Implemented | Real source and freshness; disconnected/partial/forbidden distinct; no fabricated activity |
| F10 | Request correlation and redacted audit | R1 | Implemented | Stable request/event linkage; secrets absent; failed authorization recorded appropriately |

## Durable work and native clients

| ID | Capability | Gate | Status | Required evidence |
| --- | --- | --- | --- | --- |
| F11 | Dynamic logical-agent registry | R2 | Specified | Human-authorized creation/edit/archive; archived identity retained in history |
| F12 | Workspace-scoped native credential lifecycle | R2 | Specified | One-time reveal, verification hashes, scope ceiling, revocation and rotation |
| F13 | Runtime registration and presence | R2 | Specified | Agent binding and expiry; runtime heartbeat cannot renew a task lease |
| F14 | Workspace isolation across resources | R2 | Specified | Two-workspace deny matrix for tasks/messages/artifacts/search/cursors and adapter calls |
| F15 | Durable task creation and metadata | R2 | Specified | Valid references, explicit versions, forbidden field/state patches denied |
| F16 | Six-column Kanban and archive | R2 | Specified | Persisted state after restart; permitted command actions; cancelled tasks retained |
| F17 | Atomic claim, lease and fence | R2 | Specified | Competing claims yield one owner; stale runtime cannot submit or renew |
| F18 | Assignment, eligibility and WIP | R2 | Specified | Last-slot race enforces policy; labels do not grant permission |
| F19 | Run heartbeat and expiry | R2 | Specified | Clock-boundary tests; only run_version changes on renewal; expiry checked on command |
| F20 | Idempotent mutations and version conflicts | R2 | Specified | Identical replay, changed-payload conflict, cross-principal scoping and lost-response recovery |
| F21 | Result submission and independent acceptance | R2 | Specified | Review before Done; alternate credential/runtime cannot bypass submitter exclusion |
| F22 | Failure budget, requeue and cancellation | R2 | Specified | Bounded retries, exhaustion flag, no reset through requeue; cancellation wins against stale owner |
| F23 | Artifact stage/upload/commit/download | R2 | Specified | Size/digest/access checks, committed-only association and orphan reconciliation |
| F24 | Native HTTP contract and CLI | R2 | Specified | Request/response conformance and failure exit behavior against a real isolated deployment |
| F25 | Workspace-scoped search | R2 | Specified | Underlying read scopes enforced; no hidden-resource snippets, counts or cross-workspace results |
| F26 | External task import and reconciliation | R2 | Specified | Dry run, provenance map, repeated-import behavior, rejected rows and post-import counts |

## Personalization and human interaction

| ID | Capability | Gate | Status | Required evidence |
| --- | --- | --- | --- | --- |
| F27 | Neutral branding and empty catalog | R1 | Implemented | Fresh workspace has no personal branding/activity; examples require explicit import |
| F28 | Typed workspace profile | R1 | Implemented | Closed schema; forbidden policy/auth keys rejected; last valid profile survives invalid input |
| F29 | Stable projects and work roles | R2 | Specified | Upsert preserves omitted records; referenced archive/remap explicit and audited |
| F30 | User theme, density and view preference | R1 | Implemented | Allowlisted override; forbidden resources remain inaccessible; keyboard access preserved |
| F31 | Message/task composition UI | R3 | Specified | Same domain validation as API; duplicate submit/lost response safe; draft recovery without secrets |
| F32 | Checkpoint and versioned human proposal | R3 | Specified | Waiting releases run; checkpoint retained; only current human-scoped decision accepted |
| F33 | Approval/rejection/expiry interface | R3 | Specified | Exact scope/version shown; stale decision denied; expiry never auto-approves |
| F34 | Accessible command and conflict UI | R2 | Specified | Keyboard alternatives to drag, focus recovery and preserved input on version conflict |

## Adapters, teams and operations

| ID | Capability | Gate | Status | Required evidence |
| --- | --- | --- | --- | --- |
| F35 | MCP STDIO adapter | R3 | Specified | Pinned target, tool mapping, per-tool scope denial and native-semantic parity |
| F36 | Remote MCP transport and authorization | R4 | Specified | Resource audience, discovery/consent/token handling and transport lifecycle tests |
| F37 | A2A adapter | R4 | Specified | Exact version/subset, task mapping, authentication and unsupported-operation behavior |
| F38 | Team membership and invitations | R4 | Specified | Recipient-bound single-use invitation, expiry, revocation, last-admin recovery and isolation |
| F39 | Real external connectors | R4 | Specified | Provider permissions, genuine source IDs/timestamps, disconnect and stale-source handling |
| F40 | Backup, restore and import provenance | R2 | Specified | Rehearsed coordinated metadata/artifact restoration with reconciliation report |
| F41 | Health, readiness and operational signals | R1 | Implemented | Distinct liveness/readiness, redacted diagnostics, due-work visibility and failure recovery |
| F42 | Retention, resource quotas and advanced operations | R4 | Specified | Enforced policy, recoverable maintenance, load evidence and documented capacity limits |

## R1 candidate identity and evidence

The source baseline observed on published `dev` on 2026-10-26 is [`fcbe6139c65f9baafee9804a5c50867a1fcc0968`](https://github.com/trungtaottn/cf-agent-hub/commit/fcbe6139c65f9baafee9804a5c50867a1fcc0968). This is committed and published source, not an uncommitted candidate, deployed-byte attestation or tagged release. Subsequent changes require their own exact revision and evidence; this baseline does not attest the current working diff. See the [dated historical-plan amendment](superpowers/plans/2026-10-26-r1-source-reconciliation.md). The [source and check mapping](r1-implementation.md#source-and-executable-checks) covers every R1 row; the [remaining acceptance gates](r1-implementation.md#acceptance-still-required-before-verified) are explicit exceptions to promotion. Later-release contracts and fixtures do not imply that their routes or interfaces are available.

## Gate interpretation

Gates name the earliest intended availability, not a schedule or permission to omit dependencies. R1 still needs isolation for its own existing resources; F14 expands the comprehensive isolation matrix when new task/agent/artifact surfaces arrive. R1 uses operator-provisioned identities/grants; user-facing dynamic registry and credential lifecycle are R2. Recovery basics are required at every release; the R2 restoration gate covers the full durable-work model.

R2 offers independent result acceptance through authorized native/human calls. The richer compose and human decision interfaces belong to R3. Teams and protocol variants remain explicitly deferred until their own boundaries have been specified and tested.

## How to update status

A status change must include implementation references, exact revision, test commands/environment, expected/observed outcomes and any exceptions. Record evidence in the release's review material and link it from the corresponding row; never overwrite this baseline with an unsupported “complete.” If a feature is disabled or removed, document user-visible behavior, retained data and recovery rather than leaving a stale green badge.

## R1 contract amendment status

ADR [0007](adr/0007-r1-ingress-and-settings.md) closes the proposed static grant/credential, OIDC session, settings, event-discovery, notification and operator recovery contracts for F01–F10, F27, F28, F30 and F41. Their source status is **Implemented**, with local runtime checks and independent scoped reviews recorded for the candidate; deployed verification remains pending. F03 now includes explicit operator-provisioned hashes, immutable credential IDs, scoped grants and monotonic install, without claiming R2 F12 dynamic credential management. F28 includes profile preview/apply/export with revision and size bounds; F30 includes caller-owned preferences and policy overrides; F41 includes public minimal liveness, human-only redacted readiness/operations and an authenticated operator probe. R1 owns first logical SQL/message/outbox recovery; R2 F40 expands it for task/runtime/fence and artifact-byte invariants. Unavailable R2 routes and task/artifact message references do not become R1 features merely because later-release schemas or fixtures exist.

Issue #22 adds a [V2 recovery envelope contract](adr/r2-recovery-contract.md), not F40 implementation or acceptance. Synthetic format fixtures cannot certify committed-byte restoration; runtime remains V1-only until reviewed downstream implementation.

Issue #23 integrates generated shared DTOs, runtime test ownership and fail-closed boundary plumbing. Its [local execution record](r2-task-plans/issue-023-execution.md) is source evidence only; it does not implement the R2 domains or promote any capability to Verified or Released.
