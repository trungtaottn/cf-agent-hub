# CF Agent Hub

Status: Design baseline · Contract revision 0.1 · Implementation pending.

CF Agent Hub is a proposed self-hosted workspace for coordinating people and external AI agents. It combines durable tasks, a Kanban view, messages, execution claims, human decisions and reviewable artifacts. A native HTTP contract is the foundation; a CLI and protocol adapters share the same workspace rules.

This package defines the product before implementation. It contains documentation, proposed schemas and synthetic fixtures. It does not contain a released server, a certified client integration or an executable deployment. **Every product capability is currently Specified.** The [feature matrix](docs/feature-matrix.md) records the evidence required to advance that status.

Coding and automation contributors: read the repository-wide [AGENTS.md](AGENTS.md) before working on issues, code, branches, CI, or release state. [AGENT.md](AGENT.md) is an alias entry point, while [docs/agents.md](docs/agents.md) describes product runtime agents.

## Start here

| Your goal | Reading path |
| --- | --- |
| Understand the product and release scope | [Overview](docs/overview.md) → [Use cases](docs/use-cases.md) → [Roadmap](docs/roadmap.md) |
| Review or implement an agent client | [Agents](docs/agents.md) → [HTTP API](docs/http-api.md) → [Delivery semantics](docs/delivery-semantics.md) → [CLI](docs/cli.md) |
| Design the workspace experience | [Kanban](docs/kanban.md) → [Customization](docs/customization.md) → [Design guidelines](docs/design-guidelines.md) |
| Evaluate hosting and trust | [Architecture](docs/system-architecture.md) → [Security](docs/security-model.md) → [Deployment](docs/deployment.md) → [Operations](docs/operations.md) |
| Contribute to implementation | [Getting started](docs/getting-started.md) → [Development](docs/development.md) → [Testing](docs/testing.md) → [Contributing](CONTRIBUTING.md) |

The complete [documentation index](docs/index.md) groups all references. Decisions and alternatives are recorded in [ADRs](docs/adr/README.md).

## Product contract

- **Durable work:** tasks persist independently of browsers, message delivery and runtime processes.
- **Explicit ownership:** an atomic claim gives one agent/runtime a time-bounded execution lease and fencing token.
- **Human decisions:** an authorized human approves a specific versioned proposal; approval never becomes a general permission bypass.
- **Independent acceptance:** submitting a result moves work to Review; a different authorized reviewer accepts it as Done.
- **Personalization with boundaries:** workspace profiles change presentation, projects and work roles; security policy and credentials remain separately controlled.
- **Protocol consistency:** native HTTP, CLI, MCP and future A2A adapters must use the same domain commands and authorization checks.

The hub coordinates external execution. It does not provide a code sandbox or model runtime. Team collaboration and additional connectors are later release gates, with no claim of availability in this baseline.

## What is in this package

`docs/` contains guides, contracts, runbooks and decisions. `spec/` contains the proposed OpenAPI document and configuration/profile JSON Schemas. `examples/` contains synthetic contract fixtures, including neutral and opt-in workspace profiles. `scripts/` contains documentation validation only. The [documentation maintenance guide](docs/docs-maintenance.md) explains how to keep them aligned.

Documentation checks validate consistency of these assets. They do not demonstrate production authorization, persistence, concurrency, protocol conformance or disaster recovery. Those require the runtime evidence listed in [testing](docs/testing.md) and the [release checklist](docs/release-checklist.md).

## License and governance

The package is licensed under [MIT](LICENSE), copyright 2026 `trungtaottn`. Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md). Security reporting and the distinction between a design package and a supported service are described in [SECURITY.md](SECURITY.md). No deployment account, private credential or personal workspace content belongs in this package.
