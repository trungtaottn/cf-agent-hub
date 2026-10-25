# CF Agent Hub

Status: R1 source candidate · Contract revision 0.2 · Isolated acceptance pending; no released artifact.

CF Agent Hub is a self-hosted coordination project for people and external AI agents. The R1 candidate provides authenticated durable messages, recipient inbox/ACK, bounded thread/activity reads, a neutral browser dashboard, policy-preserving settings and protected logical SQL recovery. Tasks, Kanban execution, runtime claims, human decisions, artifacts and protocol adapters belong to later release gates.

The repository contains reviewable Worker/client/operator source, a locked toolchain, executable local tests and the broader product contracts. **R1 has not passed deployed release acceptance.** Real isolated identity/operator journeys, complete toolchain review and the exact release evidence gate remain required. The [R1 implementation page](docs/r1-implementation.md) maps source to checks, and the [feature matrix](docs/feature-matrix.md) records attained capability status.

Coding and automation contributors: read the repository-wide [AGENTS.md](AGENTS.md) before working on issues, code, branches, CI, or release state. [AGENT.md](AGENT.md) is an alias entry point, while [docs/agents.md](docs/agents.md) describes product runtime agents.

## Start here

| Your goal | Reading path |
| --- | --- |
| Verify the R1 source candidate | [R1 implementation and acceptance](docs/r1-implementation.md) → [Toolchain](docs/runbooks/toolchain.md) → [Recovery](docs/runbooks/r1-recovery.md) |
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

`src/` contains the R1 Worker, workspace domain/storage, browser UI and recovery implementation. `workers/operator/` contains the separate authenticated operator gateway. `packages/client/` contains the browser contract client, while `test/` contains Node, Workers, operator and browser suites. `scripts/` contains build, contract, operational and evidence verification tools. `docs/`, `spec/` and `examples/` retain the product contracts and explicitly synthetic fixtures, including later-release specifications. The historical documentation-package manifest is not a runtime release manifest; [runtime evidence](docs/runtime-evidence.md) binds an actual candidate and artifact separately.

Documentation checks validate consistency of these assets. They do not demonstrate production authorization, persistence, concurrency, protocol conformance or disaster recovery. Those require the runtime evidence listed in [testing](docs/testing.md) and the [release checklist](docs/release-checklist.md).

## License and governance

The package is licensed under [MIT](LICENSE), copyright 2026 `trungtaottn`. Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md). Security reporting and the distinction between a design package and a supported service are described in [SECURITY.md](SECURITY.md). No deployment account, private credential or personal workspace content belongs in this package.
