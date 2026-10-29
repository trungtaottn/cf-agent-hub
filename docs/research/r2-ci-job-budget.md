# Source job budget diagnosis (2026-10-29)

Status: source CI orchestration study; exact adjusted-head verification pending. Not security signoff or release acceptance.

PR118 run40798780457 source123201580002 ran01:10:33–01:30:35 (1202 seconds). GitHub reports aggregate cancelled while every step, including Complete job, succeeded. The workflow source budget is1200seconds. Browser48passed01:30:21; docs passed01:30:32; cleanup finished01:30:32.686. Exact checkout09c0b428bdd06d3e74b83fbd7267a536e3a80410 treefaf1eac383c1e68a2ca97c4d5e1d95adf19ec35e matches published head. One annotation exists but its text cannot be read through supported connector endpoints; job-budget cancellation is a strongly supported inference, not a quoted annotation.

Comparison: PR119 run40798866937 source succeeded01:11:20–01:30:57 (1177seconds), only23seconds under the same cap. Source1468Node/1691Workers+4skipped,18operator+4currentoperator,13deployment,26CLI,48browser all passed. Exact checkout0a8ae0f79dbf88b573b5b661e8a228c2db94b34d tree7ccbe8074ece51079c984bb5f9c6a45a3fb9af8a matches published head.

Minimal hypothesis test: change only source job budget20→30minutes. About50% orchestration headroom over observed20minutes; retains bounded stuck-job cap. All test assertions, per-test deadlines, commands, immutable action pins, permissions, concurrency, dependency checks and release-evidence condition remain unchanged. No retry of denied workflow-rerun operation; new reviewed config commit triggers normal PR checks. No issue40 security gate change. This remains a candidate remedy until exact new-head CI succeeds.

Local YAML semantic equivalence check passed: only jobs.source.timeout-minutes differs. Existing source evidence is retained; no full local suite rerun for a job-envelope-only change.
