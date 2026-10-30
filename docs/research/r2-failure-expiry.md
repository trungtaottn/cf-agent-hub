# Issue 30 — shared alarm and conservative expiry research

Status: Research and local experiments; live acceptance pending, no released capability.

Research timestamp: 2026-10-27 04:38 UTC. Scope: design comparison before implementation, not product acceptance. Read installed ak-research 1.1.3 and ak-docs-seeker 3.1.1. Source checkout inspected: the isolated issue30 checkout, predecessor HEAD `6362ebbd6b63acba02aab946a83fc43111167804`. No dependency adoption or repository code edits performed.

## Recommendation

Extend the existing OutboxScheduler. Keep authoritative deadlines in SQL and one physical alarm, settle each expired run atomically, retain remaining due rows after failure, and reserve separate bounded expiry and outbox work budgets. No new scheduler package, Redis, PostgreSQL, external queue, or retry policy is needed. Captured replay evidence and the issue's unknown-outcome precedence are domain requirements, not properties supplied by a queue library.

## Genuine open-source comparison

1. **Cloudflare Agents (MIT), durable SQLite/lifecycle scheduler.** The repository scheduling guide describes one physical alarm owner choosing among capabilities' earliest wake times. Current source has evolved further: Scheduler submits jobs to Lifecycle's queue rather than owning separate storage. A failed route dispatch can leave a job due; idempotent dedup hits explicitly rearm to repair a lost physical alarm. Relevant inspected code: `packages/agents/src/schedules/scheduler.ts` (header, route dispatch failure handling, idempotent insertion/rearm) and `packages/agents/src/lifecycle/job-queue.ts` (type/API surface). Adopt central alarm ownership and durable pending work; do not transplant its callback execution/retry policy into externally executed task ownership. Sources: [guide](https://github.com/cloudflare/agents/blob/main/docs/agents/scheduling.md), [scheduler source](https://github.com/cloudflare/agents/blob/main/packages/agents/src/schedules/scheduler.ts), [job queue source](https://github.com/cloudflare/agents/blob/main/packages/agents/src/lifecycle/job-queue.ts). Branch snapshots inspected through the web on this date, not immutable commit pins.

2. **BullMQ, Redis atomic stalled-work recovery.** Inspected `moveStalledJobsToWait-9.lua`: checks that the job lock is absent, then requires successful removal from active before incrementing stalled count and emitting a stalled event. Current logic checks whether the repeat scheduler still exists. This illustrates atomic conditional transition and current authority rather than trusting a stale scan. `moveToActive-11.lua` returns the next delayed timestamp when no runnable job exists. Adopt the conditional-transition principle; reject automatic stalled-to-wait semantics, attempt resets, Redis polling/locks, and whole-set scans for AgentHub. Unknown external effects must remain held. Sources: [stalled source](https://github.com/taskforcesh/bullmq/blob/master/src/commands/moveStalledJobsToWait-9.lua), [claim source](https://github.com/taskforcesh/bullmq/blob/master/src/commands/moveToActive-11.lua). Branch snapshots inspected through the web; no runtime benchmark of BullMQ was performed.

3. **Platform contract.** Durable Objects expose only one alarm, repeated setAlarm replaces the previous time, and delivery is at least once. Automatic exception retry is finite; preserving due SQL and rearming remains necessary. Alarm handlers can restart from the beginning. SQLite storage offers transactionSync for synchronous rollback boundaries. These facts favor idempotent SQL transitions and durable repair, not memory-only timer coordination. Sources: [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

## Crash-window and race recommendations (project-specific inference)

- Commit task/run/history/event/dirty marker in one transaction. An exception rolls back all of them. The next alarm must find the same active due row, not charge retry twice.
- In the alarm loop, query and settle within the same synchronous transaction. Do not hold a due-row snapshot over an await and then expire a newly renewed lease.
- Use current workspace admission epoch and maintenance generation on every bounded unit. A same-epoch close/reopen across an await invalidates old work.
- A generation mismatch after setAlarm is not fully repaired merely by leaving dirty=1: a stale later alarm may have overwritten a concurrently earlier deadline. Test bounded immediate reconciliation plus durable fallback wake behavior explicitly.
- Do not allow expiry failure to skip outbox processing. Capture a bounded diagnostic, retain remaining lease work as due, and execute the outbox budget separately under the current fence.
- Keep ties deterministic with `(lease_expires_at,id)`, using the existing `(workspace_id,status,lease_expires_at,id)` index. Per-row bounded units preserve earlier commits if a later unit fails.
- Presence timeout is not a lease; runtime-declared safety is not trusted captured preexecution evidence. No new public ingress activation follows from scheduler completion.

## Measured local query-shape experiment

Ran Python standard-library SQLite 3.53.1 in-memory, 100,000 synthetic rows (1,000 active, 99,000 terminal), existing index shape, 20 iterations per query. Results are host SQLite microbenchmarks only, not Workers latency/acceptance:

| Query | Median ms | Rows materialized |
| --- | ---: | ---: |
| Due active rows ordered deadline/id LIMIT 25 | 0.0065 | 25 |
| Earliest active deadline LIMIT 1 | 0.0013 | 1 |
| Workspace-wide rows then sort | 65.6589 | 100,000 |

EXPLAIN QUERY PLAN used the covering index with workspace/status/deadline bounds for the due page and workspace/status for next deadline. Naive scan required a temporary B-tree for sorting. Data: first 1,000 IDs active with deadline `10000+i`; other rows expired; due cutoff 10500. This supports the bounded indexed option, not a claim about production throughput. Repeat query-plan/rows-read assertions in real Workers tests and add 201 tied due rows, mixed outbox work, rollback, duplicate alarm, restart, and renewal/maintenance races.

## Limits and next steps

GitHub connector direct file reads returned 404 for obsolete Cloudflare root paths; web inspection resolved current monorepo paths. Old BullMQ `-8.lua` path was unavailable; actual current `-9.lua` was inspected. No hidden credentials, code copying, installed packages, external writes, production tests, or dependency changes were used. Freeze plan tests around these crash windows, then proceed through red/green and independent review. Research leaves no design blocker; exact application semantics remain owned by the pinned issue/contracts.


## Actual Workers SQLite query study
The local Workers test uses 201 active plus 1,000 terminal runs. Indexed lease LIMIT 1/25/200 read 1/25/200 rows; earliest-deadline seek reads one. The historical R1 outbox shape exposed a prerequisite gap: 40 pending rows cause 43 reads for MIN(CASE) and 80 for the mixed due query returning 25. Independent work budgets bound returned candidates/transitions, not all inherited SQL work. The boolean replay-safety projection bounds JS allocations and avoids exposing private strings; SQL still inspects admitted values and no arbitrary new evidence-length cap is imposed.


## Larger comparison and selected narrow correction
Actual Workers populations of1,000/5,000/10,000 live outbox rows measured historical earliest-deadline reads1,004/5,004/10,004, claim-selection reads1,702/8,502/17,002 for25 results, and completion reads501/2,501/5,001 for one match. Adding indexes alone retained broad scans. Separate covering source seeks plus bounded selection/hydration measured75 row reads independent of those populations in the candidate study; keyed completion measured one. Coarse timer results are not distributions or production latency claims.

Under the explicit root schema-owner baton, select forward index-only0010 with `(status,next_due_at,id)` and `(status,lease_expires_at,id)`, retaining every earlier migration byte. Production merges two at-most25 candidate subqueries in SQLite, preserving exact BINARY UTF-8 tie ordering rather than JS UTF-16 or locale order. The earliest in-flight seek excludes NULL to preserve original MIN semantics. Completion receives the already-known delivery ID and still checks exact current token, lease and admission fence; no token parsing shortcut or broad token-only index is introduced.

The comparative test explicitly removes only the two new indexes inside its isolated study fixture before measuring historical baseline, then creates test-only candidate indexes. This is not a production downgrade. Final production tests instrument actual transaction SQL, check selection equivalence and unchanged nonselected rows, include non-ASCII ties/NULL leases/mismatched IDs/stale tokens, and report statement counts as well as rowsRead. Index creation on an arbitrary production-sized database is not benchmarked and live migration/recovery acceptance is still pending.

Final production SQL instrumentation: at both1,000 and5,000 mixed live rows, bounded selection/hydration reads101 outbox rows (76 including derived UNION accounting plus25 primary-key hydrations); all SELECTs in the claim unit read318 rows across200 read statements for the tested payload/policy. Single-source1,000-row cases read77 outbox rows; all-pending reads281 overall across187 statements and all-in-flight306 across212. Earliest outbox lookup reads2; keyed completion reads1. The initial100-row test expectation assumed separate JS-merged queries; the SQL BINARY-preserving merge adds derived cursor accounting. The corrected conservative125 selection/hydration ceiling is backed by two LIMIT25 subqueries, exact25 hydrations, query-plan checks and unchanged readings across populations—not a hidden relaxation to allow backlog scans. Seven production-bound regressions pass, including single/mixed sources, exact boundary and requested sublimit, NULL deadlines, Unicode tie order and stale/mismatched callback identity.
