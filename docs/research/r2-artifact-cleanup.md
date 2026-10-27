# Artifact cleanup research and comparison

Status: Local research and measured query work; live acceptance pending, no released capability claim.

Research performed before coding on2026-10-27. AGENTS rule: search GitHub OSS instead of inventing unfamiliar feature machinery.

- https://github.com/distribution/distribution/blob/main/registry/storage/garbagecollect.go — mature mark/sweep enumerates manifests then blobs; reference retention is explicit. https://github.com/distribution/distribution/blob/main/docs/content/about/garbage-collection.md requires read-only/stop-the-world safety during uploads. Rejected for this online workspace: full enumeration and stale mark→sweep races conflict with independent live admissions.
- https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/r2/api/workers/workers-api-reference.mdx and https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ — list is prefix/cursor bounded and may return short truncated pages; deletion has no conditional SQL-aware precondition. Use one <=200 page, honor truncated not length, preserve opaque cursor; no batch/key authority from clients.
- https://developers.cloudflare.com/r2/reference/consistency/ — a strongly consistent HEAD/GET observes committed state but does not drain earlier ambiguous PUT. Resolved original delete is terminal evidence; rejected transport, object presence/absence and elapsed time are not.

## Chosen approach
Reuse existing SQL transaction, generation effect slot and shared scheduler. Permanent intent tombstone; immutable canonical keys; fresh exact delete operation identity/current fence; trusted terminal CAS. Ambiguity holds instead of false convergence. Protected unknown keys/inventories are observed, never purged. Current-schema recovery stays closed pending39/43.

## Measured comparison
Actual Workers SQLite production expireArtifactIntents on1000retained candidates, limit1: initial filtering/sort approach6030rowsRead (`review-bounds-red.log`). Indexed raw bounded candidates plus durable deferral now<=128total observedSQL reads, asserted in realWorkers across same retained-prefix fixture (`schema-consumers-green.log`). This is at least47x lower worst observed work for this fixture; not a global latency/memory claim. EXPLAIN verifies due-index exact ordering with no temporary B-tree; reverse result/message artifact seeks use explicit covering indexes. Inventory tests limit2 over5+synthetic objects, resume after eviction, and CAS prevent double-counting; native limit strict1..200. Full bucket scanning and lifecycle deletion were rejected for authority, not merely speed.

## Honest limitation
Unknown PUT/DELETE completion cannot be reconstructed from a bucket listing. Holds may require independently established original-operation completion; no operator drain-by-guess override exists. Any retained capture/restore job implies unknown current-schema inventory coverage and conservatively blocks deletion until its owning recovery work supplies a reviewed exact-generation inventory. Local Miniflare/Workers evidence is not live R2 acceptance.
