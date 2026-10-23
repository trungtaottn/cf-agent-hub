# Product overview

Status: Design baseline · Contract revision 0.1 · Implementation pending.

CF Agent Hub is a self-hosted coordination workspace for one person or a small team working with multiple external agents. The product owns the record of work: what was requested, who currently holds execution authority, which human decision is pending, what evidence was submitted and who accepted it. Agents may use different models, frameworks and tools as long as they follow the same contract.

## The problem to solve

Messages alone leave important questions unresolved. A successful webhook may only mean a receiver accepted a notification. An agent process can stop after performing an action but before reporting it. A human can approve an old proposal while another actor edits the task. Several agents can believe they own the same work. A dashboard can display attractive but stale or synthetic progress.

The hub makes these boundaries explicit through durable tasks, version checks, time-bounded claims, decision records, committed artifacts and independent review. It does not promise exactly-once effects in external tools. It provides enough durable state and evidence for runtimes and people to detect uncertainty and recover deliberately.

## People and clients

| Participant | Primary job | Authority boundary |
| --- | --- | --- |
| Workspace owner/operator | Provision a workspace, configure trust and recover service | Deployment and policy control; not implicit ownership of every runtime action |
| Human member | Capture work, inspect evidence, decide proposals or review results according to role | Verified membership and explicit command grants |
| Logical agent | Represent an authorized automation identity and capabilities | Workspace-scoped grant; display name and model do not authorize |
| Runtime instance | Connect on behalf of an agent and execute a claimed attempt | Active credential, runtime binding, lease and fence |
| Reviewer | Assess a submitted result | Explicit review scope and independence from the submitter |
| Adapter/connector | Translate a protocol or integrate an external source | Cannot expand the caller's permissions |

The first implementation can serve a personal workspace without removing these boundaries. A single human can operate it and use multiple logical agents; that human may review agent results. Later team support adds memberships and invitations to existing workspaces rather than inventing a second security model.

## Core work loop

Work begins in Backlog with intent and optional project/work-role references. An authorized scheduler makes it Ready. An eligible agent/runtime claims it atomically and receives a run lease. If a human decision is required, the agent checkpoints and yields authority; approval of that specific proposal returns the task to Ready for a fresh claim. The agent submits a result and committed evidence to Review. A different authorized reviewer accepts the result as Done or sends it back for revision.

Messages and threads provide context throughout this loop. Delivery and ACK records explain whether context was received; they do not change task completion. Failure, expiry and cancellation remain visible rather than being converted into a successful final state. [Task lifecycle](task-lifecycle.md) defines the exact transitions.

## Product principles

**One authoritative state model.** The board, CLI and protocol adapters call the same commands. UI conveniences never introduce alternate lifecycle rules.

**A neutral starting point.** New workspaces have empty project/work-role catalogs. Branding and useful example profiles are explicit configuration, not embedded assumptions about one person's workflow.

**Trust is separate from presentation.** A profile may rename a label or hide a navigation entry. It cannot grant membership, change token scopes, disable approval rules or redirect a workspace's storage.

**Visible uncertainty.** Offline, stale, unauthorized, empty and failed are different states. The product must show them distinctly. Connector content needs provenance and freshness before it can be described as live.

**Evidence before availability claims.** A route in OpenAPI or a page in the UI is a specification. The release matrix advances only after implementation and verified scenarios exist.

## Scope by stage

The foundation provides reliable relay semantics, typed configuration and truthful read views. Durable agents/tasks/runs and the native API/CLI form the next core. Human decisions, composition and an MCP adapter follow that core. Team workflows, A2A and additional real integrations come after their security and recovery dependencies. See the [roadmap](roadmap.md) for gates and the [feature matrix](feature-matrix.md) for per-capability evidence.

This baseline excludes hosted model execution, a code sandbox, billing, automatic tenant creation, cross-workspace task transactions and arbitrary external tool execution through the hub. Those can be separate future proposals with explicit operational costs and security boundaries. They are not hidden promises of the initial release.

## Success criteria

A useful first durable-work release lets an operator set up a neutral workspace, enroll two independently scoped agents, complete a task with independent review, recover a lost notification without duplicating work, reject a stale owner, and restore retained state with auditable evidence. It must be understandable from the documentation without private deployment knowledge. These are acceptance goals, not measured achievements.
