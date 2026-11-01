# Factory Evidence Explorer acceptance evidence

Status: reviewed-design implementation candidate; aggregate and actual browser acceptance pending.

## Scope and identities

Base: PR137 `cfc42e26044ff596124291ec8f6dacd81c22f495`, tree `bafab04af04650068af0ee70312e4be0b95fe340`.
The original approved design has SHA256 `1467792f91c0e568ef49cf3e5bf2a55d4288f650c69d04cef18f21ce4ce62d80`.
The committed `spec.md` differs from that exact original only by adding accurate pending/no-released wording to its Status line for repository documentation lint. Its requirements are unchanged. The design document itself did not grant implementation; subsequent owner direction authorized Phase A only.

## Reproduction and evidence boundaries

- `npm ci` with the committed lockfile. Local default cache failed because `/home/agent/.npm` was unavailable; unchanged retry using a fresh command-local cache succeeded. No global settings or lockfile changes.
- `npx vitest run --config vitest.config.ts test/client/factory-host.test.ts test/ui/factory-explorer.test.ts test/client/task-rendering.test.ts test/client/task-reads.test.ts` exercises actual host function bodies and structural DOM fixtures. Host RED 6 failures became 6 passes; renderer RED 10 failures/1 pass became 14 passes, then separate profile-provenance RED 1 failure/14 passes became 15 passes. These are not browser layout evidence.
- `npm run typecheck`, `npm run build:ui`, `npm run verify:generated`, `npm test`, `npm run test:workers`, `npm run test:recovery-cli` and repository CI remain required exact-head gates.
- `npx playwright test test/ui/factory-explorer.spec.ts` contains ten real-session scenarios after the independently found optional403/CSRF correction. Initial local collection found seven; the final list is checked separately. Official pinned Chromium download returned an invalid/truncated ZIP; actual launch then failed before assertions because the executable was absent. Local browser assertions are NOT EXECUTED. Do not count collection or fixture-server startup as a pass. Pinned CI must execute them.
- Run documentation validation with the committed `requirements-docs.txt` in an isolated virtual environment; `python -B scripts/validate_docs.py` and `python -B scripts/validate_plans.py`.

## Acceptance map

| Requirement | Evidence path | Remaining gate |
|---|---|---|
| Explicit transient Factory mode and three read-only surfaces | host unit tests; first browser scenario | actual browser CI |
| Six canonical states plus cancelled archive | existing real command fixture; Factory browser | Waiting is explicitly SQL-seeded retained read state, not approval execution |
| Bounded pages, current/historical evidence, no false totals/presence | renderer and TaskReads tests; browser paging and QC | actual browser CI |
| Independent evidence failures and authorization clearing | renderer tests; faulted artifact and revoked delayed-result browser cases | actual browser CI |
| Existing controls remain separately explicit | no action affordances in Factory; deliberate existing-controls escape browser | actual browser CI |
| Hostile text, keyboard, narrow screen, reduced motion | renderer tests and production browser scenarios | actual browser CI/layout |
| No migrations, new routes, grants, adapter or authority | exact diff review | independent review plus exact-head CI |

Phase A is not a live factory observability MVP. It does not implement Phase B telemetry, file conflict enforcement, acceptance-revision binding, loop budgets, approval actions, delegated credentials, merge or deployment.

## Host-boundary review correction

Independent review reproduced inherited whole-session invalidation on optional evidence403. Actual host tests initially failed8/8; bounded host correction keeps artifact/event/run/result403 and profile403 field-local, preserves current401/required-task/workspace/configuration403, and fences stale responses before side effects. Existing commands now fetch fresh session and current workspace before setting a newly observed CSRF token; shared client denial-clearing remains intact. Renderer-only tests never proved this host boundary. Separate browser403 scenarios require exact-head execution.

Original frozen candidate Node2408/108files, full typechecks/generated pass. Original Workers aggregate remains separately tracked; corrections require refreshed Node/typecheck and final full CI. No local browser execution is claimed.

A second review reproduced the generic global event-refresh403 path; exact new regression RED1/14 became GREEN after applying the same section-local event policy. Final local CLI: 29 passed, 18 protected-input/outside-checkout failures retained; no guard bypass. Runtime boot passed with an isolated command-local XDG directory after the default Wrangler log path failed. Corrected Node aggregate before this one-line event repair: 2423 passed/109 files; final exact-head CI remains the aggregate authority.
