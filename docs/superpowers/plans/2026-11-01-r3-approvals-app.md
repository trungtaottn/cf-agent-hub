# Approvals read panel integration Implementation Plan

Status: Reviewed read-only source implementation; exact-head browser and integrated acceptance pending. No product action or release is enabled.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the reviewed exact-input inspection modules in the actual signed-in app without enabling a product action.

**Architecture:** Use existing `/tasks?workspace=…&panel=approvals` shell with an internal Approvals view, not a new auth path/schema/migration. A single existing HubClient owns session/token/read transport. Host view-lifetime and render-callback epochs fence old handlers separately; model read generations do not change on ordinary rendering.

**Tech Stack:** Existing plain TypeScript app/DOM, HTTPS OIDC/Workerd fixture, Vitest/Playwright.

**Spec:** Live issue61, reviewed `2026-11-01-r3-decision-ui.md`, canonical OpenAPI/auth return allowlist. Source units transport877447f..e84a0db and read/inpute84a0db..b44ae02 independently ACKed. Parent owns reviewed generic DO read wiring.

## Global Constraints

- Empty production descriptor registry remains empty. No mutation buttons, action registration, actual grants, native impersonation or fixture authority in production.
- Allowed auth return paths remain unchanged. Signing in from this panel returns to `/tasks`; user then deliberately selects Approvals. No persistence/URL capture of input JSON or reason.
- Nav appears only for a current human with approvals:read/tasks:read and profile visible_views containing approvals. Hidden profile nav does not revoke an otherwise authorized panel deep link.
- Read failures remain separate from successful empty results. The panel states that no action support/execution is inferred from proposals or notification events.
- Any identity/authority/workspace/navigation teardown immediately clears/cancels private observations and invalidates detached callbacks. Offline/cross-tab/pagehide/bfcache transition invalidates preparation and full input, not server writes.
- Real browser execution is supported CI only: local Chromium1248 absent, no download/timeout changes. Node/source and fixture startup evidence are not browser acceptance.

## Review Focus

1. Ordinary render increments a callback epoch only; it must not invalidate an in-flight model read or accidentally re-enable a detached button.
2. Navigating away while access/content reads await clears input and prevents a late 401/403/success from affecting the new panel/principal. Actual shared client denial may clear CSRF; future writes must re-establish session after optional reads.
3. No scopes/no current auth means no approval endpoint calls. Successful current workspace scope revocation removes nav and clears cached approval text.
4. Wrong `panel` query values remain the ordinary task view; approval selection never enters URLs or survives logout.
5. Fixture positive read is a genuinely authenticated empty generic list through the parent DO route, not forged pending rows, descriptor activation or intercepted successful JSON. Private-input/decision journey remains future synthetic-core integration.

## Owned files and exact seams

- Modify `src/ui/app.ts`: import DecisionReads/renderers; add `approvalViewGeneration` and `approvalRenderGeneration`; `decisionBinding` includes current principal/connection/view epoch and online/current internal view; `disposeDecisions` synchronously invalidates model before teardown. `decisionRequest` wraps only approved same-client callbacks with authority/connection/principal/view identity checks and late binary cancellation. `readDecisionAccess` reads current auth session then workspace, correlates both actor/workspace and sets returned CSRF only under the original unchanged binding. No independent client or cookies.
- Internal currentView=`approvals` maps only to pathname `/tasks` plus exact `panel=approvals`. Nav href/popstate/boot/default preference use that mapping; no selected approval ID in URL. Every list/refresh/next/back button captures current render and view/authority/connection/principal epochs, tests them synchronously before invoking the model. `replacePreservingFocus` preserves owned focus.
- Modify `scripts/start-ui-test-server.mjs` with new isolated control `r3-decision-reads`: same baseline install/bootstrap, explicit fixture-only human read scopes (`tasks:read`, `approvals:read`, `artifacts:read`), no decisionpolicy/action schema/no approve grant; do NOT seed DTO-shaped pending approval SQL. Scope-less restricted existing principal remains negative case. Actual generic public route must return an empty bounded list.
- Add `test/ui/decision-app.spec.ts`: actual OIDC login, nav/deep-link/empty response; no-scope route silence; current denial redaction; detached refresh callback inert after nav; held real list response cannot return after navigation/logout; no approve/reject controls. Page.route used only to delay real authorized response or inject an explicit negative transport failure, never forge a positive list.
- Add focused source tests for panel URL mapping/current callback binding in `test/ui/decision.test.ts` only if extraction of a tiny pure helper is needed. No new orchestrator.

## Steps

- [ ] Rebase app-only work from exact parent reviewed integration with HTTP read dependencies and accepted UI units.
- [ ] Write real-session browser tests before app changes; local runner cannot execute (retained missing-browser receipt), require CI run rather than fake pass.
- [ ] Implement bounded app/fixture seams after independent design review.
- [ ] Run root/UI types, focused client/model tests, UI build and actual HTTPS fixture self-check for new read control (if supported by existing self-check runner); no broader parallel suite contention.
- [ ] Freeze exact diff, obtain independent source review, let parent publish/execute supported CI browser tests before any app acceptance claim.

## Independent design closure

Current `getTask`403/404 during decision inspection redacts canonical task board/detail and shared event projections under the original authority/connection/principal/view fence; otherwise a user could leave Approvals and rediscover denied task text in cached Tasks/Activity. Approval/artifact403 remains panel-local (shared CSRF still clears) and does not log out unrelated authorized features. Late stale-view denial does neither redaction nor logout. Extract a tiny pure panel/callback guard helper for executable model tests: exact single `panel=approvals` on `/tasks`, separate view lifetime and paint epoch, no URL/session authority. Extend model lifecycle tests for A→B→A, held binary cleanup and raw-input teardown, since the real empty-list fixture cannot claim those private-input browser paths. Actual browser coverage is explicitly empty-list authenticated host behavior, not the whole decision journey.

## Frozen source verification checkpoint

- Fresh app worktree base `4b12d681abc9a0ac10acd57d17b6234015dfb7b6`; accepted UI units replayed through `eee186c`. Parent public-entry fix `e41fe9b` cherry-picked as `a351ba3`; it is a dependency, not app-owned source.
- Actual new fixture self-check exposed public404 despite DO wiring. Parent's separately reviewed public-entry regression/fix corrected it. Rerun `node scripts/start-ui-test-server.mjs --self-check-decision-reads` exited0: actual shell/public unauthenticated401/empty SQL/no policy/fixture read-scope reset/teardown. This does NOT claim authenticated browser/UI acceptance.
- Same-client host logic is extracted into `src/ui/approvals/host.ts` solely for direct executable integration tests. It snapshots primitive lifecycle fields before await, fences every authority/access/task-denial callback, and cancels late binary responses. The app uses this exact adapter; task denial invokes existing `forgetTask` plus global event model invalidation and cursor clearing.
- Targeted source command `npm test -- test/ui/decision.test.ts test/client/browser-decisions.test.ts --maxWorkers=1`: 68/68 passed (42 model/host +26 transport). Actual red→green includes panel callback binding, active-at-capture guard, stale observation classification and current/late canonical task cache privacy. Root `tsc --noEmit` and browser `tsc -p tsconfig.ui.json --noEmit`: exit0. `npm run build:ui`: exit0.
- Type partitions follow existing UI ownership: new DOM modules/model tests excluded from Workers-root and explicitly covered by unchanged strict DOM config. Browser specs remain root checked using DOM appendChild to avoid the existing Workers Element.append name collision; no ambient types, strictness or declaration checks relaxed.
- Local Chromium remains unavailable; no repeated launch/install. Six actual-session read-panel browser tests and two standalone renderer checks are authored for supported CI. Browser tests do not manufacture positive approval DTOs; they use actual empty generic reads, OIDC session, and only negative/delayed interception. Full private decision/CSRF mutation acceptance is still unimplemented and unclaimed.

### Independent review correction

Reviewer reproduced P2: a successful workspace response with reduced scopes cleared only the Approvals model, leaving canonical task/activity caches ready. The actual app onAccess callback now calls the tested `applyDecisionReadCapabilities` helper under its original current fence. It updates task/event/artifact capability models, clears the global event cursor and invalidates pending event generation on task/event loss, and preserves unrelated still-authorized observations when only approvals scope disappears. Explicit operations:read loss clears its protected projection; task-read loss clears retained task-action private preparation without logging out or erasing unrelated composition drafts/threads. Two new red→green tests cover revoked and preserved scopes, including a late pending event response. The delayed real-list browser test now awaits delivery completion before asserting no revival.

Corrected focused source tests:70/70. Strict UI/root types and UI build passed; browser execution still pending supported CI. This correction is scoped to the new decision-access callback, not a claim that every older app read path has been audited.

### Workspace capability projection correction
Parent integration inspection found that the real workspace response omitted
`approvals:read` from its implemented display scopes, making the read panel
inaccessible despite the installed synthetic grant. Actual Workers regression
`test/approvals/workspace-projection.test.ts` reproduced authorized human 200
without the scope (RED: /tmp/r3-projection-red.log). The narrow projection fix
includes only `approvals:read`, explicitly excludes it for native actors, and
does not advertise `approvals:decide` or alter any grant/policy/schema.
Both actual DO regressions pass: current human scope advertisement and immediate
removal after grant scope revocation; native scope absence (GREEN:
 /tmp/r3-projection-green.log, 2/2).
The fixture self-check remains setup/unauthenticated proof only. Per parent
direction no shared OIDC helper expansion: the six existing real-session browser
specs must verify the complete advertised-capability journey in supported CI.
