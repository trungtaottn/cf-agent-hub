# Artifact protocol research — 2026-10-27

Status: local source experiments; live verification pending; no released capability.

Decision: use the locked Workers DigestStream with serial backpressured writes through FixedLengthStream. No new dependency, whole-body buffer, base64, or tee. Fresh server-generated generation key per accepted write plus conditional create is defense in depth; SQL reservation/current-authority and commit/tombstone CAS remain authoritative.

Sources inspected before product implementation:
- https://github.com/cloudflare/workerd/blob/main/src/workerd/api/crypto/digest.c%2B%2B — incremental digest implementation updates a native context, rather than collecting all chunks. Official API: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/.
- https://github.com/cloudflare/workers-sdk/blob/main/packages/miniflare/src/workers/r2/bucket.worker.ts — condition validated inside object-row transaction before publication; failed condition removes unreferenced blob. Local locked-runtime test is needed rather than assuming historical wildcard semantics.
- https://github.com/tus/tusd/blob/main/pkg/s3store/s3store.go — separates metadata from multipart bytes, limits buffered parts; storage itself requires external serialization. Useful separation, but adopting resumable multipart would add unnecessary 5-MiB minimum-part/disk coordination for the fixed 10-MiB contract. No new dependency selected.
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ — put null means failed precondition; success is strongly consistent; checksum support alone is not application admission.

Compared options:
1. Whole-body subtle.digest is simple but violates bounded-buffer acceptance.
2. tee into independent bucket/hash consumers can accumulate a slow branch; reject.
3. Multipart with buffered parts introduces extra state and no benefit at this cap; reject.
4. Serial chunk digest then exact-length sink gives independent byte accounting, backpressure and no accumulating application queue; selected.

Reservation semantics: conditional create does not replace a durable fence. No retry ever writes an old generation key. Ambiguous absent puts stay unavailable until reconciled; delayed uploads remain isolated orphan generations. A successful generation can only be selected by the matching version/admission and then committed by exclusive SQL transition before any tombstone. Current proof, epoch, maintenance generation, grant, associations and run lease are rechecked after awaits. Cleanup33 owns deletion/drain composition before route exposure.

Experiment: real locked Vitest Workers, 10-MiB synthetic stream in160 sequential64-KiB chunks; conditional creation accepts first value and denies delayed overwrite. The local primitive receipt proves the sizes/digest and create-only behavior. First experiment used an incorrect handwritten expected digest, then independently recomputed Python hashlib oracle; no runtime defect inferred. This is a local primitive experiment, not throughput SLA or deployed evidence. Maximum sink write is64KiB; source chunks are held one at a time and may be larger than64KiB. The production-pump backpressure test blocks the first sink write and observes exactly one131072-byte source chunk pulled, then four65536-byte writes for262144bytes. Sink errors cancel the source; source errors abort the sink. Native heap peak is not measured; no constant-total-heap claim is made. Distinct local-test artifact bucket added; recovery destination is not used by product API.

## Actual indexed-query regression

The first production-SQL trace returned221 candidate rows but read1756 SQLite rows at limit200. `ORDER BY id` resolved to the bounded CASE projection alias, introducing a sort rather than the intended index order. Qualifying `artifacts.created_at,artifacts.id` fixed the real query. Exact-query EXPLAIN now rejects temporary B-trees; limit200 consumes no more than224 candidate rows/231 SQLite candidate reads, and2049 hidden rows stop with a whole-request503 after2048 candidates in64 chunks, no more than2112 candidate reads. These bounds cover candidate statements, not total authorization/hydration reads. Association scans separately cap2048 rows; full production throughput and heap profiling remain unmeasured.
