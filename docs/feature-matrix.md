# Feature and evidence matrix

Status: R1/R2 source integrated · Contract revision 0.2 · Implemented only; isolated acceptance pending; no released artifact.

The reviewed R2 stack is integrated on `dev` at `55dba1444d8633c9425ba537836f1f28e64db678`, tree `0274c79e40333838f9bd520ddd5f3b1b9dcd33a5`. The [dated integration record](r2-source-integration-2026-10-31.md) maps the source slices, exact CI and remaining acceptance gates. Current recovery source supports schema16; old schema14-only checkpoint notes below are historical.

This is the canonical capability-status register. **Fourteen R1 and nineteen R2 capabilities are Implemented (reviewable integrated source), while nine R3/R4 capabilities remain Specified. None is promoted to Verified or Released by this amendment.** F14 source isolation tests are not an independent security certification; F24 client/runner source is not actual protected native conformance; F40 recovery tooling is not a completed integrated restore rehearsal. Real isolated deployment, toolchain, security and acceptance evidence remain outstanding. Protocol adapters and team administration require their own later contracts and implementation.

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
| F11 | Dynamic logical-agent registry | R2 | Implemented | Issue25 source: human-authorized create/edit/archive, bounded reads and retained attribution; live acceptance pending |
| F12 | Workspace-scoped native credential lifecycle | R2 | Implemented | Issue25 source: one-time reveal, safe replay, current ceilings and revocation; replacement is explicit issuance/revoke, runtime rotation integration and live acceptance pending |
| F13 | Runtime registration and presence | R2 | Implemented | Issue26 source: exact credential proof, initial-only reveal, current replay/deadline checks and presence-only heartbeat; live acceptance pending |
| F14 | Workspace isolation across resources | R2 | Implemented | Two-workspace deny matrix for tasks/messages/artifacts/search/cursors and adapter calls |
| F15 | Durable task creation and metadata | R2 | Implemented | Local issue 27 source: server-owned Backlog, guarded metadata/Ready, current replay and bounded authorized reads; [local evidence](r2-task-plans/issue-027-execution.md), live acceptance pending |
| F16 | Six-column Kanban and archive | R2 | Implemented | Persisted state after restart; permitted command actions; cancelled tasks retained |
| F17 | Atomic claim, lease and fence | R2 | Implemented | Competing claims yield one owner; stale runtime cannot submit or renew |
| F18 | Assignment, eligibility and WIP | R2 | Implemented | Last-slot race enforces policy; labels do not grant permission |
| F19 | Run heartbeat and expiry | R2 | Implemented | Clock-boundary tests; only run_version changes on renewal; expiry checked on command |
| F20 | Idempotent mutations and version conflicts | R2 | Implemented | Identical replay, changed-payload conflict, cross-principal scoping and lost-response recovery |
| F21 | Result submission and independent acceptance | R2 | Implemented | Review before Done; alternate credential/runtime cannot bypass submitter exclusion |
| F22 | Failure budget, requeue and cancellation | R2 | Implemented | Bounded retries, exhaustion flag, no reset through requeue; cancellation wins against stale owner |
| F23 | Artifact stage/upload/commit/download | R2 | Implemented | Integrated composed32/33 source: immutable generations, bounded cleanup/drain and conditional authenticated ingress. [Cleanup evidence](r2-task-plans/issue-033-execution.md); explicit separate product binding required, default/dev unbound. Not Verified or Released; no live acceptance |
| F24 | Native HTTP contract and CLI | R2 | Implemented | Request/response conformance and failure exit behavior against a real isolated deployment |
| F25 | Workspace-scoped search | R2 | Implemented | Underlying read scopes enforced; no hidden-resource snippets, counts or cross-workspace results |
| F26 | External task import and reconciliation | R2 | Implemented | Dry run, provenance map, repeated-import behavior, rejected rows and post-import counts |

## Personalization and human interaction

| ID | Capability | Gate | Status | Required evidence |
| --- | --- | --- | --- | --- |
| F27 | Neutral branding and empty catalog | R1 | Implemented | Fresh workspace has no personal branding/activity; examples require explicit import |
| F28 | Typed workspace profile | R1 | Implemented | Closed schema; forbidden policy/auth keys rejected; last valid profile survives invalid input |
| F29 | Stable projects and work roles | R2 | Implemented | Upsert preserves omitted records; referenced archive/remap explicit and audited |
| F30 | User theme, density and view preference | R1 | Implemented | Allowlisted override; forbidden resources remain inaccessible; keyboard access preserved |
| F31 | Message/task composition UI | R3 | Specified | Same domain validation as API; duplicate submit/lost response safe; draft recovery without secrets |
| F32 | Checkpoint and versioned human proposal | R3 | Specified | Waiting releases run; checkpoint retained; only current human-scoped decision accepted |
| F33 | Approval/rejection/expiry interface | R3 | Specified | Exact scope/version shown; stale decision denied; expiry never auto-approves |
| F34 | Accessible command and conflict UI | R2 | Implemented | Keyboard alternatives to drag, focus recovery and preserved input on version conflict |

## Adapters, teams and operations

| ID | Capability | Gate | Status | Required evidence |
| --- | --- | --- | --- | --- |
| F35 | MCP STDIO adapter | R3 | Specified | Pinned target, tool mapping, per-tool scope denial and native-semantic parity |
| F36 | Remote MCP transport and authorization | R4 | Specified | Resource audience, discovery/consent/token handling and transport lifecycle tests |
| F37 | A2A adapter | R4 | Specified | Exact version/subset, task mapping, authentication and unsupported-operation behavior |
| F38 | Team membership and invitations | R4 | Specified | Recipient-bound single-use invitation, expiry, revocation, last-admin recovery and isolation |
| F39 | Real external connectors | R4 | Specified | Provider permissions, genuine source IDs/timestamps, disconnect and stale-source handling |
| F40 | Backup, restore and import provenance | R2 | Implemented | Rehearsed coordinated metadata/artifact restoration with reconciliation report |
| F41 | Health, readiness and operational signals | R1 | Implemented | Distinct liveness/readiness, redacted diagnostics, due-work visibility and failure recovery |
| F42 | Retention, resource quotas and advanced operations | R4 | Specified | Enforced policy, recoverable maintenance, load evidence and documented capacity limits |

## Historical R1 candidate identity and evidence

The source baseline observed on published `dev` on 2026-10-26 is [`fcbe6139c65f9baafee9804a5c50867a1fcc0968`](https://github.com/trungtaottn/cf-agent-hub/commit/fcbe6139c65f9baafee9804a5c50867a1fcc0968). This is committed and published source, not an uncommitted candidate, deployed-byte attestation or tagged release. Subsequent changes require their own exact revision and evidence; this baseline does not attest the current working diff. See the [dated historical-plan amendment](superpowers/plans/2026-10-26-r1-source-reconciliation.md). The [source and check mapping](r1-implementation.md#source-and-executable-checks) covers every R1 row; the [remaining acceptance gates](r1-implementation.md#acceptance-still-required-before-verified) are explicit exceptions to promotion. Later-release contracts and fixtures do not imply that their routes or interfaces are available.

## Gate interpretation

Gates name the earliest intended availability, not a schedule or permission to omit dependencies. R1 still needs isolation for its own existing resources; F14 expands the comprehensive isolation matrix when new task/agent/artifact surfaces arrive. R1 uses operator-provisioned identities/grants; user-facing dynamic registry and credential lifecycle are R2. Recovery basics are required at every release; the R2 restoration gate covers the full durable-work model.

R2 offers independent result acceptance through authorized native/human calls. The richer compose and human decision interfaces belong to R3. Teams and protocol variants remain explicitly deferred until their own boundaries have been specified and tested.

## How to update status

A status change must include implementation references, exact revision, test commands/environment, expected/observed outcomes and any exceptions. Record evidence in the release's review material and link it from the corresponding row; never overwrite this baseline with an unsupported “complete.” If a feature is disabled or removed, document user-visible behavior, retained data and recovery rather than leaving a stale green badge.

## Historical source-checkpoint notes

The following paragraphs preserve what each earlier slice did and did not implement at its original revision. Their references to unavailable later source, unchanged formal rows, pending publication or no merge are **historical**, superseded for current source status by the register and dated integration record above. Their unrun live/security/acceptance limitations are not erased.

### R1 contract amendment status

ADR [0007](adr/0007-r1-ingress-and-settings.md) closes the proposed static grant/credential, OIDC session, settings, event-discovery, notification and operator recovery contracts for F01–F10, F27, F28, F30 and F41. Their source status is **Implemented**, with local runtime checks and independent scoped reviews recorded for the candidate; deployed verification remains pending. F03 now includes explicit operator-provisioned hashes, immutable credential IDs, scoped grants and monotonic install, without claiming R2 F12 dynamic credential management. F28 includes profile preview/apply/export with revision and size bounds; F30 includes caller-owned preferences and policy overrides; F41 includes public minimal liveness, human-only redacted readiness/operations and an authenticated operator probe. R1 owns first logical SQL/message/outbox recovery; R2 F40 expands it for task/runtime/fence and artifact-byte invariants. Unavailable R2 routes and task/artifact message references do not become R1 features merely because later-release schemas or fixtures exist.

Issue #22 adds a [V2 recovery envelope contract](adr/r2-recovery-contract.md), not F40 implementation or acceptance. Synthetic format fixtures cannot certify committed-byte restoration; runtime remains V1-only until reviewed downstream implementation.

Issue #23 integrates generated shared DTOs, runtime test ownership and fail-closed boundary plumbing. Its [local execution record](r2-task-plans/issue-023-execution.md) is source evidence only; it does not implement the R2 domains or promote any capability to Verified or Released.

Issue 28 local source evidence: [catalog execution ledger](r2-task-plans/issue-028-execution.md). Immutable bounded previews, atomic archive/remap and ordinary-import archive guards are implemented locally; publication, browser-runtime verification and post-R4 live acceptance remain distinct. No claim/run endpoint is enabled.

Issue 29 staged claim/lease source and local engine evidence: [execution ledger](r2-task-plans/issue-029-execution.md). Public claim/run routes remain unavailable until expiry and settlement integration; formal capability promotion and live acceptance are pending.

Issue 30 staged failure/expiry and shared-alarm source: [execution ledger](r2-task-plans/issue-030-execution.md). This does not promote F17 or other capabilities, activate public execution ingress, or establish live acceptance. Issue 31 integration and the deferred acceptance gates remain outstanding.

Issue31 local cancel/requeue and integrated29–31 execution ingress source: [execution ledger](r2-task-plans/issue-031-execution.md). Historical result/decision fixtures do not implement submission/acceptance or R3 decision records. Formal capability promotion, remote availability and live acceptance remain pending.

Issue33 implements local bounded expiry/orphan observation and conditional artifact ingress after composed32/33 review. Unknown effects remain explicit holds, not automatic convergence. [Execution record](r2-task-plans/issue-033-execution.md) separates source tests, inherited environment blockers and operator mapping/live-acceptance gates.

Local issue34 integrates current task/committed-artifact references into existing messages without changing formal capability states. [Scoped implementation/evidence](r2-task-plans/issue-034-execution.md) covers coherent grants, atomic associations, current projections/dispatch and ACK neutrality; live acceptance and R2 evidence-register promotion remain pending.

Issue35 local result review source and its explicit non-release limits are recorded in [the execution ledger](r2-task-plans/issue-035-execution.md). The formal capability rows are unchanged.

Issue36 local authorized literal search and the explicit ambiguous-native-secret prerequisite are recorded in [the execution ledger](r2-task-plans/issue-036-execution.md). Formal capability rows and acceptance status remain unchanged.

## Local issue38 native-client source note

Issue38 adds a typed native facade, explicit protected-capture enrollment seam and bounded artifact stream hooks on the existing browser transport. The single reviewed/generated operation mapping covers current source support, not deployment availability. Private provenance receipts are process-local; durable store/journal/platform support remains issue41. See [exact local evidence](r2-task-plans/issue-038-execution.md). Formal capability rows remain unchanged; no source pass, synthetic Workers measurement or draft publication establishes Verified/Released status or integrated acceptance.


Issue41 adds local durable intent/protected-provider foundations, not an installed CLI or capability promotion. [Execution evidence](r2-task-plans/issue-041-execution.md) and [ADR0009](adr/0009-r2-cli-local-durability.md) retain platform, replay-continuity, plaintext threat-model and acceptance limits. Formal Verified/Released rows remain unchanged.

Issue42 adds a local read-only task board/detail and exact `/tasks` authentication return integration, not task-command UI or capability promotion. [Execution evidence](r2-task-plans/issue-042-execution.md) distinguishes source/structural tests from unavailable browser and later live acceptance. Formal Verified/Released status remains unchanged.

Issue 44 adds a local executable CLI surface over the existing native facade, with protected retained artifact I/O and heartbeat serialization. [CLI usage](cli.md), [ADR0010](adr/0010-r2-native-cli-effects.md) and the [execution plan](../plans/261028-0315-native-cli/plan.md) describe source scope and limits. No F24 Verified/Released promotion follows from synthetic source or subprocess tests; real isolated HTTPS conformance and integrated acceptance remain separate.

Issue45 adds local version-bound Ready/Cancel/Requeue/Accept command source, current grant guidance, sticky uncertainty and explicit conflict review. [Execution evidence](r2-task-plans/issue-045-execution.md) preserves the browser and post-R4 live acceptance limits. This source checkpoint does not promote F16/F34 to Verified or Released.


## Issue46 local operator recovery source

The [issue46 execution record](r2-task-plans/issue-046-execution.md) adds a private durable anchor provider, authenticated current16 operator-client compatibility, serialized bounded local evidence and current16 capture freshness with bounded finalization. Read-only product bindings and separately scoped bootstrap/writer capabilities do not provision a live namespace or grant authority. V1 and retained15 boundaries remain explicit.

Node SQLite adapter tests, synthetic controller faults, genuine local Worker/SQLite/service-binding integration, pure CLI validation and protected filesystem rehearsal have distinct evidence owners. Actual valid10MiB local gateway capture/restore verified full target bytes and measured provider calls; this is not production subrequest/CPU/memory eligibility. The final handoff records exact frozen-source regression and near-limit SQL observations. Protected filesystem/browser limitations, denied dependency audit, blocked issue40 and post-R4 live acceptance remain unresolved. No merge, deployment or Released status follows from this source checkpoint.

## R3 composition source boundary

Issue53 adds scoped durable intents and exact prepared-admission reconciliation, including event evidence after outcome collection. The [composition contract](contracts/r3-composition.md) distinguishes minimal historical admission from current entity state, legacy uncertainty, source/browser evidence and unavailable live acceptance. Schema17 recovery compatibility is documented in [backup/restore](backup-restore.md). Task form integration is tracked in the [issue56 source evidence boundary](r3-task-composer-implementation.md), with real browser acceptance still pending; this bounded source change does not promote F31 or any capability to Verified or Released.
