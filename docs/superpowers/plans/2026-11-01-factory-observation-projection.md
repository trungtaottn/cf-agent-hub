# Factory observation projection implementation plan

Status: local UI source implementation and listed local checks complete; supported browser, visual and live-pilot acceptance pending.

**Goal:** Integrate bounded reported paths into the existing Factory surfaces without changing authority or execution semantics.
**Architecture:** A two-slot Factory-only controller plus pure semantic rendering. Existing service/session/task/action ownership remains authoritative.
**Spec:** [Technical design](../specs/2026-11-01-factory-observation-projection.md).
**Plan provenance:** SHA-256 `af998b9696a886328668882e9c033e60c3510857f0b03edb07a36889b6da212e`.

## Batch1 — controller

Files: src/ui/factory/observation-reads.ts, test/ui/factory-observation-reads.test.ts, test/helpers/runtime-suites.ts.

- [x] Write and execute failing controller cases C1–C10: explicit two-task bounds; unchanged-update idempotence;2000ms serialized polling; independently authorized historical task/run/report reads; pinned pagination; lifecycle/callback races; section-local data purging; empty/retained distinction; bounded malformed-response rejection; no cross-session ordering; authority-before-read.
- [x] Implement FactoryObservationReads using existing DTOs, BrowserReadRequest and ReadModel. Keep one current page per slot and one queued intent. Bind cursor/session together. All non-user clearing after binding requires explicit restart.
- [x] Execute focused tests, types and full Node suite. Freeze exact diff and review before UI integration.

## Batch2 — actual UI integration

Create src/ui/factory/observations.ts, test/ui/factory-observations.test.ts and test/ui/factory-observations.spec.ts. Modify explorer.ts/app.ts; use existing styles.ts for wrapping if needed. Register new Node tests explicitly. Narrowly extend TaskReads.forgetTask's reason parameter, preserving NOT_FOUND default and existing generation/redaction behavior.

- [x] Add failing DOM cases for three-surface integration, exact inert paths, private-edge removal, advisory overlaps, independent clocks/coverage/history and accessible page controls.
- [x] Wire controller lifetime to actual app selection, current authority, navigation, visibility and connectivity. Dedicated optional read failures must not broaden existing board failure behavior. Actual task403/404 redacts matching canonical detail/card/filter/picker data only after lifecycle fencing; transient503 does not declare independent data unauthorized. Under the same current denial fence, discard the whole global activity cache, invalidate its pending model generation and reset eventCursor so navigation to Activity cannot revive denied data; independent message-thread access is not inferred from task denial.
- [x] Extend scripts/start-ui-test-server.mjs and test/helpers/r2-ui-fixture.ts with isolated synthetic service-backed observation setup. Positive tests use actual B1 authenticated ingress; fault/delay interception is negative evidence only.
- [ ] Execute real-session browser cases for explicit two-task reads, replacement/retention/pinned-empty continuity, optional503/403, principal/workspace/captured-project privacy, delayed callbacks, fresh-session preparation after optional403, polling pause/serialization and accessible narrow/reduced-motion layout.
- [ ] Inspect sanitized desktop/narrow screenshots; run types/generated/build/runtime, full applicable check and real browser suites on exact revision, then independent complete-diff review. Record absent prerequisites as pending, not pass.

## Review focus

Delayed old actors must not restore protected data or erase new state. Optional503 must not reuse generic stale report caching. No error/empty/scope restoration silently resets a bound session. Two task pages are independent snapshots, not a workspace count. Existing actions must use fresh authority after client403 clears CSRF.

Report requests require both read scopes; bounded independent task/auth revalidation may continue under tasks:read alone while reports are unavailable/held. Late callback redaction additionally verifies the same host authority/connection/principal context, including cross-tab connection changes.

No publication, deployment, live configuration, credentials, hook installation, owner operations, content fetch or browser-security changes are part of this source plan. Source completion does not establish live pilot or release acceptance.

## Current evidence and remaining checks

The controller checkpoint has actual RED→GREEN tests and independent focused review. Integration adds actual app-body session/CSRF checks, dual delayed task-list/activity publication redaction, stale comparison callback rejection and cleared-task provenance rendering. DOM tests cover the three real Factory surfaces, not a separate demo. A source-only type correction to a test callback is not new product behavior.

Run `node scripts/start-ui-test-server.mjs --self-check-observations` for the isolated service-backed observation fixture, then the actual Playwright specs when the supported browser exists. The service self-check separately asserts append eviction, retained history, captured-project filtering, replacement loss and explicitly simulated diagnostic-row disappearance. Local Playwright launch currently fails before test bodies because the pinned browser executable is absent; screenshots and visual inspection remain pending. No browser installation or security-setting workaround is included.

## Local checkpoint closeout

Source checkpoint: `341b7f6a13307ee9ac598f771eae7f193a155325`, tree `000a0817fc27aba1f68ee785f39b7cd03b321c84`. Fresh terminal results on this source are Node2515/115files, Workers1984/4 intentional skips, adapter167/11files, native source2834/34 protected-custody skips and preview20. All six typecheck scopes, separate adapter types/build, generated contracts, artifact/anchor bindings, R1 contract, UI build, schema18 runtime boot, docs/plans and actual isolated observation fixture checks pass. Native build/import identity remains unchanged; no installed host executor or protected native conformance was invoked.

The final callback regression exercises actual app callback bodies through the real structural Factory DOM, including detached primary A→B→A controls, same-primary rerenders and host authority/connection/principal changes. A render generation is captured after synchronous controller reconciliation, so nested renders cannot install incorrectly current controls. Existing task/current-page checks remain in place.

The two browser/visual checkboxes above intentionally remain open. Fifteen scenarios compile/register, but test bodies, desktop/narrow screenshots, keyboard/focus and visual inspection require a supported browser. Initial11 missing-executable launch failures are not behavioral test results. No browser installer, security bypass, publication, live configuration, credentials, actual hooks or pilot activation was performed.
