# Documentation index

Status: R1 candidate documentation · Contract revision 0.2 · Deployed release acceptance pending.

Read this set as a proposed contract for CF Agent Hub. A feature page describes intended behavior; it does not prove that the behavior has been built. The [feature matrix](feature-matrix.md) is the source of truth for implementation status.

## Product and adoption

| Document | Questions it answers |
| --- | --- |
| [R1 implementation and acceptance](r1-implementation.md) | Which source and local checks exist, and which external gates still block verification? |
| [Overview](overview.md) | Who is the hub for, what does it coordinate, and what is outside scope? |
| [Getting started](getting-started.md) | What can be reviewed now, and what must a first implementation prove? |
| [Use cases](use-cases.md) | How do personal work, multi-agent handoffs and team review fit? |
| [Kanban](kanban.md) | What do columns mean, and which actions are permitted? |
| [Customization](customization.md) | How do profiles, projects, work roles and user preferences compose? |
| [Design guidelines](design-guidelines.md) | How should real state, accessibility and failures appear? |
| [Teams](teams.md) | How will memberships, invitations and shared workspaces be governed? |
| [Roadmap](roadmap.md) | Which release gates depend on which foundations? |
| [Feature matrix](feature-matrix.md) | What is specified, and what evidence is still required? |

## Architecture and contracts

| Document | Canonical responsibility |
| --- | --- |
| [System architecture](system-architecture.md) | Component ownership, trust boundaries and transaction scope |
| [Data model](data-model.md) | Entity identities, relationships and persistence invariants |
| [Task lifecycle](task-lifecycle.md) | States, transitions, claims, leases and independent review |
| [Delivery semantics](delivery-semantics.md) | Commit, notification, ACK, replay and artifact consistency |
| [HTTP API](http-api.md) | Native routes, authorization, request/response and error semantics |
| [OpenAPI contract](../spec/openapi.json) | Machine-readable proposed native API |
| [Agents](agents.md) | Logical agents, runtime enrollment and agent lifecycle |
| [CLI](cli.md) | Planned native-client behavior and command contracts |
| [MCP API](mcp-api.md) | Adapter boundary, tools and transport/authentication constraints |
| [A2A API](a2a-api.md) | Future adapter scope and explicit compatibility target |
| [Configuration](configuration.md) | Typed configuration layers, validation and precedence |
| [Limits](limits.md) | Payload, pagination, lease and retry defaults |
| [ADRs](adr/README.md) | Decision context, alternatives and consequences |

## Hosting, operations and security

| Document | Operator responsibility |
| --- | --- |
| [Security model](security-model.md) | Identity, grants, isolation, human decisions and threat boundaries |
| [Deployment](deployment.md) | Prerequisites, environment separation and promotion requirements |
| [Operations](operations.md) | Health, readiness, audit signals, maintenance and incident response |
| [Backup and restore](backup-restore.md) | Coordinated metadata/artifact recovery and rehearsal evidence |
| [Troubleshooting](troubleshooting.md) | Symptom-driven diagnosis and safe recovery |
| [Integrations](integrations.md) | Connector classification, permissions and truthful connection state |
| [Release checklist](release-checklist.md) | Concrete evidence required before public availability |
| [Security reporting](../SECURITY.md) | How to handle security findings without public secret disclosure |

## Contributor references

[Development](development.md), [testing](testing.md), [documentation maintenance](docs-maintenance.md), [glossary](glossary.md), [references](references.md), [contribution policy](../CONTRIBUTING.md) and [change history](../CHANGELOG.md) complete the set. Examples are grouped under deployment/configuration, workspace profiles, native HTTP and task scenarios.

When two pages appear to disagree, consult the canonical responsibility in the tables above and open a contract correction before implementation. Do not select whichever interpretation makes a client easiest to build.

## Implementation plans

Use the [implementation plan index](superpowers/plans/README.md) for the R1–R4 task breakdown, contract amendments, review gates and execution dependencies. R1 has a reviewable candidate; later rounds remain pending and unavailable.
