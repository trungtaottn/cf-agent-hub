# R2 Source Reconciliation Implementation Plan

Status: Planning amendment pending independent review; R2 implementation blocked.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans for later authorized execution. Checkboxes below describe future work, not completed implementation.

**Goal:** Close #19 with a reviewable, additive source-grounded plan amendment, without implementing R2.
**Architecture:** Preserve the existing Worker → workspace DO → synchronous SQLite command boundary. Extend existing identity, replay, cursor, client, scheduler and recovery owners; never create parallel control planes.
**Tech Stack:** TypeScript, Workers/SQLite DO, private R2, existing pinned Node 24.22.1/npm 11.19.1 and repository test runners. AK 2.18.0-beta.7 authors/validates the planning artifact.
**Spec:** Existing `docs/superpowers/plans/2026-10-23-r2-durable-work.md`, current issue #19 and epic #4; this amendment does not rewrite their historical review identity.

## Global Constraints

- Candidate inspected: `4c8e487eee7b8a3d4f76562ecca2369819aa0a9a`; current dev at intake: `fcbe6139c65f9baafee9804a5c50867a1fcc0968`. PR93 remains unmerged at intake.
- #17 Verified R1 is a HARD implementation start gate, including #20–23. #19 planning has #7 publication as hard predecessor and #9 documentation as interface predecessor.
- #11 embedded dependency findings and #10/#14–18 live acceptance/release remain unresolved. No source CI, plan review, merge or installed-only audit substitutes for them.
- Preserve historical plans, validation register, receipts and approvals byte-for-byte. A new reviewed amendment is additive.
- No implementation, provisioning, credentials, deployment, merge, issue mutations or publication is authorized by this plan document itself.

## Review Focus

1. Old migration0002 collides: check actual schema and allocate next unused version only.
2. Fixture/test file presence does not prove collection: verify intended runtime and nonzero assertions.
3. Dynamic registry must survive install/restore without authority resurrection or a second source of truth.
4. One-time issuance must never persist raw secrets in ordinary executeCommand outcomes.
5. Current-source drift after R1 acceptance invalidates this planning snapshot until reconciled.

## Task #19: Reconcile the published R1 boundary

### Summary

Produce this planning bundle and one review receipt covering every issue19–50, typed dependency, source correction and unresolved contract decision.

### Problem / motivation

Historical R2 plan names migration0002, illustrative recovery interfaces and future npm commands. The actual candidate has migrations1–7, R1-only generated roots/runtime discovery, a functioning browser transport and authenticated operator recovery lane. Blind implementation would collide with storage or silently skip suites.

### Proposed flow

- [ ] Read current `AGENTS.md`, issue19, epic4, source HEAD/dev/PR93 and `docs/r1-handoff-2026-10-26.md`; record immutable refs and whether integration occurred.
- [ ] Compare every original R2 Task1–12 against current files and issue children; classify existing, planned, superseded and decision-blocked in the synthesis and decomposition.
- [ ] Review provisional shared-interface proposals/source mappings to complete #19; do not wait for successor implementation. Actual contract freeze belongs to #20–23 after #19 and #17, and is required before their consumers. Preserve current `ActorContext`, `CommandExecutionContext`, `CommandDescriptor`, `WorkspaceTransaction`, `RecoveryContext`, `RecoveryWorkspace`, `CurrentLedger` imports; do not copy legacy illustrative definitions.
- [ ] Independently review all four subsystem phases plus graph/queue; fix source/documentation errors, record accepted proposals separately from owner-approved decisions.
- [ ] Run planning validators, record exact hashes, then request publication/integration authorization if not already provided. Rebase or recreate this docs-only amendment on final dev without merging PR93 automatically.

### Scope

**In scope:** source reconciliation, 32-child map, ownership, typed graph, future test contracts, review receipt and agent prompts.
**Out of scope / non-goals:** R2 code, actual suite results, new issues duplicating existing ownership, modifying current GitHub queue, changing release gates.

### Acceptance criteria

- [ ] Every issue19–50 has a plan owner and precise future verification, with all existing typed dependencies retained.
- [ ] Every planned source path is marked create/modify; migration is0008 only if schema remains7 at execution.
- [ ] Node/Workers/operator/CLI/browser collection ownership is explicit, and no command is represented as run merely because it appears below.
- [ ] Exact-head review receipt states unresolved decisions and R1 hard gate; no issue is promoted by inference.
- [ ] Historical review files and source code remain untouched.

### Touchpoints

Modify only this new planning bundle and optional new visible index. Inspect `src/storage/{migrations.ts,schema-version.ts}`, `src/workspace/{context.ts,commands.ts}`, `src/http/{dto.ts,cursors.ts}`, `src/config/bootstrap.ts`, `src/recovery/{protocol.ts,table-registry.ts,restore.ts}`, `scripts/generate-auth-contract.mjs`, `scripts/verify-release.mjs`, `vitest*.config.ts`, `package.json` and historical validation register.

### Notes

**Interfaces produced:** no runtime APIs. The produced contract is the issue map, dependency graph, source classifications and proposed interface freeze reviewed under #20/#22/#23.
**TDD applicability:** documentation reconciliation has no behavior change; do not invent a red application test. Validate links/coverage/DAG and deliberately assert all implementation checkboxes remain unchecked.
**Planning verification:** `python -B scripts/validate_docs.py`; `python -B scripts/validate_plans.py`; `git diff --check`; native export `ak plan validate <native-plan-dir> --json` and `ak plan parse <native-plan-dir> --json`; bundle-specific coverage/DAG/hash checks. All must exit0; AK format validity is not semantic approval.
**Definition of done:** independently reviewed source-correct planning artifact, preserved export with checksums and clear pending decisions. R1 acceptance and owner implementation authorization remain required before runtime pickup.
**Reviewer gate:** fresh reviewer verifies graph, all shared boundaries, at least15 factual claims per subsystem and the five failure modes above. Record exact file hashes and findings; no claim of product security approval.
**Commit after authorized verification:** stage only named planning artifacts, inspect diff, commit `docs(r2): reconcile source-grounded agent task plans`; publication requires separate approval.
**Agent handoff:** “Work on #19 planning reconciliation only. Read this phase, synthesis and current issue; compare current HEAD to pinned candidate; stop if runtime implementation or authority mutation is required. Return exact hashes, validation output and unresolved decisions.”
