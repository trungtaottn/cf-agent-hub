# R2 contract option study

Status: Implementation and live acceptance pending; no released capability claimed.  Bounded research evidence; authority and authorized-result history directions selected. No runtime, deployed, recovery or release acceptance is claimed.

- [Decision study](decision-study.md): alternatives, inspected source hashes and measured limitations. Its original recommendations remain research history; the dated status and [ADR 0008](../../adr/0008-r2-authority-and-history.md) govern current integration.
- `study.py` and `results.json`: retained synthetic SQLite benchmark with raw samples and query plans. Run `python study.py` from this directory to reproduce; it overwrites adjacent results.json. It uses an in-memory database, no network or credentials, with 100,000 result rows and 400,000 event rows and 75 samples per query. Results vary by environment. No additional run is claimed here.
- `authority-fixture-vectors.json`: proposed semantic verification vectors, not passing runtime tests.
- `SHA256SUMS`: hashes of the retained files and this index.

The benchmark is not application/Workers/auth/crypto/network/R2/restore/concurrency evidence. It does not measure complete authorization-filtered history queries, establish latency targets or prove privacy. In particular, a limit-one filtered traversal can reveal exact hidden counts: merely encrypting the cursor does not solve that problem. The selected invariant now uses authorized-result lookahead and last-returned cursors, not scanned-candidate progress; hidden suffixes terminate. The old benchmark does not prove the required physical-work bounds. No history OpenAPI fragment is activated by copying this research.

The [privacy correction](privacy/recommendation.md), `privacy/simulate.py` and `privacy/results.json` compare successful page transcripts. Run `python privacy/simulate.py` to reproduce the five model assertions; output overwrites the adjacent model results. These are semantic counterexamples, not endpoint tests. The proposed scanner constants in that study are not canonical selections. ADR 0008 requires real bounded-work feasibility and padded cursor lengths before activation.
