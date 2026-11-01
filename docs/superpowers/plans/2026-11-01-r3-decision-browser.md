# Private generic decision browser fixture implementation plan

Status: Reviewed source implemented; exact-head CI and real-session browser acceptance pending. No released product action.

The plan body retains its original pre-implementation instructions; the current status above supersedes historical progress wording and does not grant runtime authority.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Independent design ACK precedes implementation; source ACK precedes browser acceptance.

**Goal:** Prove the reviewed approval UI against actual generic human HTTP commands, OIDC sessions, CSRF, SQLite and R2, without enabling any production action.

**Architecture:** A separate fixed test-build entry replaces only the resolved `src/approvals/commands.ts` module with a private synthetic composition. The ordinary production entry remains separately built and tested with its empty descriptor registry. No runtime switch, injected registry request field, DTO-shaped approval seed, fake success response, or new DO control API is introduced.

**Tech stack:** Existing esbuild, Wrangler TestHarness, pinned HTTPS OIDC fixture, Playwright and current SQL/R2/public HTTP commands.

**Spec:** Reviewed `docs/superpowers/plans/2026-11-01-r3-decision-app-mutations.md`; parent source-only R3 authorization and reviewer host/app receipts. New isolated worktree base is composed `2e953812` (tree `e7ff8690`); frozen previous branch stays unchanged.

## Global constraints
- Production `action-registry.ts` remains `Object.freeze([])` and production `commands.ts` stays byte-identical. No deployment config/policy/grant modification outside ephemeral test fixture configuration.
- No shared app/client/model changes in this checkpoint. A discovered app defect requires a separate failing test and review.
- Positive fixture is not product support, task.execute_plan.v1 activation, notification delivery, or issue61 acceptance.
- No local Chromium install/launch; actual browser execution through parent-supported CI. Request one global heavy lease for builds/Workers/types.
- Setup session is synthetic and isolated, as existing r2-ui-fixture; browser operator/restricted identities MUST log in through actual pinned OIDC flow and never borrow setup cookies.
- No raw input, cookie, token, CSRF or body in printed receipts. In-memory captured writes wiped at reset/disposal. Public fixture controls expose only fixed actions and sanitized state/counts.

## Review focus
1. Build plugin accidentally affects normal build: assert exact single resolved replacement and normal production metafile exclusion.
2. Positive backend state manufactured as DTO rows: seed task/run/artifact/approval only through actual public commands; only setup session SQL allowed.
3. Unknown response mistaken for failed commit: drop only after actual 2xx body completes and SQL commit is observed; replay exact bytes/key with original OIDC principal.
4. Authority revocation masked by mocked denial: fixture changes current isolated grant rows; actual session/workspace/command response determines UI behavior.
5. Prior-input or stale-view leakage: real bound JSON content, held real response, navigation disposal and completion await, no response fabricated to appear accepted.

## Proposed exact files and ownership
New:
- `test/helpers/decision-browser-composition.ts`: fixed synthetic descriptor and exports of the two factory-created commands. No dynamic registry arguments exported.
- `scripts/lib/build-decision-browser-fixture.mjs`: fixed private build plus normal build exclusion checks; no runtime/environment composition switch.
- `test/helpers/decision-browser-fixture.ts`: Node-only isolated config/setup, finite probe/control class; actual source command producer and bounded receipts.
- `scripts/start-decision-ui-test-server.mjs`: dedicated private harness startup, imports existing pinned HTTPS/environment/bootstrap helpers; no refactor of the current ordinary harness.
- `playwright.decisions.config.ts`: explicit isolated spec match/webserver; current default config unchanged.
- `test/decision-browser/decision-session.spec.ts`: actual private-build session mutation tests; outside default test/ui glob.
- `test/client/decision-browser-build.test.ts`: light static composition/exclusion-contract tests; actual bundling checks run in explicitly leased script self-check.
Modify narrowly:
- `test/helpers/runtime-suites.ts`: one literal new light Node suite registration.
- `.github/workflows/ci.yml` and package command only parent-owned integration after fixture source ACK (request exact ownership then); no silent current CI broadening.
- Plan copied into docs/superpowers/plans in new owned worktree after design ACK.

## Task 1 — Fixed build seam and exclusion (independent checkpoint)
**Interface:** `buildDecisionBrowserFixture({root,outputDirectory})` returns private worker path + normal worker path + sanitized build manifest. Arguments only paths, never descriptor/registry/module override. Resolve canonical commands.ts path once; esbuild onResolve substitutes that exact resolved path, asserts replacement count one. All other application imports use real production sources. Bundle worker ESM with cloudflare:* external and existing SQL text loader. Both builds originate from src/index.ts, preserve actual WorkspaceDO/router/auth/core; neither adds a public route.

Private composition contains one frozen synthetic.task-review descriptor with the same schema, semantic revision, scopes and task target validator as existing test/helpers/decision-policy.ts. A source test compares its descriptor/schema identity to that existing fixture, rather than importing the existing Workerd setup graph into Node. No registry-selection export.

- [ ] Add tests that normal production entry has empty composition and no private import, fixed plugin cannot take arbitrary replacement input, private descriptor exactly matches existing fixture semantics.
- [ ] Capture RED before implementation, then GREEN.
- [ ] Build ordinary and private worker bundles into temporary directories with metafiles. Assert normal transitive graph excludes every private fixture module and test/ path, normal emitted bundle excludes unique synthetic composition marker/action identity, private graph includes exactly one fixed wrapper and commands-source, private graph excludes ordinary commands.ts. Check production source hashes unchanged.
- [ ] Construct TestHarness primary inline config by copying explicitly required current test bindings/compatibility/assets/migrations/export rules from parsed wrangler config, setting absolute private bundled main and absolute dist assets; no build hook recursion. Assert binding projection equality against ordinary test config. Keep recovery-anchor config unchanged. This is test-local config, not deployable wrangler modification.
- [ ] Freeze build source/manifest for independent review before enabling positive fixture.

## Task 2 — Source-produced state and finite transport probe
**Interface:** `configureDecisionBrowserFixture(config)` adds only synthetic isolated human read/decide/artifact/task setup scopes, native task/runtime/artifact scopes and the fixed synthetic decision/execution policy. `seedDecisionBrowserFixture({worker,storage,origin,issuer,csrfSecret,nativeToken})` returns sanitized task/approval/artifact IDs and expected byte hashes; secrets never returned to browser. `DecisionBrowserProbe` accepts only fixed reset/drop-next-decision/hold-next-content/release-content/revoke-decide/revoke-artifacts/restore-grants/read-state actions, no SQL/body/registry payload.

Dedicated server reuses existing pinned HTTPS provider, random secrets, signed bootstrap install and real worker bindings. It does not introduce a configurable common harness or broaden existing fixture controls. It emits the existing ready fields required by browser helper. Teardown closes held responses, harness/HTTPS and removes builds. Control requests are same-origin POST, exact one-field schema, <=1024 bytes, bounded read timeout; held operations have deadline and teardown cancellation.

- [ ] Setup creates its one isolated synthetic session using existing documented pattern. All domain state via actual HTTP: enroll native runtime; human create+ready; native claim; artifact stage/upload/commit; request-decision using current run/fence and proposal binding. Input exact JSON references created task ID/version. Assert public versions and SQL state agree; R2 committed bytes/hash agree. No approval/task/artifact row insertion.
- [ ] Use per-test fresh namespace/reset and sufficiently bounded fixed fixture expiry (600 seconds), no wall-clock manipulation. Seed independent approval cases rather than reusing terminal decisions.
- [ ] Probe records only path, key/body digest, attempt number and sanitized result metadata; retains exact request body only in private memory where needed to compare replay, wipes on reset. Drop mode consumes actual successful response, verifies committed SQL status, then raises transport failure; never returns synthetic success.
- [ ] Actual authority negatives use isolated current grants, not route.fulfill denial. For CSRF test, direct browser request with wrong/missing token must reject unchanged state; subsequent UI write must obtain current token. Artifact revocation produces actual denial/redaction, restore current grant, and prepare again; final session refresh occurs after optional reads.
- [ ] Separate normal production harness self-check uses unchanged main and same synthetic setup policy/grants solely in test namespace. A valid actual request-decision returns 503 with exact ordered snapshots unchanged for decision_checkpoints, decision_proposals, approvals, decision_artifact_edges, decision_lifecycle_heads, decision_lifecycle_transitions, decision_notice_intents, tasks, runs, task_history, events, outbox and idempotency_outcomes. It does NOT fabricate a pending approval to claim normal approve/reject browser coverage; existing reviewed Workers source-producer tests cover that narrower empty-registry case.
- [ ] Freeze source and real harness self-check receipts, request independent review. Setup/self-check is not browser evidence.

## Task 3 — Actual OIDC/session browser matrix
All writes flow through real reviewed app except explicit CSRF negative probe; no intercepted approve/reject success and no alternate UI registry. Browser assertions inspect actual final SQL/public state through sanitized fixture controls and real reads.

- [ ] Approve exact bound input: actual login; list/detail; inspect complete JSON; fresh scope/checkpoint/assigned human shown; reason/confirm/send; Ready and approved, task+approval versions +1, same proposal/approval association, run null and one decision event. Count real content completion before Confirm eligibility.
- [ ] Reject metadata-only: actual login; explicit mode/no input bytes; count content requests from mode transition through preparation/confirmation (ordinary earlier detail may have downloaded). Separately reject with content unavailable but authorized metadata; reject -> Backlog/rejected once, same immutable anchors. Ensure no stale approve bytes rendered.
- [ ] Wrong/missing CSRF and unassigned/restricted human: real403, unchanged SQL, no decision event; no native reviewer impersonation. Read-only human gets no mutation controls.
- [ ] Optional artifact denial clears input; restored grant plus new preparation obtains fresh session/CSRF last and real mutation succeeds. Capture request ordering without printing tokens.
- [ ] Committed response dropped: UI UNKNOWN, reason/selection frozen; current read shows terminal state but UNKNOWN persists. Replay uses exactly original body/key/principal and yields original result without another transition/event. Current session refresh occurs immediately before replay; count original+replay only.
- [ ] Current decide grant loss during prepared/UNKNOWN refresh redacts immediately; cannot dispatch/replay. Navigate/logout remain possible; no persisted raw reason/input/body in browser storage.
- [ ] Hold actual R2 content response; prepare synchronously hides old input; navigate away, release, await completion, no late revival or write. Only one content flight; subsequent selection uses new lineage.
- [ ] Parent-supported CI runs private suite separately AND ordinary existing read/session suite. Retain Playwright report/trace/video as configured, sanitized logs, exact source/build manifest. Missing/failed browser is not acceptance.

## Stop / acceptance
Design ACK authorizes only finite build-seam TDD initially. Build exclusion source ACK gates source producer; fixture source/self-check ACK gates actual CI browser scheduling. Report positive private composition vs production503 vs renderer tests separately. No merge/deploy/live grants, no action concept answered. Any need for new runtime registry injection, a DO fixture RPC, broad HTTPS relay, or production API widening stops this design and returns for review.

## Task 1 frozen checkpoint receipt
- Isolated branch `feature/r3-decision-browser`, base `2e9538127e3f1986917d9b7a24a8c8ca3cb9cfde`.
- Light behavior RED: 8 failing / 2 passing; initial missing-module collection failure separately retained, not behavioral proof. Final 11/11 pass; descriptor unchanged from established synthetic fixture.
- Actual normal/private esbuild both exit0. Normal and private each have227 input paths; distinct output hashes `c71bef9fdee426237b38dffc83fb667683b3e5dfd05653107a241e07ddea927a` / `574795aa75662ec47ea42ab5fb31b0c719851381d8a5094cef611acfb5b9780a`. Metafiles and per-source hashes retained in `/tmp/r3-decision-private-build-VPSqSC/decision-build-manifest.json`.
- Root type RED retained: missing untracked nested dependency symlink and test callback types. Narrow corrected root tsc exit0. One subsequent test-only closed-options assertion was added and passed light suite; final composed type gate remains parent-owned.
- New suite already covered by current `test/client/**/*.test.ts`, so no redundant runtime include edit.
- Private harness inline binding/config projection moves with Task2 startup code: it has no executable consumer in Task1. No harness/source-producer/session/browser command has run. Task2 remains gated on exact Task1 independent source ACK.

## Task 2 frozen checkpoint receipt
- New files only: Node-only source producer/probe helper, dedicated loopback pinned-HTTPS harness, focused boundary tests. No application, registry, deployment config, package, lock, workflow or existing harness change.
- Actual UI prerequisite build exit0. Actual private/ordinary harness self-check exit0 at `/tmp/r3-decision-fixture-selfcheck-final.log`; exact source root tsc exit0 `/tmp/r3-decision-fixture-types.log`. CLI is `node scripts/start-decision-ui-test-server.mjs --self-check` after `npm run build:ui`.
- Light 19/19 pass `/tmp/r3-decision-fixture-final-light-green.log`. Meaningful RED receipts retained for initial controls/probe, stale fixture generation, and timeout cancellation returning partial bytes. Timeout now explicitly fences cancellation-as-EOF.
- Actual bridge RED502 traced to Node Request versus Wrangler Undici Request mismatch. Reused existing `worker.fetch(input,init)` bridge rather than relaxing TLS, origin or timeouts. Later normal503 fixture assertion corrected from internal DECISION_UNAVAILABLE to canonical public DEPENDENCY_UNAVAILABLE; source semantics unchanged.
- Self-check proves four pending decisions produced through actual public HTTP domain commands; committed R2 bytes/hash; current setup-human workspace read/decide scopes; immutable checkpoint/proposal/edges/head/transition/notice/history/event associations. Ordinary production request503 compares exact snapshots of all13 listed tables. Setup session deleted before browser readiness.
- Synthetic setup session is NOT an OIDC browser session; HTTPS/OIDC provider self-check and auth-start are separate. Actual browser approve/reject/CSRF/replay/UNKNOWN remains NOT EXECUTED and belongs to Task3 after this checkpoint's independent ACK.
- Fixed drop probe uses existing HTTPS socket-destroy sentinel only after real2xx completion and actual approval status verification; receipts expose hashes/IDs/status, never reason/key/body/session/token. Reset generation fences old response evidence. Content holds and control body reads have fixed5s deadlines; controls1024 bytes, decision capture65536 bytes.
- Inline bindings preserve current test DO/R2/services/export/compatibility and absolute existing UI assets. Synthetic secrets stay only in in-memory inline test configuration; no generated config file contains them. HTTPS listeners bind127.0.0.1 and Wrangler listening URL is asserted loopback.

## Task 3 authored browser checkpoint
- Dedicated `playwright.decisions.config.ts` and `test/decision-browser/decision-session.spec.ts`; workers1, existing30s case/60s startup bounds, exact pinned browser helper, no TLS relaxation or default-suite change.
- `playwright test --config=playwright.decisions.config.ts --list` collected9 actual-session cases. **NOT EXECUTED locally**; missing Chromium remains unchanged. Actual supported CI and independent exact spec review are required.
- Cases cover current frozen approval/metadata rejection, real wrong/missing CSRF403, actual unassigned/read-only human403, artifact-grant race producing real403 followed by fresh final session/CSRF, committed socket loss and exact original replay, current revoke/redaction/logout, held real R2 response and detached callback lineage. Held route handlers forward real pinned GET responses and await completion before reset; no fabricated mutation success.
- Root separately authorized exactly two synthetic visual artifacts: `factory-decision-visual/desktop-confirmation.png` at1280x900 and `factory-decision-visual/mobile-confirmation.png` at390x844. Same actual frozen confirmation, enabled current controls and no mobile root horizontal overflow; actual Send then executes at mobile width. No trace/video/raw credential capture. Root owns pixel review and PNG-only short-retention CI upload; source/listing proves no visual result.
- Final root types queued under parent heavy lease; exact composition includes parent's later reviewed145 error-contract repair before actual CI.
- Task3 review correction: actual artifact403 invalidates list/selection; after grant restoration the test explicitly refreshes approvals and reselects the same current item before preparation. No source weakening or retention of denied selection. Direct valid-CSRF negative probe JSON is typed with canonical AuthSessionResponse; original root TS18046 receipt retained.
- Browser CSRF/assignment negative snapshots specifically compare exposed tasks/approvals/events; do not confuse this with Task2's separate full13-table normal503 snapshot.

## Reviewed deterministic outage amendment

The original one-shot network-attempt count above is superseded. The fixed test fixture now pins approval/action/key/body before dispatch, reserves one in-flight attempt and retains at most 32 receipts. During the injected outage, every matching committed response is dropped; changed intent is refused before dispatch. Explicit `resume-decisions` is allowed only after a verified dropped receipt and with no in-flight attempt. The test then issues one deliberate exact replay, checks exactly one additional successful receipt, and still requires exactly one domain transition. Transport attempts and deliberate UI intents are counted separately, not silently treated as identical.

The genuine HTTPS diagnostic proved one-shot loss followed by a successful explicit same-key repeat; it did not prove Chromium automatically retried the earlier failed tests. Closed status/network-code/digest diagnostics accompany the next actual browser run. The UNKNOWN assertions, current-authority checks and test deadlines are unchanged. Scoped text wrapping retains full inspectable content and the original mobile no-horizontal-overflow assertion; actual browser and pixel results remain pending.
