# Feature and evidence matrix

Status: Design baseline · Contract revision 0.1 · Implementation pending.

This is the canonical capability-status register. **All 42 capabilities below are Specified; none are currently claimed Implemented or Verified.** A specification means behavior and acceptance expectations exist, not that every later-release field or UI has been finalized. Protocol adapters and team administration still require the additional contract work named in their pages.

Status advances in order: **Specified** → **Implemented** → **Verified** → **Released**. Implemented requires reviewable code; Verified requires reproducible evidence for the selected release; Released requires a tagged artifact, operator documentation and completed release gate. A screenshot, mocked response or successful documentation validator does not advance a runtime capability.

## Foundation and delivery

| ID | Capability | Gate | Status | Required evidence |
| --- | --- | --- | --- | --- |
| F01 | Verified human identity and browser session | R1 | Specified | Invalid issuer/audience/signature, expired session and CSRF denial; no credential in browser storage |
| F02 | Operator workspace catalog and stable routing | R1 | Specified | Rename preserves object identity; unknown workspace denied; profile cannot reroute storage |
| F03 | Operator-provisioned static participants | R1 | Specified | Validated deployment registry and grants; no hidden demo participant or fallback identity |
| F04 | Message send with durable acceptance | R1 | Specified | Atomic persistence/outbox; lost response replay returns original outcome |
| F05 | Inbox and thread views | R1 | Specified | Authorized bounded pagination; stable order, empty/stale/failure states |
| F06 | Recipient ACK | R1 | Specified | Idempotent recipient-scoped ACK; foreign message denied; ACK never changes task state |
| F07 | Notification outbox and retry recovery | R1 | Specified | Restart preserves due time/budget; duplicate alarm safe; exhausted delivery visible |
| F08 | Payload bounds and cursor validation | R1 | Specified | UTF-8 and aggregate-size boundaries; oversized batch rejected before mutation |
| F09 | Truthful read dashboard | R1 | Specified | Real source and freshness; disconnected/partial/forbidden distinct; no fabricated activity |
| F10 | Request correlation and redacted audit | R1 | Specified | Stable request/event linkage; secrets absent; failed authorization recorded appropriately |

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
| F27 | Neutral branding and empty catalog | R1 | Specified | Fresh workspace has no personal branding/activity; examples require explicit import |
| F28 | Typed workspace profile | R1 | Specified | Closed schema; forbidden policy/auth keys rejected; last valid profile survives invalid input |
| F29 | Stable projects and work roles | R2 | Specified | Upsert preserves omitted records; referenced archive/remap explicit and audited |
| F30 | User theme, density and view preference | R1 | Specified | Allowlisted override; forbidden resources remain inaccessible; keyboard access preserved |
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
| F41 | Health, readiness and operational signals | R1 | Specified | Distinct liveness/readiness, redacted diagnostics, due-work visibility and failure recovery |
| F42 | Retention, resource quotas and advanced operations | R4 | Specified | Enforced policy, recoverable maintenance, load evidence and documented capacity limits |

## Gate interpretation

Gates name the earliest intended availability, not a schedule or permission to omit dependencies. R1 still needs isolation for its own existing resources; F14 expands the comprehensive isolation matrix when new task/agent/artifact surfaces arrive. R1 uses operator-provisioned identities/grants; user-facing dynamic registry and credential lifecycle are R2. Recovery basics are required at every release; the R2 restoration gate covers the full durable-work model.

R2 offers independent result acceptance through authorized native/human calls. The richer compose and human decision interfaces belong to R3. Teams and protocol variants remain explicitly deferred until their own boundaries have been specified and tested.

## How to update status

A status change must include implementation references, exact revision, test commands/environment, expected/observed outcomes and any exceptions. Record evidence in the release's review material and link it from the corresponding row; never overwrite this baseline with an unsupported “complete.” If a feature is disabled or removed, document user-visible behavior, retained data and recovery rather than leaving a stale green badge.
