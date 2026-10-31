# R2 read-only task board design comparison

Status: Local implementation research; browser and live acceptance pending.

## Sources and alternatives

The W3C [ARIA grid source](https://github.com/w3c/aria-practices/blob/main/content/patterns/grid/grid-pattern.html) describes an interactive composite with managed focus. A read-only set of task columns does not need that contract. Use semantic sections, headings, lists and links; CSS grid is presentation only. The [keyboard guidance](https://github.com/w3c/aria-practices/blob/main/content/practices/keyboard-interface/keyboard-interface-practice.html) motivates retaining a meaningful focus target when an observed record or navigation link disappears.

[Playwright actionability source](https://github.com/microsoft/playwright/blob/main/docs/src/actionability.md) and [assertions](https://playwright.dev/docs/test-assertions) support locator-based role/text/focus/visibility checks rather than sleep-based readiness. Authored browser checks are not executed evidence when the exact browser cannot launch.

Three query approaches were compared:

1. A mixed bounded page grouped client-side uses one request, but one state can consume the entire page and make other columns look empty without evidence.
2. Seven separately state-filtered pages cost seven bounded reads but expose independent state, cursor and failure. Selected: six canonical states plus a separate cancelled archive, at most 20 records each. Next replaces the page; refresh resets it.
3. Accumulating infinite scroll retains growing authorization-sensitive observations and ambiguous stale prefixes. Rejected for this scoped read-only view; no browser authority database or automatic all-pages traversal.

## Synthetic cost comparison

Node 24.22.1, 140 synthetic canonical tasks, 10,000 iterations after 100 warmups: seven 20-item canonical validations took 1,941.41ms total; one 140-item validation took 1,748.12ms; grouping 140 tasks into seven states took 34.02ms. Seven response envelopes total 60,042 bytes versus 59,526 bytes for one mixed envelope. These are CPU/serialization microbenchmarks, not network latency, browser responsiveness or an SLO. The chosen extra request cost buys truthful independent column observations; total displayed task memory remains bounded 140.

## Contract findings

Canonical retained task results already exist and must not be invented from the latest run. There is no human runtime-presence GET, so the UI labels presence unavailable and separately identifies an observed lease timestamp. Matching current-result events provide acceptance evidence; absence from a bounded workspace event page is unknown, not a negative conclusion.

The exact `/tasks` route needs all three auth-start/callback enum amendments and SQLite return-path migration16. HTTP-only validation would fail actual login. Frozen schema15 capture continuity is consequently an explicit reviewed prerequisite, not permission to reinterpret historical snapshots or activate restore. See [execution evidence](../r2-task-plans/issue-042-execution.md) and [recovery amendment](../adr/r2-recovery-contract.md#issue42-auth-return-schema16-and-frozen15-continuation).
