# D-HISTORY privacy correction (supersedes candidate-filter pagination advice)

Status: Implementation and live acceptance pending; no released capability claimed.  Research comparison supporting the selected authorized-result invariant in [ADR 0008](../../../adr/0008-r2-authority-and-history.md). Proposed 4,096-row and 200-row chunk implementation values below are **not selected canonical limits**; #27 must establish a reviewed finite bound on its actual implementation before activation.

## Decision
Reject public continuation driven by hidden candidates, including fixed-budget empty pages. Use **authorized-result pagination**: TaskResult/Page unchanged; data consists only of completely authorized TaskResults; has_more is true only if at least one additional completely authorized result exists within the fixed submission ceiling. Cursor resumes after the last returned authorized result, never after a hidden scan frontier. A hidden-only suffix cannot create a next page. Current artifact/task permissions are checked on every request inside the authoritative transaction; inaccessible artifacts hide the entire result.

This replaces the earlier proposed lastScanned/empty-page contract and its max201-scanned claim. Those were not safe enough for hidden-total confidentiality. Do not merge the earlier publication contract unchanged.

## Why the alternatives differ

| Approach | Successful API transcript privacy | Correctness/completeness | Runtime bound |
|---|---|---|---|
| Scan requested limit candidates, filter afterward | limit1 reveals exact hidden-candidate count through empty pages | Traverses hidden rows but violates privacy | Simple finite candidate bound |
| Fixed scan budget independent of limit | Reveals buckets of hidden cardinality; strategically placed visible rows narrow gaps | Better amortization, not a privacy fix | Finite per-request scan |
| Opaque separate scan frontier | Encryption hides position value, not number/shape of continuation responses | Same leakage if returned to caller | Finite scan, incorrect privacy claim |
| SQL select only authorized rows, LIMIT limit+1 | Output invariant under insertion of hidden rows; no hidden continuations | Correct visible result pagination | LIMIT bounds output, not work performed by filters/joins |
| Private bounded scanner, publish only completed authorized page | Same successful outputs as authorized SQL | Budget exhaustion can prevent progress on sparse history | Enforceable finite work; failure/timing still leaks coarse operational information |
| Materialized per-visibility index | Potentially bounded authorized seek | Requires correct invalidation for every grant/project/artifact state and restore; stale authorization must still be denied | Additional complex state/control plane; not justified as a shortcut in #20 |

Select authorized-result semantics. Implement with authorized-row SQL only if measured/proven cost bounds hold, or with a private bounded scanner that fails the whole request on exhaustion. **No visible scan cursor fallback.** The interface is independent of physical implementation.

## Concrete bounded implementation fallback, without inventing a DO interruption API

The code owner can implement bounded candidate scans with the existing SQL transaction primitives rather than assume a SQLite progress-handler/interrupt API exists in Durable Objects:

1. Validate current actor, task/project access, cursor and incarnation. Snapshot a submission sequence ceiling on first request.
2. Maintain scan frontier only in request-local memory. Read indexed candidate chunks of at most existing ListLimit maximum200; evaluate current result/artifact predicates (at most five artifacts per candidate) synchronously in that transaction. Accumulate up to requested limit+1 authorized rows; do not serialize anything yet.
3. Complete only after finding the extra authorized lookahead or proving candidate exhaustion below the ceiling. Return at most limit authorized results and cursor anchored to last returned authorized sequence; lookahead is not consumed.
4. Enforce an explicit finite server work budget. Proposed review value:4096 candidate rows per request, at most20480 artifact predicates. **4096 is a new proposed internal guard, not an existing canonical limit or benchmark-selected optimum.** It may be replaced by a reviewed value or proven indexed-query cost bound. Read one final bounded existence sentinel only when needed to distinguish exact exhaustion from budget exhaustion.
5. On budget exhaustion before page completion: sanitized503, no partial data, no continuation, no public progress token, no hidden count or explanation. Do not repeatedly retry automatically; a dense-hidden history can remain unavailable until safe query/index work is improved. This is an explicit availability limitation, not success or full-history acceptance.
6. If byte ceiling stops before requested limit, the next already-authorized fitting candidate supplies lookahead. Cursor remains anchored to last returned result. Never advance through a result omitted only for response size. Oversize single-result invariant error must not cause an empty continuation loop.

The bounded scanner sacrifices availability under adversarial sparse visibility rather than confidentiality via a successful progress stream. A generic503 or latency can reveal coarse resource pressure; it is **not perfect side-channel noninterference**. If requirements prohibit even that observation, a visibility-indexed design with demonstrated bounded authorized queries is required before activation. It is impossible for a finite unindexed scan of an arbitrary hidden prefix simultaneously to guarantee full completion, never expose progress/failure and have cost independent of hidden rows. Neither row LIMIT nor encryption resolves this tradeoff.

## Cursor/ceiling details

- Reuse existing requested limit50/default and1..200 range, existing cursor maximum2048 bytes and absolute3600-second expiry. Preserve exact bounds in integration tests; do not introduce new canonical cursor limits.
- Bind authenticated-encrypted token to workspace/task/query/order/limit, actor/principal/credential/session and authority epoch plus restore incarnation. Use fixed-size/padded encoding if otherwise decimal frontier/ceiling lengths disclose sequence digit lengths. Encrypted payload length can itself leak information; encryption alone does not promise length hiding. Keep encoded token under2048 bytes after padding.
- Fix submission ceiling per traversal so concurrent append is excluded. A fixed-width internal sequence encoding avoids exposing how many digits the hidden global sequence uses.
- Current permissions govern each page, not a frozen grant snapshot. If a previously hidden result behind the last returned sequence becomes visible, a new traversal is required. If lookahead loses visibility before next call, that subsequent page may be empty with has_more=false; it must not advertise a hidden-only continuation. This is real authorization change, unlike stable-policy candidate counting.
- Task loss fails access; artifact loss omits entire result. No totals, scanned IDs, hidden artifact IDs, or hidden frontier. Result-specific retention and restore-incarnation invalidation remain mandatory.

## Counterexample simulations and required tests

`python simulate.py` uses no network or app runtime. It generates results.json for hidden-prefix counts0,1,2,3,4,5,7,8,9,16 with the identical visible results[a,b]. Candidate limit1 produces distinct response transcripts for every hidden count; fixed-budget4 still produces multiple transcripts; authorized-row pagination produces exactly the same transcript in every case. Hidden-only suffix does not create continuation. Permission changes are re-evaluated after last-returned sequence. This is a semantic counterexample model, not proof of SQL/Worker implementation or cryptographic side-channel resistance.

Add actual implementation tests:
- Insert0/1/200/4095 hidden rows before, between, after identical visible rows. For successful traversals, compare data/has_more/page count and padded cursor length (ciphertexts naturally differ). No empty has_more=true page under unchanged access.
- limit1 with many hidden rows cannot count hidden records by requests. Fixed-budget regression fixture must fail the old implementation.
- Hidden-only suffix returns false; all-hidden small history returns one empty terminal page. Budget-exhaustion error has no partial body or progress token and no hidden count diagnostics.
- Current artifact revoke between pages; current task revoke; newly visible earlier result requires new traversal; lookahead revocation produces terminal empty response, not invisible scan progression.
- Concurrent append beyond ceiling; equal timestamp and clock regression; restore with retained static credential rejects old incarnation;2048/2049 cursor bytes; absolute expiry not extended.
- Exactly4096 candidates versus4097 and a visible boundary result; maximum artifact fanout; work-budget errors never become hidden-page responses. Budget values are proposed until contract owner freezes them.
- SQL implementation must prove indexes and actual work/cost under sparse/revoked-artifact distributions. Do not infer physical scan bounds from LIMIT or from this model.
