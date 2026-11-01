# Bounded MCP Source Implementation Plan

Status: Reviewed finite source plan; implementation and acceptance pending.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for task-by-task execution with independent review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add action-independent protected STDIO source without claiming17-tool completion.

**Architecture:** Reuse the native client/provider and journal; a separate nonprunable local journal profile preserves exact caller intent across process restart. Closed SDK transport translates existing operations only.

**Tech Stack:** TypeScript, Node24.22.1, npm11.19.1, SDK1.32.2, existing Vitest/esbuild/SQLite.

**Spec:** [Reviewed design](../specs/2026-11-01-mcp-source-design.md).

## Global Constraints

- No production actions, credentials, enrollment, grants, remote state or publication.
- Legacy local journal compatibility unchanged; MCP profile never prunes and keeps existing hard caps.
- All17 parity, external client certification and issue62–64 closure remain pending.

## Review Focus

- Concurrent processes reuse one original key/clock; conflicts never become fresh intents.
- Old/new local-store profile mismatch fails before journal mutation.
- Retention/cap pressure cannot erase MCP identity; cancellation never implies no effect.
- Protocol stdout/backpressure/input buffers remain finite and secret-free.
- Reserved decision tool, malformed fields and wrong workspace never dispatch.

### Task 1: Dedicated local replay profile

**Files:** packages/cli/src/journal.ts, packages/cli/src/durable-mutations.ts, test/cli/mcp-journal.test.ts and process fixture.

**Interfaces:** JournalOptions.profile?:'native'|'mcp-v1'; Journal.recordOrReuseIntentSync with mandatory suppliedKey. DurableMutationOptions.journalProfile and DurableMutations.prepareOrReuse with required idempotencyKey.

- [ ] Write and run failing profile/reuse/restart/concurrency/cap tests.
- [ ] Add explicit profile guards and atomic lookup-or-insert using existing bounded scan/transaction.
- [ ] Add coordinator path preserving protected binding and original dispatch clock.
- [ ] Run focused tests, existing CLI tests and typecheck; independently review exact diff.
- [ ] Commit bounded source checkpoint, without publication.

### Task 2: Closed SDK transport and launch

**Files:** packages/mcp-stdio/src/, package-local build/config, test/mcp/, docs/contracts/mcp-stdio-tools.json and source evidence.

**Interfaces:** trusted host construction consumes fixed config and existing native custody; SDK server consumes only closed16-tool mapping.

- [ ] Write red registry/config/output tests and built subprocess protocol cases.
- [ ] Implement exact schema mapping, reserved-slot denial, protected launch and finite SDK transport.
- [ ] Exercise actual SDK client and real protected-store chain with synthetic native transport; record every absent live/17-tool gate explicitly.
- [ ] Run build/typecheck/CLI regressions, complete Node suite and independent review; hand off exact commits/tests/blockers.
