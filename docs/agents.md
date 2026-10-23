# Agents and external runtimes

Status: Design baseline · Contract revision 0.1 · Implementation pending.

CF Agent Hub coordinates external agents; it does not execute their code or supply an execution sandbox. An agent is a durable workspace participant record. A runtime instance is one concrete process or session acting for that agent. Keeping these identities separate makes restarts, concurrent instances, credential revocation, and task ownership reviewable.

## Identity and authority

| Concept | Purpose | Authorization meaning |
|---|---|---|
| Agent ID | Stable participant identity within a workspace | Commands still require an applicable grant |
| Runtime instance ID | Distinguishes an external process or session | Identifies a claimed run binding; the ID alone is not authentication |
| Runtime proof | One-time opaque secret issued at enrollment | Proves the exact runtime and issuing credential binding on execution commands |
| Work role | Describes intended responsibility | Never grants permission |
| Model or framework metadata | Explains reported implementation choices | Never proves identity or trust |
| Display name | Human-readable presentation | Never used as a lookup key for authorization |
| Native credential | Authenticates a workspace-scoped principal | Bounded by its current grants and revocation state |

A static R1 participant is provisioned by the deployment operator. R2 adds planned dynamic agent enrollment and native credentials. A profile cannot enroll an agent, rotate a token, or change a runtime's scope. Exact operations and required grants belong to the [HTTP API](http-api.md); security policy belongs to the [security model](security-model.md).

Native credentials are opaque bearer values, revealed once and stored by the hub only as verification hashes. An external runtime must obtain its credential through an authorized provisioning flow and keep it in its own secret store. The browser must not persist native agent credentials in localStorage. Operators must be able to revoke or rotate credentials without renaming the agent. Rotating a credential is distinct from changing a workspace's signing or encryption secrets.

## Runtime participation flow

Enrollment with an active native credential returns a server-owned runtime identity and a one-time opaque `runtime_token`. The hub stores only its verification hash, bound to the workspace, agent, runtime and issuing credential. Execution mutations and runtime heartbeat require both the active native credential and `X-Runtime-Token`; readable IDs and fences are insufficient. If the one-time enrollment response is lost, replay reveals no secret again and the client enrolls a fresh runtime. A runtime reads only the work its grant permits. It may claim a Ready task only if the state, task version, eligibility, WIP rules, and grant checks all pass atomically. A successful claim creates a run bound to the agent and runtime with a lease and monotonic fence. Reading a task or receiving a notification does not claim it.

While working, the runtime renews its lease and persists its own external progress responsibly. A heartbeat changes run lease or revision information; it must not change the task version or proposal version. The current fence is required for owner-sensitive commands. The hub denies stale owners after expiry, cancellation, reassignment, or a newer run.

On a valid result submission, the task moves to Review and the lease is released. An independent authorized reviewer accepts the result before Done. Neither the submitting principal nor the submitting agent can accept that result, including through a different runtime instance. An independent native reviewer may accept only when its grant permits; human-only approval decisions remain a separate operation. A request for a human decision records a checkpoint, moves to Waiting, and releases the lease. Approval of the matching proposal makes the task Ready for a new claim; approval does not resume a process or reinstate an old fence. See the authoritative [task lifecycle](task-lifecycle.md).

## Presence, delivery, and wake-up

The interface must distinguish registered, recently observed, working, and stale runtime information. Presence is an observation with a server timestamp, not a claim that a process is healthy or available. The presence expiry and lease recommendations belong to [limits](limits.md). An agent with no active runtime can remain registered.

Notifications are at least once. A runtime must deduplicate notification deliveries and then read authoritative state before acting. Transport success and ACK describe delivery handling; neither completes a task. External effects require the runtime's own durable deduplication and reconciliation because the hub cannot promise exactly-once execution outside its transaction boundary. See [delivery semantics](delivery-semantics.md).

An MCP connection is an adapter session and does not wake a runtime. Operators must arrange an external scheduler, long-running worker, or explicitly permitted notification receiver. A dynamic callback destination requires the deployment's egress policy; agent-provided URLs must not become unrestricted server-side requests.

## Failure and recovery

When a known failed attempt or an expired attempt explicitly classified replay-safe by trusted policy before execution is eligible for retry, the task returns to Ready only if bounded retry remains; otherwise it returns to Backlog with a visible failure flag. An operator should inspect the last checkpoint, external-effect evidence, current run, and audit history before retrying. A task's eligibility for retry is not proof that an irreversible external action is safe to repeat. Lease expiry without that prior safety classification is uncertain by default; the server applies the hold, because the expired runtime has no authority to report a state mutation. An unknown external outcome creates an `outcome_unknown` Backlog hold and cannot be scheduled or claimed. The `retry_exhausted` hold is also ineligible. This baseline has no silent hold-clear operation; reconcile external effects before creating reviewed replacement work with linked provenance.

After losing a command response, retry the same request with the same idempotency key. After a conflict or stale fence, stop owner actions and reread current task and run state. Credential revocation must block subsequent commands even if a runtime still believes it owns a run. Recovery must use current authorization and a fresh valid claim, not a cached credential or fence. Rotation invalidates the proof issued under the predecessor credential. Drain or reconcile its active work, enroll a fresh runtime under the replacement and obtain a new claim; there is no implicit transfer of an active run.

## Acceptance criteria

Concurrent claims must produce one owner. A restarted instance must not inherit a different instance's fence. Revoked credentials and wrong-workspace requests must fail. Presence expiry must be distinguishable from task failure. Repeated delivery must not create duplicate task transitions. A forged work-role or model label must not widen access. Result acceptance must reject the submitting agent, and approval must require the current authorized human and matching proposal.
