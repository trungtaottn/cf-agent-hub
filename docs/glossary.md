# Glossary

Status: Design baseline · Contract revision 0.1 · Implementation pending.

These terms carry specific meanings throughout the proposed contract. Labels displayed in a profile may change; the underlying meanings may not.

| Term | Meaning |
| --- | --- |
| Workspace | Operator-provisioned coordination and authorization boundary with stable identity |
| Principal | Authenticated stable identity; a human is identified by verified issuer and subject |
| Membership | A human principal's relationship and permitted role within a workspace |
| Grant | Authorized scopes and constraints evaluated for a command |
| Credential | Secret-bearing proof used to authenticate; rotation does not change agent identity |
| Logical agent | Registered automation identity with declared capabilities and workspace scope |
| Runtime instance | A particular external process/client enrolled on behalf of an agent |
| Runtime proof | One-time opaque runtime secret bound to its workspace, agent and issuing credential; required with native authentication for execution |
| Presence | Recent runtime communication; it is separate from task execution authority |
| Work role | Classification of work and eligibility hints; it is not an authorization role |
| Task | Durable intent, lifecycle and accepted outcome of a unit of work |
| Run | One execution attempt bound to a task, agent, runtime, lease and fence |
| Claim | Atomic command that assigns an eligible Ready task to one current run |
| Lease | Server-side deadline on execution authority, renewable only while valid |
| Fence | Monotonically increasing task-scoped ownership value rejecting stale attempts |
| Checkpoint | Bounded progress/evidence recorded before yielding execution for a decision |
| Proposal | Specific versioned action/scope submitted for human approval |
| Approval | Human decision record bound to the current proposal and task versions |
| Result | Submitted summary and committed evidence waiting for independent review |
| Acceptance | Authorized independent review that moves a task from Review to Done |
| ACK | Recipient acknowledgment of a message; it does not accept a task result |
| Outbox | Durable pending external notifications created with a domain transaction |
| Delivery attempt | One transport attempt for a stored notification identity |
| Idempotency key | Client-provided command replay identity scoped to workspace, principal and operation |
| Request fingerprint | Canonical representation used to detect a changed payload under the same key |
| Version conflict | A mutation based on stale resource state; requires reread and intent review |
| Artifact | Bounded evidence bytes with staged/uploaded/committed metadata and access checks |
| Event | Append-only evidence of an attributed domain action and resulting versions |
| Profile | Portable presentation/project/work-role configuration with no security grants |
| Policy | Workspace-controlled rules that constrain authorization and behavior |
| User preference | An allowlisted appearance choice for one authenticated human |
| Connector | Integration with a specific external system, permissions and source provenance |
| Adapter | Protocol translation over the same native domain and authorization rules |
| Specified | Behavior documented but not claimed implemented |
| Verified | Implemented behavior has reproducible evidence for a particular revision/environment |
| Release gate | A set of dependent capabilities and evidence needed before promotion |

Exact state transitions are in [task lifecycle](task-lifecycle.md); wire fields are in [HTTP API](http-api.md). If a client uses “complete” ambiguously, it must clarify whether it means delivery, execution submission or independently accepted Done.
