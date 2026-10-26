# R2 Issue 37 — Apply reviewed import plans without overwriting local work

Status: Implementation pending; planning review and R1 acceptance required.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give authorized users and external agents truthful, bounded access to durable work without duplicating the domain authority.

**Architecture:** Extend the existing HTTP transport, AES-GCM cursor codec, transactional command wrapper and semantic HTML UI. Import previews are immutable plans, not execution authority; the CLI durably records intent before dispatch, while all decisions remain server-owned.

**Tech Stack:** Existing pinned TypeScript, Node 24.22.1/npm 11.19.1, Cloudflare Worker/SQLite DO, Vitest and Playwright. No new UI framework or general-purpose retry engine.

**Spec:** `docs/superpowers/plans/2026-10-23-r2-durable-work.md` Tasks 1, 8–11; `spec/openapi.json`; `docs/cli.md`; `docs/kanban.md`; existing issues #21, #36–38, #40–42, #44–45 and #48. Exact issue snapshots are in `research/issues-clients.json`.

## Global Constraints

- Planning baseline: PR #93 candidate `4c8e487eee7b8a3d4f76562ecca2369819aa0a9a`; `dev` was `fcbe6139c65f9baafee9804a5c50867a1fcc0968`. Re-read the actual accepted baseline before execution.
- All implementation remains blocked by #17 and the named child dependencies. This plan is not owner approval, deployed evidence or permission to change issue labels.
- Preserve one native API/domain command model. Generated canonical DTOs remain snake_case; browser cookie/CSRF and native credential lanes remain separate.
- Import limit: 100 rows / 65,536-byte envelope; preview lifetime 15 minutes. Search: NFC case-sensitive literal matching, 2,048 UTF-8-byte query, 256-code-point snippets, 2,000-candidate maximum.
- Raw credentials/runtime proofs never enter URLs, journal bodies, logs, normal stdout, browser storage or issue evidence.
- No silent retry/new key, automatic conflict rebase, `--all`, production destination, package publication or R3 decision execution.

## Review Focus

1. Revocation during cursor crypto, artifact verification or response preparation must prevent publication; #36/#40 own these barrier tests.
2. A crash between durable intent and key attachment must send nothing; a crash after attachment must reuse the exact binding; #41 owns process-level fault injection.
3. A malformed HTTP success or wrong content type must never become CLI exit 0; #38/#44 test transport and subprocess behavior.
4. A stale board must not let a user accept a different result; #45 pins expected_version, preserves ordinary conflict drafts and requires a fresh action.
5. Imported source text/URLs and hidden references must remain inert and non-disclosing; #21/#37 test authority fields, foreign IDs, literal text and no outbound fetch.

## Observed source and integration ownership

| Current source | What exists | What must not be assumed |
| --- | --- | --- |
| `packages/client/src/client.ts`, `types.ts` | Browser-only `HubClient(workspaceId, {fetch?})`, explicit mutation keys, same-origin cookie/CSRF, canonical result validation and safe errors | No native origin/credential provider/runtime-proof lane, typed R2 facade or CLI package |
| `src/http/cursors.ts`, `read-routes.ts` | AES-GCM AAD binding, current proof re-resolution and final synchronous projection | Cursor operation union is only inbox/thread/events; mixed search retention is not implemented |
| `src/messages/reads.ts` | Current resource filtering, internal scannedIds and message/event retention floors | Its non-event message floor is not a generic task/artifact retention policy |
| `src/ui/read-state.ts`, `write-intent.ts` | Per-section ReadModel and immutable settings IntentWriter with uncertain/conflict states | No task DTO authority or generic task writer yet |
| `scripts/lib/protected-io.mjs` | POSIX owner/mode/nlink/O_NOFOLLOW checks and exclusive fsync publication | Not a cross-platform credential vault or mutable concurrent journal |
| `vitest.config.ts`, `vitest.workers.config.ts` | Existing R1 node and Worker suites | TS CLI, search/import and full R2 acceptance suites are not discovered yet; #23 must add them |

**Shared-file rule:** #23 owns generated roots, enabled-operation/type map, runner discovery and first shared cursor/event plumbing. #21 supplies its reviewed schema change; #36 supplies search integration. #38 owns shared client edits before #42/#44 consume them. #42 then #45 serialize `src/ui/app.ts`, `write-intent.ts`, test server and helpers. One integrator applies shared OpenAPI/docs/package hunks; parallel branches may not overwrite those files.

**Proposed internal interfaces** below are implementation decisions for review, not claims they already exist. Canonical public schemas and operation IDs win; if producers differ, stop and reconcile interfaces before coding consumers.


## Pickup scope and exact prerequisites

Implement only issue #37; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** BLOCKED — #17 Verified R1 plus named prerequisites must be satisfied before implementation.
**Hard:** #27, #31. **Interface:** #21, #36. **Evidence:** none additional.
**Branch purpose:** plan delivery only. Reconcile accepted dev and predecessor code at future pickup.

## Task #37 — Immutable import preview and atomic apply

### Summary / problem
Do not turn external source status or repeated IDs into local updates or active authority. A lost apply response must replay one complete report, not repeat row creation.

### Touchpoints and interfaces
Create `src/imports/commands.ts`, `src/imports/provenance.ts`, `test/imports/reconciliation.test.ts`; integrate existing `src/workspace/commands.ts`, `src/workspace/workspace-do.ts`, `src/http/router.ts`, `src/audit/events.ts`, and owning import docs.
Consume #21 DTOs, #24 registered import tables, #27 task creation and #36 fixtures. Produce:
`previewImport(tx,ctx,batch:ImportBatch):ImportPreview`;
`applyImport(tx,ctx,importId:string,input:ImportApplyRequest):ImportReport`;
`getImport(tx,ctx,importId:string):ImportPreview|ImportReport`;
`getTaskProvenance(tx,ctx,taskId:string):readonly ImportProvenance[]`.
ImportProvenance contains source_namespace/external_id/source_revision/source_updated_at/source_state/source_ref/source_sha256/import_id/task_id; never extend closed Task.

### Proposed flow and invariants
Canonical source hashes and immutable preview are persisted with audit only. Preview creates no task/map. Mapping unique key is workspace + namespace + external_id; unchanged preserves internal ID, changed source conflicts. Apply rechecks human proof/grants, owner/workspace/digest/version/expiry and each reference/mapping version. Explicit accept_rejected_rows permits selected valid new rows only; any execution-time stale reference or failure rolls back the entire transaction. Task/map/report/audit/idempotency outcome commit together. Imported tasks are Backlog without assignment/run/result/approval.

### Acceptance criteria and TDD
- [ ] Write `dry_run_has_no_tasks_or_mapping`, `repeat_preserves_id_and_local_edit`, `changed_source_conflicts_not_upsert`, `every_source_state_becomes_backlog`, `source_ref_is_never_fetched`.
- [ ] Write `false_partial_flag_denies`, `true_partial_flag_creates_reviewed_valid_rows_only`, `duplicate_external_ids_conflict`, `foreign_reference_returns_generic_row_code`, `stale_mapping_after_preview_rolls_back_all`, `expiry_and_digest_mismatch_create_nothing`.
- [ ] Write `crash_after_commit_same_key_replays_exact_report` and `restart_retains_mapping_and_counts`; assert received=created+unchanged+conflict+rejected and task/map delta=created.
- [ ] Run `npm run test:workers -- test/imports/reconciliation.test.ts`; expect bounded contract failures.
- [ ] Implement through the existing synchronous command transaction; crypto precomputation occurs before final current-authority transaction, never network fetch in SQL.
- [ ] Run focused command, #36 fixture tests and `npm run check`; retain rollback and restart receipts.
- [ ] Reviewer checks mapping uniqueness, local-edit preservation, human-only lane and exact replay; commit the complete preview/apply feature.

### Notes / gate
Hard #27/#31; interfaces #21/#36 and storage #24. No live connector or automatic conflict repair. #40 later repeats full isolation; #39 capture must register all preview/report/mapping state.


## Handoff contract for every task

Pick exactly one existing issue after its gates clear; read this section, that issue's live body, root AGENTS and producer receipts. State exclusive files before edits. Run the named red test with nonzero collection, implement minimal scoped change, rerun focused and integration checks, then request independent review. Record SHA/base, tests with counts and exit codes, type/schema changes, negative/restart evidence, remaining blockers and next task. A failing required gate pauses downstream pickup; do not weaken tests or claim completion from scaffolding. Keep `ai-handle` distinct from `ready to cook`; none of these plans presently authorizes implementation or promotion.
