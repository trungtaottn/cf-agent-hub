# Task lifecycle

Status: Local R2 source through independent result acceptance; R3 decisions and live acceptance pending · Contract revision0.1.

This is the canonical proposed state machine. A task represents a durable unit of work and its review outcome. A run represents one execution attempt. A notification or ACK represents message delivery. These objects have independent lifecycles and must never substitute for one another.

## States and board meaning

| State | Meaning | Execution authority |
| --- | --- | --- |
| `backlog` | Work is captured but not eligible for a claim | None |
| `ready` | The task is eligible under its current assignment and policy | None until an atomic claim succeeds |
| `doing` | One active run owns a valid lease | Bound agent and runtime only |
| `waiting` | A current proposal requires a human decision | No active execution lease |
| `review` | A submitted result awaits independent acceptance | No active execution lease |
| `done` | An authorized independent reviewer accepted the result | None; terminal |
| `cancelled` | An authorized actor ended the task without accepting a result | None; terminal and archived |

The visible Kanban has the first six columns. Cancelled tasks remain available in the archive and audit history. A filter or hidden column does not change these domain states.

```mermaid
stateDiagram-v2
    [*] --> backlog
    backlog --> ready: ready or requeue
    ready --> doing: claim
    doing --> waiting: request decision
    waiting --> ready: approve current proposal
    waiting --> backlog: reject current proposal
    doing --> review: submit result
    review --> done: accept result
    review --> ready: requeue for revision
    doing --> ready: retryable failed attempt
    doing --> backlog: retry budget exhausted
    done --> [*]
```

Cancellation from any nonterminal state and expiry of a waiting proposal are defined in the table below rather than duplicated across the diagram.

## Authorized transitions

Every command validates the authenticated workspace, actor kind, relevant scope, current membership or credential, `expected_version`, and command-specific guards **inside** the domain transaction. Exact route names and bodies live in [HTTP API](http-api.md).

| Command or system event | From → to | Additional conditions and effects |
| --- | --- | --- |
| Create | New → `backlog` | Validate references and create server-owned versions/timestamps; never create an active run |
| Ready | `backlog` → `ready` | `tasks:schedule`; no uncertainty/exhaustion hold; valid active project/role and eligible assignment |
| Claim | `ready` → `doing` | `tasks:claim`; verified runtime proof, no uncertainty/exhaustion hold, active bound agent/runtime, assignment/capability eligibility and WIP capacity; atomically create lease and fence |
| Request decision | `doing` → `waiting` | Owning native actor with `tasks:execute`; checkpoint and decision proposal bound to a new `proposal_version`; end run as `paused` |
| Approve | `waiting` → `ready` | Human session with `approvals:decide`; exact current task/proposal version and authorized decision scope; next execution requires a new claim |
| Reject | `waiting` → `backlog` | Same human and version checks; decision reason recorded; no implicit rerun |
| Proposal expiry | `waiting` → `waiting` | Mark approval expired and expose an actionable flag; no automatic approval, rejection or execution |
| Submit result | `doing` → `review` | Owning native actor with `tasks:execute`; current fence and lease; committed, authorized artifact references; end run as `submitted` |
| Accept result | `review` → `done` | `tasks:review`; current result and version; reviewer must differ from both submitting principal and submitting agent |
| Fail or lease expiry | `doing` → `ready` or `backlog` | End run as `failed` or `expired`; retry only when outcome is known safe under policy and budget allows; otherwise flag Backlog. Expiry without trusted replay-safe classification creates an uncertainty hold |
| Requeue | `review` or `backlog` → `ready` | `tasks:schedule`; record revision reason; invalidate previous result/approval as current, preserve history; do not reset retry budget |
| Cancel | Any nonterminal → `cancelled` | `tasks:cancel`; invalidate active run and pending decisions; preserve audit and retained artifacts |

No generic PATCH may directly set state, active owner, run, fence, result or approval. Metadata PATCH is limited to Backlog and Ready, and is rejected while a current approved proposal authorizes the next execution. A changed title, description, project, work role or assignment could change the approved intent. Cancel and create revised work when that intent must change; a previous approval cannot authorize the revision. Review comments do not accept a result. The exact editable metadata and state restrictions are specified in the API contract.

## Claim, lease and fencing

A successful claim creates one run with `runtime_instance_id`, agent identity, lease deadline and an increasing task-scoped `fence`. The task points to that run through `active_run_id`. The authorization test is the conjunction of current run identity, actor binding, unexpired server-side lease and matching fence; possession of an old run ID is insufficient.

Runtime enrollment also issues a one-time opaque proof bound to the workspace, agent, runtime and issuing native credential. Execution mutations require that proof in addition to the active native credential. A readable runtime ID or fence is not a secret and cannot authenticate ownership. Revoking the issuing credential invalidates its runtime proof; rotation requires draining or reconciling old work and enrolling a fresh runtime rather than inheriting an active run. Exact headers and one-time-secret retry behavior are in the HTTP contract.

Two simultaneous claims must produce one winner. When two eligible tasks compete for the last available agent WIP slot, the same workspace transaction boundary must enforce that limit. A presentation layer cannot implement this guarantee.

Run heartbeats renew only an active, unexpired run and update `run_version`. They do not increment `task_version` or `proposal_version`, so ordinary renewal cannot invalidate a pending metadata read or a human decision. Renewing an already expired run is forbidden even if the expiry scheduler has not yet processed it. Claim, submit and approval commands perform due-time validation themselves.

Runs have statuses `active`, `paused`, `submitted`, `failed`, `expired` and `cancelled`. Every nonactive status ends the attempt and has `ended_at`; a paused run never resumes in place. A subsequent claim obtains a new run and fence.

## Decision integrity

A proposal includes the intended action, scope, exact input binding, checkpoint and expiry. Authorization-significant parameters are captured in a committed immutable JSON artifact whose ID and verified digest are bound to the proposal; a free-text summary is not the complete permission request. It is a specific permission request, not a general grant to an agent. `proposal_version` advances when a new proposal is issued. Approval records bind the human principal, task version, proposal version and decision contents. Any outdated decision is rejected with a conflict and requires a fresh read.

After approval the task becomes Ready. An approved action must still be checked against current workspace policy when the next run starts and when an external action is dispatched. Revocation or cancellation after approval must take effect; approval does not bypass authorization. Rejection returns the task to Backlog for an explicit revision. Expiry leaves it Waiting so the UI can show the unresolved decision honestly. An authorized scheduler can cancel a stranded waiting task and create revised work; this baseline does not provide an implicit expired-proposal renewal command.

## Failure and retry

`retry_limit` is a bounded count of additional execution attempts permitted by workspace policy; it is fixed for the task unless a later explicitly designed policy operation changes it. `retry_count` records consumed additional-attempt budget, not deliveries or heartbeats. The claim transaction records the applicable retry-safety policy decision in its audit evidence. Lease expiry is treated as an uncertain external outcome by default. Only an explicit, trusted workspace policy established before execution may classify the work as replay-safe (for example, a verified externally idempotent operation); bounded automatic retry is available only for that classification. A runtime cannot declare work safe after losing its lease. Once authority is lost it may read, reconcile and escalate, but cannot use a stale fail or submit command to change the old attempt. The server expiry transition applies the hold or safe retry.

A failure with uncertain external effects always returns Backlog with `outcome_unknown`, preserving the uncertainty for external reconciliation. Both `outcome_unknown` and `retry_exhausted` block Ready, Requeue and Claim. This baseline has no command that silently clears those holds; after documented external reconciliation, an authorized actor may create reviewed replacement work and link its provenance. After a known failed/expired attempt, if retry is allowed and `retry_count < retry_limit`, atomically increment `retry_count` and return Ready. Otherwise return Backlog with a structured exhaustion flag. Requeue does not erase this history or enlarge the budget. Manual scheduling after exhaustion requires a revised task or an explicit policy extension outside this baseline.

If a client loses the response to a claim or submit, it retries the same idempotency key and payload within the replay window. It must not create a fresh claim or repeat an external side effect merely because the response was lost. The hub fences its own state; an external tool must enforce its own operation identity or compensating/reconciliation workflow. See [delivery semantics](delivery-semantics.md).

## Acceptance scenarios

Required evidence includes simultaneous claims, WIP contention, a stale owner's submit after reassignment, heartbeat at the lease boundary, an old approval after a new proposal, rejection/expiry without execution, cancellation concurrent with submit, replay after a committed-but-lost response, retry exhaustion, and denied self-acceptance through a different credential belonging to the submitting agent. Assert persisted state, event, outbox and idempotency outcome together. A board screenshot alone cannot prove this contract.

## Local issue27 source boundary

Local source now implements server-owned Backlog creation, metadata-only Backlog/Ready edits, explicit Ready scheduling, current task reads and retained-result queries. This is not deployed verification. Create fixes retry policy at admission; PATCH cannot change retry/hold/state/run/result/approval authority, and any retained approval pointer blocks edits. Ready creates no run and grants no execution lease. Unsupported claim/submit/review/approval routes remain unavailable.

All mutation responses and original replay outcomes undergo current complete resource visibility. A current result with an unreadable artifact hides the whole task in lists and denies single-task/mutation responses rather than replacing the result with null. Replay does not reapply an old version or state precondition, but loss of current or original returned-reference visibility denies it. Events, task history and sanitized outcomes commit with the task in one synchronous transaction.

See the [issue27 ledger](r2-task-plans/issue-027-execution.md) for source tests, bounded-query limits and remaining live gates. Later result producers and restore must validate both the standalone history result and its embedded resulting Task against the supported response envelope; this issue supplies the shared fit guard, not those successor write operations.

## Issue 29 staged execution engine

The issue 29 engine is being implemented behind the closed production route gate. Its internal claim and renewal tests do not make public claims executable. Activation requires issue 30's shared scheduler/expiry transition and issue 31's conservative settlement/cancellation protocol, plus their integration tests. Artifact issue 32 has separate ownership. A dirty scheduler generation without those due-time sources is not a production lease scheduler.

Claim captures a trusted matching replay-safe rule's policy version, rule ID and evidence reference inside the same transaction as the run, task pointer, event and sanitized outcome. Without a matching rule, the existing schema stores all three fields as null: this means unknown, not permission to retry. Later policy edits cannot retroactively classify that attempt safe. Unsettled active rows retain agent WIP even after their deadline; claims never steal them.

## Issue 30 staged failure and expiry engine

The internal failure command requires the exact current runtime proof, credential, epoch, fence, unexpired lease and expected task version. Failure reason is inert and never retained in events/outcomes. Replay checks current original-owner authority and complete returned-resource visibility, not the ended run's old active/version preconditions. A lost response does not charge another retry.

The claim's private captured policy version, rule ID and evidence reference are the only safe-retry classification; a later policy cannot retroactively upgrade an unknown attempt. Explicit uncertainty always wins. Safe failure/expiry consumes one additional attempt only while the task's fixed budget remains; unknown and exhausted holds stay Backlog. Existing holds are never cleared. Expiry ends a revoked or old-epoch owner's due attempt using a fixed trusted system event, not by impersonating that owner or granting a fresh claim.

Run ending, task pointer/version/retry updates, redacted event/history and dirty scheduler generation commit together. User failure additionally commits its sanitized command outcome in that transaction. Expiry has no fictitious user idempotency outcome: active-to-ended transition is its replay guard. Each shared-alarm unit commits independently, so a later failure retains earlier transitions and leaves remaining work due. This is local source behavior, not deployed acceptance.

Issue 31 owns cancellation/requeue and integrated claim/expiry/cancel activation review; issue 35 owns result submission and independent acceptance. Claim, fail and run public ingress remain unavailable after issue 30; no hold-clear, retry reset, external effect replay or settlement beyond this issue is enabled. See [execution evidence](r2-task-plans/issue-030-execution.md).

## Issue31 cancellation and execution ingress

Local source integrates reviewed claim/renew/fail/run-read and cancel/requeue ingress through the same Worker→DO authorization lane. Submit/accept, artifact runtime and R3 decisions remain unavailable. This is not remote publication, deployed verification or acceptance.

Cancellation checks current `tasks:cancel`, complete current task/result visibility, expected task version and a nonempty reason. It ends only an active run, clears current ownership/result/approval pointers and preserves ended attempts, historical attribution, holds and retry budget. It does not undo external effects. `TaskCommandResult.run` and `.approval` are null for cancel/requeue; latest run and durable audit/history retain linkage. A fresh command against Done/Cancelled rejects; same-key replay remains the original outcome under current access.

Explicit Backlog/Review requeue clears prior current result/approval context under current scheduling/eligibility guards, without creating a run. Both uncertainty/exhaustion holds reject. A stale version requires a fresh read and deliberate current reason, not a retry with a fabricated version. Existing Ready remains distinct and rejects a retained approval pointer.

Ownership-changing POST success schedules the existing shared alarm repair in the DO lifetime without awaiting after final authorized response projection. The durable dirty generation survives failed arming; the existing catalog sweep can repair it. Cancellation/expiry do not promise that an external runtime stopped its side effects. A lost response must replay the same key/body, then fresh-read current run/task state rather than treating a historical replayed claim as a renewed lease.

See [issue31 evidence](r2-task-plans/issue-031-execution.md) for exact scope, fixture-only decision/result limitations, migration and remaining gates.

## Local issue35 submission and independent acceptance

The local source now implements Doing→Review submission and Review→Done acceptance; it is not deployed acceptance. Submit ends the exact current native-owned run as submitted with ended_at, clears active execution authority, retains the immutable result and marks the shared scheduler dirty in the same event/history/outcome transaction. Exact task version, fence, lease, runtime proof/presence, epoch, maintenance generation, eligibility and committed artifact associations remain required.

An independent human or native agent with current tasks:review and complete result visibility may accept. Either a matching stable principal or a matching stable agent rejects, regardless of alternate token/runtime or submitter archive. Acceptance has separate immutable actor/result/run/version/time evidence and private reason. It never grants execution or creates an R3 approval. Submission returns the ended Run; acceptance returns null Run/Approval while Task retains the result and latest run.

Cancel-first denies submit. Submit-first cancellation needs the new version and retains history/associations; requeue clears only current result and preserves budget and stable historical attribution. Current authorization still applies to original replay/history/events even after requeue. A lost response never implies a fresh attempt. See [issue35 evidence](r2-task-plans/issue-035-execution.md).
