# Issue31 local cancellation and requeue execution

Status: Local source complete and independently reviewed; remote draft publication pending predecessor reconciliation. No released implementation, deployed verification or acceptance.

## Authority and scope

Live issue31 is cancellation/requeue, not submission/review. Latest pinned plan `cf070b1a5ff03ef48076e5af3c49c54dc5a134a7` and common contract were read with current comments before coding. Base is issue30 local HEAD `4ae6443fbd74cbb68c643291aeca03021a2d1a8b`, tree `31a98b3802e0fe09facb05d5ce3197306602f0d5`. Owner development amendment supersedes historical17 start gate; real acceptance remains deferred, not passed. Local isolated clone has no remote; publication requires predecessor/head reconciliation. No merge, deployment or credential provisioning.

Installed AgentKit vibe1.4.1/CLI2.19.0 plan/research/cook/code-review workflow; no ship/both. Two independent plan reviewers resolved reason insertion ordering, response envelope/replay, dormant pointer semantics and schema ownership. Root granted schema baton for narrow migration11; migrations1–10 and frozenV1/schema8 manifest remain unchanged.

## Comparison and decisions

Before unfamiliar implementation, inspected GitHub source River SQLite job cancellation/retry (`riverqueue/river`, `riverdriver/riversqlite/internal/dbsqlc/river_job.sql`, blob `8ef47178607014f0a581592f43db5d893bf2c04b`) and BullMQ atomic retry (`taskforcesh/bullmq`, `src/commands/retryJob-11.lua`, blob `1beca8088b7aa51d285db0e6445ff5f763cd6a7d`). Reuse the existing synchronous SQL command boundary, not another scheduler or imported state machine. Cooperative external cancellation and retry-budget enlargement are deliberately not adopted. Local fixture/rollback experiments prove only tested semantics, not performance superiority or exactly-once external effects.

## Bounded domain batch

Cancel uses current tasks:cancel authority and complete task/result visibility, not the old owner's proof. Every nonterminal state can cancel; terminal/stale requests cannot write. An active run ends cancelled with ended_at and increased run version, current run/result/approval pointers clear and task version advances. Latest run, fences, retries, flags and immutable result attribution remain. Already-ended submitted/paused/failed/expired runs do not change. External side effects are not undone.

Explicit requeue uses tasks:schedule, current version/reason, Backlog/Review and ordinary policy/reference/eligible-agent checks. Both unknown/exhausted holds reject. Prior current result/approval pointers clear; no new run, history rewrite or retry-budget reset. Ready's stricter existing-pointer behavior is not silently reused for explicit revision.

Cancel/requeue responses intentionally contain run:null and approval:null, allowed by TaskCommandResult; task.latest_run_id and durable run/event/history preserve evidence. Replay validates the full envelope, current operation permission and current/original Task visibility without requiring a human canceller to possess an execution proof. Event/history/outcome and scheduler generation commit atomically. Private reason is inserted by audit writer after event insertion, never in public summary/outcome/log.

## Compatibility limitations

Synthetic Review/Waiting fixtures exercise retained result and dormant pointer compatibility, not real submission or R3 decision-record settlement. Actual submit/accept and both real submit/cancel orderings remain issue35. Artifact runtime remains issue32. No actual approval records exist yet; R3 integration must settle them atomically, retain history and repeat races. Schema11 recovery remains unavailable to the frozen schema7 operational lane.

## Evidence so far

Task-local Node24.22.1/npm11.19.1 and independent locked dependency copy. Meaningful initial migration7 failures became7 passes; domain22 failures became49 domain/failure passes. Expanded domain+schema batch:119 Workers tests across6 files. Additional adversarial cancellation suite35 passes covers unreadable artifacts, current/original visibility replay, archived attribution and retained accepted terminal evidence. Independent storage owner reran10 migration tests successfully. Fresh final verification passed813 Node tests,957 Workers tests,18 operator tests,13 deployment-verifier tests, five TypeScript projects, generated freshness, R1 contract checks, UI build, isolated runtime boot(schema11), docs and plans. The real synthetic OIDC/Worker→DO suite contributes20 passing tests, including issuer/epoch narrowing and physical alarm behavior. Independent final source review reported0 Critical/Important/Minor; a subsequent three-file compatibility inventory delta also received0 material findings. Earlier logs remain historical, not post-change receipts.

## Remaining gates

Exact remote predecessor/history reconciliation, draft publication and remote CI remain blocked/not run. No GitHub writes, merge, deployment, provisioning, release or real credentials were used. Source or fixtures do not establish post-R4 live acceptance.

The first aggregate failed during Workers with tmpfs ENOSPC; the complete Workers suite was rerun successfully with an isolated workspace temporary directory. The initial full suite also identified8 stale unavailable-route assertions; updated tests preserve unchanged R1 grants, canonical valid requests and complete SQL snapshots, and prove authorization denial rather than deleting coverage. The subsequent full957-test suite passed. Real OIDC restart fixtures use the repository’s existing beforeAll initial-eviction pattern to drain JOSE’s bounded abort timer; no timeout or authentication guard was changed.

Recovery CLI was run with its unchanged default temporary-directory environment:8 passed/18 failed, exit1 at protected host `/tmp/.git` repository/artifact guards. No marker, permission or test bypass; aggregate status is not green. Browser assertions were NOT RUN: the exact configured Chromium executable is absent after the predecessor’s official-download integrity failure; no substitute used. Current-schema operational recovery is not proven by historical schema7 tests. Dependency installation was independently copied and byte/inode/internal-symlink verified, not represented as a fresh npm ci; lock unchanged. Fresh dependency audit and live acceptance were not run.
