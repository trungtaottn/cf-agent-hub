# Typed native client: primary comparison and Workers stream study

Status: local source research and measured work; baseline acceptance pending; no deployment, package/platform support, capacity or integrated acceptance claim. Research inspected 2026-10-27, pinned dependencies unchanged.

## Compared approaches

- [openapi-fetch source](https://github.com/openapi-ts/openapi-typescript/blob/main/packages/openapi-fetch/src/index.js) and [typed API](https://openapi-ts.dev/openapi-fetch/api): schema-derived request/response correspondence and an explicit raw-stream parse mode avoid inventing DTOs. Its general URL/header/middleware flexibility and raw unbounded stream handoff do not supply this application's exact-origin, fixed-operation and byte-completion policy. Adopt generated wrappers in the existing generator, not a second SDK/dependency.
- [OpenAI JavaScript client](https://github.com/openai/openai-node/blob/main/src/client.ts): useful explicit injected fetch, asynchronous credential boundary and manual redirect treatment. Do not adopt automatic retries, token-only providers or loose base-URL overrides; this client's journal and runtime-proof contract needs an atomic protected slot/generation lease and exact intent preservation. The provider remains a trusted adapter, not a sandbox.
- [Azure JavaScript core REST pipeline](https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/core/core-rest-pipeline): composable transport/streaming policies are useful comparisons, but a second generalized policy pipeline would duplicate the existing small browser stack and increase header/retry authority. Reuse one transport/parser with explicit per-lane options instead.
- [Cloudflare Streams](https://developers.cloudflare.com/workers/runtime-apis/streams/): pull-driven streaming preserves backpressure without collecting full bytes. Existing server-side artifact digest verification remains authoritative; no new client-side incremental crypto library was introduced.

These moving primary references are discovery evidence, not vendored dependencies or pinned performance baselines. The selected design retains the browser public API and generated canonical DTO family, centralizes its fetch/error parser, and adds one source-supported operation inventory. All canonical IDs are classified explicitly; historical R1 availability flags do not mean current R2 availability.

## Actual runtime discovery

Node's Request accepts redirect:error, but the actual Workers Request constructor rejects it and supports only follow/manual. The first real Workers run therefore failed before enrollment dispatch. Native now uses manual plus unconditional 3xx, opaque-redirect, redirected and wrong-origin rejection, with no follow-up fetch; browser retains its original error mode. The retained failed run is not rewritten as a pass. This is an equivalent no-forwarding policy, not permission to follow redirects or a broad platform-support claim.

## Measurement and selected streaming behavior

The production bounded relay was run inside the real Workers runtime with a 32 KiB high-water-zero synthetic producer and a consumer that counts each pulled chunk. The eager alternative consumes the same size through `Response.arrayBuffer()`. Separately, the facade completed a real local 1 MiB R2 stage/upload/commit/download and the test used the existing Workers digest stream to compare downloaded bytes with the staged manifest. The facade itself claims byte-count/EOF verification, not incremental digest verification.

| Observation | 1 MiB | 8 MiB |
| --- | ---: | ---: |
| Bytes produced before consumer starts | 0 | 0 |
| Consumer chunks | 32 | 256 |
| Source pulls, including EOF | 33 | 257 |
| Maximum producer-ahead bytes | 32,768 | 32,768 |
| Maximum emitted chunk in this fixture | 32,768 | 32,768 |
| Eager contiguous allocation | 1,048,576 | 8,388,608 |

Selection: the pull relay, which retains at most one producer chunk and emits slices up to 64 KiB. This avoids a client-owned whole-object accumulation and has explicit finite 10 MiB actual-byte bounds. It does **not** prove constant heap use independent of the producer: a caller may allocate a large source chunk before passing it in. The table is operation/work/allocation evidence, not a statistically sampled latency or throughput comparison. Eager local allocation and complete R2 transfer are not equivalent end-to-end benchmark pipelines.

Zero-byte objects with immediate EOF are valid. Zero-length enqueued chunks are rejected as no-progress input; an infinite microtask producer cannot starve the deadline timer indefinitely. A monotonic expiry check, timer, byte bounds and guarded subprocess tests cover the complementary cancellation boundaries. Consumers must await stream completion and their own destination write.
