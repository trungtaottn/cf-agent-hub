# R2 Issue 21 — Specify bounded import plans and confidential literal search

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

Implement only issue #21; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** BLOCKED — #17 Verified R1 plus named prerequisites must be satisfied before implementation.
**Hard:** #17, #19. **Interface:** none additional. **Evidence:** none additional.
**Branch purpose:** plan delivery only. Reconcile accepted dev and predecessor code at future pickup.

## Task #21 — Freeze import and literal-search contract amendments

### Summary / problem
OpenAPI already proposes search but does not encode the full bounded import amendment. Close contracts before consumers invent overwrite rules or readable pagination.

### Proposed flow and scope
Review closed ImportBatch → immutable ImportPreview v1 → explicit ImportApplyRequest → ImportReport v2. Human imports:manage + tasks:read are required; apply additionally needs tasks:create, verified session/CSRF and explicit idempotency. No native human impersonation, live connector, imported authority or Task DTO provenance additions.

### Touchpoints and interfaces
Modify `spec/openapi.json`, `docs/http-api.md`, `docs/limits.md`, `docs/data-model.md`, `docs/security-model.md`, `examples/http/fixture-map.json`; create `spec/import-batch.schema.json`, `examples/imports/reconciliation.json`, `test/contracts/r2-import-search.test.ts`.
Produce the exact schema names ImportBatch, ImportPreview, ImportApplyRequest, ImportReport and search parameters consumed through #23's generated aliases.
Rows: external_id, nullable UTC source_updated_at, title/description, project_id/work_role_id, source_state, nullable inert source_ref; namespace/external IDs ≤128 characters, revision ≤256, state ≤64, source_ref ≤2,048. Reject unknown authority-bearing fields.
Apply binds expected_import_version, preview_sha256 and accept_rejected_rows. Preview counts use create; report counts use created. GET returns a closed discriminated union.

### Acceptance criteria and TDD
- [ ] Write `import_bounds_and_closed_rows`: 100 accepted / 101 rejected; 65,536-byte envelope accepted if otherwise valid / 65,537 rejected; nullable/valid UTC accepted, invalid timestamp rejected; owner/credential/approval fields rejected.
- [ ] Write `preview_report_discriminants_and_counts`: version1 preview versus version2 report; counts partition received; false partial acceptance with conflict/rejected rows maps to INVALID_STATE.
- [ ] Write `literal_search_contract`: percent, underscore, quotes, NFC-equivalent Unicode, exact query byte/snippet code-point/scan limits; no total or hidden frontier fields.
- [ ] Run `npm test -- test/contracts/r2-import-search.test.ts`; expect nonzero discovered tests and meaningful failures against missing amendments, not an empty-suite pass.
- [ ] Amend schemas/fixtures/docs, then use existing generators through #23's serialized integration.
- [ ] Run the focused command, `npm run verify:generated`, `npm run check`, docs/plan validators. All selected cases must pass; no endpoint implementation is implied.
- [ ] Independent schema/security reviewer checks closed fields, deterministic hashes/counts, error non-disclosure and preserved R1 compatibility; commit only this contract amendment after approval.

### Notes / gate
Hard: #17, #19. Interface output: #23/#36/#37. Keep existing issue; no duplicate child needed. Before final contract approval, record mixed-search retention policy with #23 (see #36); do not silently repurpose the message-only floor.


## Handoff contract for every task

Pick exactly one existing issue after its gates clear; read this section, that issue's live body, root AGENTS and producer receipts. State exclusive files before edits. Run the named red test with nonzero collection, implement minimal scoped change, rerun focused and integration checks, then request independent review. Record SHA/base, tests with counts and exit codes, type/schema changes, negative/restart evidence, remaining blockers and next task. A failing required gate pauses downstream pickup; do not weaken tests or claim completion from scaffolding. Keep `ai-handle` distinct from `ready to cook`; none of these plans presently authorizes implementation or promotion.
