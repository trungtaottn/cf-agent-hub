# Implementation plan index

Status: Implementation plan reviewed · Implementation pending.

This directory turns the [release roadmap](../../roadmap.md) into bounded work. Read the [orchestration plan](2026-10-23-release-orchestration.md) first, then the active round. The underlying [feature matrix](../../feature-matrix.md) remains the authority for actual product status: all baseline capabilities are Specified.

## Round boundaries

| Round | Capability IDs | User-visible outcome | Gate before moving on |
| --- | --- | --- | --- |
| [R1](2026-10-23-r1-foundation.md) | F01–F10, F27, F28, F30, F41 | A neutral authenticated workspace with dependable messages and truthful read views | Isolation, bounded inputs, replay/crash/outbox tests, accessible UI and recovery basics |
| [R2](2026-10-23-r2-durable-work.md) | F11–F26, F29, F34, F40 | Multiple external agents coordinate persisted tasks, runs, evidence and independent review | Concurrency/fencing/uncertainty tests, native client parity, Kanban and full restore |
| [R3](2026-10-23-r3-decisions-mcp.md) | F31–F33, F35 | Human composition, versioned decisions and MCP STDIO access | Immutable intent, stale-decision denial, secret-safe client behavior and native parity |
| [R4](2026-10-23-r4-teams-extensions.md) | F36–F39, F42 | Team memberships and individually gated protocol/provider extensions | A reviewed contract and actual acceptance evidence for every enabled extension |

R1 is the first implementation target. A contract amendment task comes before code that depends on missing auth, settings, import, recovery, team or extension shapes. These amendments must update prose, schemas, fixtures and client behavior together; the plans do not silently reinterpret the baseline.

## How a task becomes complete

Each task identifies its files, consumed/produced interfaces, negative scenarios, test commands and recovery boundary. An implementer reports the exact revision and observed results. A different reviewer evaluates spec compliance and code quality before the next dependent task begins. The final round review checks the integrated user journey and the release evidence.

Three statuses must remain separate:

- **Plan reviewed:** the task decomposition and proposed behavior are sufficiently clear to execute, subject to named dependencies.
- **Implemented/Verified:** reviewable product code exists, and the relevant runtime assertions have actually passed for its revision.
- **Released:** the verified artifact and operator runbooks have passed the publication gate and are available as an identified release.

Review never proves that software has no possible defects. A clean review means there is no known blocking finding within its recorded scope. The review record must retain limitations and later contract gates.

## Machine-readable evidence

The plan register and review records in `validation/` describe coverage, task identity, dependencies and planning findings. Documentation/plan validators check structural consistency and traceability only. They cannot verify runtime authentication, durable transactions, external integrations, production availability or recovery behavior.

Before resuming interrupted work, reconcile the execution ledger with the actual checkout and remote state. A task with no exact revision or passing receipt returns to verification; it is not completed from memory.
