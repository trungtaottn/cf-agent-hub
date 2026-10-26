# R2 Issue 36 — Search authorized resources with bounded confidential continuation

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

Implement only issue #36; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** BLOCKED — #17 Verified R1 plus named prerequisites must be satisfied before implementation.
**Hard:** #35, #34. **Interface:** #21. **Evidence:** none additional.
**Branch purpose:** plan delivery only. Reconcile accepted dev and predecessor code at future pickup.

## Task #36 — Authorized bounded search and reusable isolation fixtures

### Summary / problem
Add search over task, message and artifact metadata using existing current-authority and confidential continuation machinery. Search permission alone grants no underlying content.

### Touchpoints and interfaces
Create `src/search/query.ts`, `test/search/authorized-search.test.ts`, `test/helpers/r2-isolation.ts`. Modify `src/http/read-routes.ts`, `src/workspace/workspace-do.ts`, `docs/limits.md`, `docs/security-model.md`; coordinate `src/http/cursors.ts`, message/reference/event helpers with #23/#34.
Consume WorkspaceTransaction, ActorContext, CursorPayload and #23's PageData; produce:
`searchWorkspace(tx, ctx, {q:string,kind?:'task'|'message'|'artifact',limit?:number,cursor?:CursorPayload}):PageData<SearchHit>`.
SearchHit stays exactly kind/id/title/snippet/created_at. Extend the existing binding with operation search; queryHash binds normalized query, kind, limit and sort, alongside workspace/principal/lane/credential/session.

### Proposed flow and invariants
Decode cursor outside SQL, refresh proof in the query transaction, scan a bounded globally ordered candidate set, authorize before constructing snippets, encode continuation outside SQL, then reauthorize/reproject scanned IDs immediately before response with no further await. Preserve existing AAD/key separation. Use globally distinct IDs, (created_at,id) high-water and lastScanned, no total. Empty filtered pages may have continuation.

**Retention integration decision:** #21/#23 review an operation-aware hook before implementation. For search including messages, conservatively expire when the existing proven message truncation floor overtakes the search frontier; task/artifact-only search must not use that floor. R2 retains task/committed artifact history, so do not invent deletion floors absent a reviewed deletion feature. Add a regression that a message-floor update cannot invalidate task-only search. If producers adopt a different reviewed retention contract, amend this interface first; never add a second cursor store.

### Acceptance criteria and TDD
- [ ] Write `search_scope_alone_returns_no_hidden_resources`, `thread_participation_precedes_snippet`, `foreign_project_has_no_counts_or_frontier_leak`, and `null_projects_differs_from_empty_projects`; hidden IDs/bytes/snippets absent from the envelope, and raw base64-decoded external cursor bytes must not reveal hidden IDs. Test-only decryption may inspect the internal frontier; that internal value is precisely what authenticated encryption protects.
- [ ] Write `literal_unicode_and_punctuation_bounds`, `scan_stops_at_2000`, `empty_filtered_page_continues`, `high_water_excludes_later_insert`, `query_actor_kind_swap_and_tamper_reject`.
- [ ] Write `revocation_during_cursor_encode_blocks_publication`, `restart_preserves_authorized_cancelled_history`, `artifact_search_never_reads_object_bytes`, and retention cases above. Instrument candidates examined, not only returned count.
- [ ] Run `npm run test:workers -- test/search/authorized-search.test.ts`; expect named failures and nonzero collection after #23.
- [ ] Implement parameterized queries and current-resource predicates; add fixture builder for two workspaces, restricted grants, fixed threads and separate runtimes without auth bypass.
- [ ] Run focused command and `npm run check`; retain query-plan/scan-count evidence and exact denied cases.
- [ ] Independent reviewer inspects filter-before-projection, no-await final proof checks, cursor confidentiality and finite scan. Commit the bounded search/fixtures deliverable.

### Notes / gate
Hard #35/#34; interface #21/#23. #37 consumes fixtures, not #40's later final matrix. No semantic/regex/content search or complete-isolation claim.


## Handoff contract for every task

Pick exactly one existing issue after its gates clear; read this section, that issue's live body, root AGENTS and producer receipts. State exclusive files before edits. Run the named red test with nonzero collection, implement minimal scoped change, rerun focused and integration checks, then request independent review. Record SHA/base, tests with counts and exit codes, type/schema changes, negative/restart evidence, remaining blockers and next task. A failing required gate pauses downstream pickup; do not weaken tests or claim completion from scaffolding. Keep `ai-handle` distinct from `ready to cook`; none of these plans presently authorizes implementation or promotion.
