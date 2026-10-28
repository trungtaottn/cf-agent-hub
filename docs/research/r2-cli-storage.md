# R2 CLI local storage study

Status: Primary-source comparison and synthetic local measurements, 2026-10-27; deployed acceptance remains pending.

The selected policy and limitations are in [ADR0009](../adr/0009-r2-cli-local-durability.md). Actual host: Linux x64, Node24.22.1, bundled SQLite3.53.4, overlayfs. No OS keychain was authenticated; presence of a D-Bus/KWallet executable was not treated as a usable vault. No real credential, dependency install or fresh npm audit was used.

| Candidate | Reasoned trade-off |
|---|---|
| Atomic JSON snapshot | Simple complete publication, but needs separate cross-process exclusion/CAS and rewrites retained content. |
| Fsynced append records | Fast small writes, but needs custom framing, partial-tail repair, CAS, checkpoint/compaction and bounded history. |
| SQLite DELETE + EXTRA | Existing transactional CAS/locking and rollback; selected for correctness/implementation surface, not fastest microbenchmark. |
| OS vault | Stronger platform-dependent possibilities; actual service/unlock/access-control support not established, so no fallback or cross-platform claim. |

GitHub comparisons: [write-file-atomic](https://github.com/npm/write-file-atomic) has a process-local queue, not cross-process CAS; [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile) describes stale-mtime/compromised-lock and SIGKILL limitations; [better-sqlite3 performance notes](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) demonstrate why throughput-oriented WAL/NORMAL choices should not be copied into a pre-dispatch durability boundary. Archived [node-keytar](https://github.com/atom/node-keytar) was not added as a new dependency. [Node SQLite documentation](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) labels the API release-candidate; the exact runtime is pinned.

## Measured comparison

100 sequential synthetic initial-intent writes per case, single process, same local overlayfs. These alternatives do **not** all implement equivalent concurrency/recovery/policy semantics.

| Backend | Body | Total ms | p50 / p95 ms | Final bytes |
|---|---:|---:|---:|---:|
| SQLite DELETE + EXTRA | 1 KiB | 200.084 | 1.929 / 3.284 | 147,456 |
| Atomic fsynced snapshot | 1 KiB | 117.513 | 1.073 / 2.141 | 112,691 |
| Fsynced append | 1 KiB | 37.265 | 0.303 / 0.738 | 112,690 |
| SQLite DELETE + EXTRA | 64 KiB | 223.037 | 2.151 / 3.291 | 6,615,040 |
| Atomic fsynced snapshot | 64 KiB | 806.951 | 8.028 / 14.506 | 6,563,891 |
| Fsynced append | 64 KiB | 84.565 | 0.821 / 1.164 | 6,563,890 |

These figures do not measure power-loss durability, deployed throughput/SLO, full command cost, storage-controller flush guarantees or ext-family/XFS hardware. The first-write benchmark did not itself inject crashes; subprocess SIGKILL, competing writers, SQLiteFULL and corruption tests are separate implementation evidence in [issue41](../r2-task-plans/issue-041-execution.md).

The platform exposes Linux uptime but not usable time-namespace continuity evidence. The implemented conservative process epoch deliberately denies already-dispatched replay after process restart; synthetic verified-clock tests prove logic, not cross-process platform continuity or real suspend behavior. An independent regression held a competing SQLite writer about500ms while a precomputed clock had100ms remaining; old authorization incorrectly allowed a send. Final code resamples after blocking work and uses a final internal clock check at native fetch.
