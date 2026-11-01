# Factory Evidence Explorer Implementation Plan

Status: implementation candidate; full acceptance pending; no released Phase A capability.

> For agentic workers: use superpowers:subagent-driven-development. Each step follows RED → minimal implementation → GREEN → independent review.

**Goal:** Add a truthful read-only Factory mode inside the existing Tasks route.
**Architecture:** Reuse TaskReads and existing source/read-state projections; do not duplicate transport or authority. A new pure DOM projection groups bounded task pages and selected-task evidence. App owns transient mode, filters, navigation and lifecycle reset; existing board/detail command interfaces remain separately opened.
**Tech Stack:** Existing TypeScript DOM UI, Vitest, Playwright and Workers fixture; no dependencies.
**Spec:** [Approved design](spec.md), SHA256 1467792f91c0e568ef49cf3e5bf2a55d4288f650c69d04cef18f21ce4ce62d80. Only Phase A is implemented.
**Base:** PR137 cfc42e26044ff596124291ec8f6dacd81c22f495, tree bafab04af04650068af0ee70312e4be0b95fe340.

## Global constraints

- Existing `/tasks` route, board default, transient Factory toggle; no persisted mode/preferences, database migration, API or grant changes.
- Six canonical states plus cancelled archive; independent pages of 20, selected-task-only detail reads, at most five current-result artifacts.
- Source endpoint/status/time for independent reads; partial pages are not totals; unavailable is not empty.
- No runtime presence, file map, telemetry, verified witness, budget enforcement, new delegation/approval/merge or deployment claims.
- Commands only by deliberately returning to existing task controls; no mutation callbacks in Factory renderer.
- All text inert; no artifact bytes auto-fetch, external HTML or terminal.

## Review focus

1. Optional metadata denied while task reads remain valid: show IDs/unavailable rather than hidden names or false empty.
2. Old responses after selection/logout: no cross-owner resurrection; reuse existing read generations and test host reset.
3. Differing task/run/result/event versions: retain distinct history, never infer current acceptance or current runtime from old evidence.
4. Filtering paged data: clearly page-local, no hidden totals, retain independent pagination controls.
5. Keyboard focus during rerender/mode changes: stable data-focus keys, semantic controls, no graph-only information.

## Task 1 — Read-only projection (worker-owned)

Files: new `src/ui/factory/explorer.ts`, `test/ui/factory-explorer.test.ts`; register test in `test/helpers/runtime-suites.ts`.
Interface: `FactoryExplorer(options): HTMLElement`, consuming TaskReadView, workspaceId, authorized WorkspaceProfile|null, projectId/workRoleId filters, callbacks for filter/select/next/resultsNext/eventsNext/back/openExistingTask. No request/mutation callback.
- [ ] Write failing pure DOM tests for 7 state sections, bounded page labels, project/work-role filter semantics, hostile text, unavailable reads, current/historical evidence and no command callbacks.
- [ ] Observe RED with focused Vitest; implement view reusing taskReadSection/TaskDetail without actions as appropriate.
- [ ] Verify GREEN plus typecheck; freeze exact files for integration. No whole-app edits or commits by worker.

## Task 2 — Tasks host integration and real-session browser proof (source owner)

Files: `src/ui/app.ts`, `src/ui/styles.ts` only if needed; new `test/ui/factory-explorer.spec.ts`; existing fixture helpers only where needed for labelled retained Waiting/history.
- [ ] Write failing host/browser tests: board default; explicit Factory toggle, three surfaces, selected-only GETs, existing-controls escape; no POST from explorer navigation/filters.
- [ ] Wire transient mode/filters and reset on route exit, popstate and authority invalidation; no changes to TaskActions/TaskReads unless independently justified.
- [ ] Add real-session tests for paging, independently denied evidence, delayed old reads after logout/selection, canonical lifecycle plus seeded Waiting, inert names, keyboard traversal, narrow viewport/reduced motion.
- [ ] Verify focused Node/typecheck/build, actual browser where supported; unavailable local runtime is not PASS.

## Task 3 — Review, exact-source evidence and draft publication

Files: plan status and focused evidence README/runbook, no generated status claims.
- [ ] Independent exact-diff review; repair findings with RED/GREEN. Review frozen source against all Phase A acceptance rows.
- [ ] Run generated/docs/types/build and full Node/Workers/CLI/native gates; retain environmental failures honestly.
- [ ] Transfer only named source/tests/docs to existing same-repo CH; verify exact hashes/tree; create stacked draft PR against feature/r3-054-input-verifier, no merge/deploy.
- [ ] Full exact-head CI including real pinned browser must reach terminal. Fix recoverable failures with review, rerun exact head. Source implementation alone is not acceptance.
- [ ] Preserve recovery backup and final acceptance receipts. Phase B remains unimplemented pending B0 review/authorization.
