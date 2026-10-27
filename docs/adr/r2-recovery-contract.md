# R2 recovery envelope and trusted artifact mapping

Status: Design baseline; issue #22 contract implementation pending review. No released capability is claimed.

## Decision and alternatives

The owner delegated technical choices during MVP development. Choose distinct operator-owned private artifact and recovery bindings (D2). `RecoveryWorkspaceV2` requires `artifactBucket` alongside existing `bucket`; current R1 construction deliberately does not implement this capability. Never fall back to another bucket when the binding is absent. Caller-selected bucket/key/URL authority is rejected. A single bucket with separate prefixes was considered, but increases collision and configuration risk without simplifying the existing trust boundary.

Canonical immutable keys are `artifacts/{workspace_id}/{artifact_id}/{sha256}` and `r2/{workspace_id}/{capture_id}/artifacts/{artifact_id}/{sha256}`. The gateway/domain owner derives them from committed SQL metadata, not user filenames, supplied URLs or public configuration. Manifest validation requires exact equality, unique IDs and unique keys. #32/#33 must preserve immutable generation identity; no mutable overwrite is permitted. A changed digest is a different generation, never replacement of the committed artifact identity.

The [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) supports private bindings and conditional writes. Future #39/#43 copies must use conditional create-if-absent and, on retries, verify the existing object's actual size and SHA-256 before accepting it. ETags are not SHA-256 evidence. [Strong consistency](https://developers.cloudflare.com/r2/reference/consistency/) does not make SQL plus object writes atomic. [Streaming reads](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/) avoid buffering all artifacts. No bucket was provisioned or live request performed for this decision.

## Closed compatibility boundary

| Input | Format/semantic contract | Current runtime |
| --- | --- | --- |
| V1, schema7, original empty artifact arrays | Existing HMAC, SQL representation and complete registered table coverage | Existing recovery lane |
| V1 with artifacts, unknown fields or incompatible schema | Reject | Reject before writes |
| V2, schema7 synthetic format fixture | Bounded envelope only; schema7 has no committed-artifact metadata table | `RECOVERY_FORMAT_UNAVAILABLE` |
| V2 future R2 schema | Requires #24-reviewed exact versioned typed registry/schema extension | Unavailable until #39/#43 |

`validateManifestShape` validates the envelope's declarations; `verifyRecord` authenticates canonical bytes. Neither proves bytes exist or grants admission. `verifyManifest` preserves its signature but rejects V2 explicitly. Capture rejects nonzero artifact budgets before workspace access. Thus a widened future-facing schema does not silently activate runtime recovery. Existing V1 fixtures and historical receipts remain unchanged. No generic V1-to-R2 restore mapping is invented.

## Bounded restart contract

`JobDetailsV2` is a future type only; current `rowJob` remains version1-only. Its entire canonical `details_json` must be at most 262144 bytes, including manifest, ledger, keys and bookkeeping. The signed manifest is the single immutable inventory. `RecoveryArtifactTransferState` contains its digest, verified artifact index/bytes, phase and at most one pending reservation. The reservation binds operation ID, request fingerprint, index, artifact ID, exact keys, size and SHA-256. No array of duplicate per-artifact receipts is appended.

#39/#43 must validate checkpoint/index against the frozen manifest, sum exactly the completed prefix, and reject `complete` unless all SQL chunks and all committed artifact bytes have been read and verified. Pending must reference exactly the next immutable entry; completion requires pending=null. Advance index/counts once, after digest verification and maintenance/authority recheck. Guard before and after every await; a crash retries the same identity without incrementing twice. The standalone shape validator does not prove these state-machine or byte-presence obligations. Missing committed bytes must fail completion in the future runtime tests.

A SQL transfer-receipt table was considered but requires #24 migration and typed registry coverage. Bounded single-inventory JSON fits the already bounded manifest and existing jobs owner without another ledger. If future metadata cannot fit the whole-document bound, fail closed and obtain a reviewed storage design; never truncate or omit entries.

## Experiment and simultaneous ceilings

A Node 24.22.1 UTF-8 JSON sizing experiment using SHA-256 immutable names measured 402 bytes for one illustrative entry, 40101 for 100, 80201 for 200 and 401001 for 1000. These are sizing observations, not throughput benchmarks or guaranteed production capacity. A checkpoint-only progress structure stayed 170–173 bytes. The [reproduction script](../r2-task-plans/evidence/issue-022/size.mjs) and [result](../r2-task-plans/evidence/issue-022/sizing.json) are retained with the implementation evidence.

All ceilings apply together: 1000 artifacts, 10 MiB each, 256 MiB combined SQL+artifacts, 65536-byte manifest, 256 SQL chunks, 1 MiB/chunk, 200 rows/page and 1000000 total rows. The chunk/page combination permits at most 51200 represented rows. The artifact-count ceiling does not promise that 1000 inventory entries fit the manifest. Tests therefore distinguish per-field schema limits from complete canonical manifest limits. Reject excess without truncation.

## Authority overlay and downstream obligations

D1 remains the reviewed single provenance registry decision: preserve identity and historical metadata within snapshot coverage; newer current ledger/epoch revokes old human-managed credentials and runtime proofs, including credentials absent from the old snapshot. Only independently anchored current static grants activate. Retained active dynamic identity advances to the new epoch without resurrecting archived identity or granting scopes; fresh human issuance uses the current operator ceiling. #24/#26/#43 own implementation and negative/fresh-issuance tests.

Restore consumes/revokes login/session records, leaves R3 approval JSON disabled, holds uncertain runs/effects, and never auto-resumes/redrives. Current ledger, source retirement, fresh probe, reconciled effects and explicit exclusive resume remain necessary. A complete capture receipt is not admission. After explicit resume only, perform fresh task/review acceptance. Real acceptance remains deferred to the owner's post-R4 stage, never waived.
