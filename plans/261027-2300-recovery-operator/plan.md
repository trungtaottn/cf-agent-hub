# Issue46 — protected operator client and private recovery anchor

Status: Local source implemented; immutable validation results belong to the final handoff. Publication and live acceptance remain pending. No released capability is claimed.

## Pickup and authority

Exact predecessor45 is25b7f780799605e3c8163726a2987e4dc8830e63, tree3fe1b8694963aedad0239911488d3c18c28f21b4. The prepared issue46 plan received three independent security/durability/scope reviews and a58-file unchanged-seam pickup. Historical remote planning text that assumed schema7/R1 does not override the existing exact current16 backend. This execution plan records accepted implementation amendments; original planning/review evidence remains in the immutable handoff rather than being relabeled as new tests.

Keep precisely the existing eight recovery commands. No product credentials, arbitrary provider URLs, new runtime CLI, R3 features, migration17, real provisioning, CloudHarness, publication or merge. The separate issue33 publication approval is not bypassed. Dependency audit and issue40 blocked review are not retried. Live integrated acceptance remains afterR4, not waived.

## Workflow and comparison

Installed AgentKit CLI2.19.0, ak-vibe1.4.1 and ak-cook2.5.1 instructions guide intake, accepted planning, TDD, disjoint implementation, independent review/fix, documentation and serial validation. No hook/slash-router activation is claimed. Publication/merge stages are deliberately outside this local task. The user's open-source comparison instruction remains binding even though the immutable local AGENTS predates its separately published ancestor correction.

Primary comparisons informed reuse rather than replacement:
- [restic design](https://github.com/restic/restic/blob/master/doc/design.rst): immutable identity and atomic publication, not replacement of existing AES-GCM/HMAC format.
- [etcd transaction API](https://etcd.io/docs/v3.6/learning/api/): exact compare-and-swap and current observation semantics, not a new cluster deployment.
- [SQLite Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/): bounded synchronous transaction ownership in a namespace outside restored WorkspaceDO.
- [Worker service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/): separate read/write deployment capabilities, not propagated Access identity.
- [Workers BYOB reader](https://developers.cloudflare.com/workers/runtime-apis/streams/readablestreambyobreader/): readAtLeast coalesces fragmentation; plain read does not promise minimum bytes.

## Phase1 — private durable provider

Implement read-only default facade, separately named scoped bootstrap/writer entrypoints, exact identity/tuple/generation CAS and immutable bounded receipts. Bootstrap only expected-absent, no overwrite/reset/prune. Parse closed environment policy and reject unknown identities. Static mappings forbid ordinary consumer writer/namespace exposure and pairwise environment reuse. Namespace continuity is trusted; no arbitrary infrastructure rollback detection is promised. Actual local provider eviction/CAS/service binding tests remain distinct from Node SQLite adapter tests and synthetic controller fault fixtures.

## Phase2 — current-compatible protected client

Use authenticated manifest dispatch and current typed chunk decoder, preserving V1 and schema15 read-only compatibility. Restore16 progress intentionally has manifest:null; retain authenticated client identity instead of altering producer. Use exact composed current request caps live and after retained-request restart; response cap stays independent. Local verify remains verified_local, not remote artifact proof. Omit remote error IDs and prevent reflected credential output.

## Phase3 — local serialization and retention

Acquire the same exclusive directory lock name for artifact directory and state parent, sorted and owner-bound, before state/payload/repair/network. Only empty verified0700 artifact directory creation may precede locks. No stale takeover. Bound full directory scans, count state temporaries and exact publication pairs conservatively without treating them as authenticated. Retain original AEAD repair only inside owned resources; external retirement files require single-link/no-repair reads.

Finite limits are1GiB/32768 entries,16MiB/16 slots before dispatch and8MiB/8 slots before finish/newstate,64 retained attempts and16384 sequence steps. These may pause a maximum-history job; never prune uncertain evidence or imply completion. Existing complete receipt inspection must not rewrite unchanged state. Disk-full after dispatch remains uncertain.

## Phase4 — authoritative capture and bounded verification amendment

Real provider testing exposed current16 capture's missing provider checks. Store a separate bounded non-executable admission snapshot atomically with begin; current16 pre-amendment jobs missing it deny continuation without re-anchoring. Preserve15/V1 and status/read boundaries. Fresh checks cover awaits and replay/error paths, alongside local fences.

Review then exposed unbounded-per-invocation finalization work. A bounded separate cursor ties exact draft digest/job/anchor/fence, initializes at phase transition, advances one reverified artifact atomically with operation receipt, and requires complete coverage before final publication. Full SQL digest remains bounded by256 chunks/256MiB and must be measured, not assumed cheap. Current16 capture/restore byte readers use guarded BYOB readAtLeast with64KiB artifact views and at most1MiB SQL read view plus output buffer; unsupported acquisition aborts/cancels resources without clearing unknown PUT holds. No default-reader fallback or authority weakening.

Actual R2 BYOB support was probed before this amendment. Maximum-workflow counts, fragmented/truncated streams, cleanup, restart, rotation, malformed cursor and final publication require exact candidate evidence. Paid10000 subrequests is a provisional minimum deployment budget, not configured or live verified; free1000 support is not claimed. Local runtime does not establish deployed resource-limit enforcement or the precise32-invocation platform interpretation.

## Final gates

The immutable handoff records terminal outcomes for these gates; unchecked items below are acceptance ownership, not a claim they ran on this text revision.

- [ ] Independent final source reviews and all accepted findings resolved.
- [ ] Serial focused/full Node, Workers, operator, real provider, current restore, type, generated, configuration, build/runtime and docs gates on frozen source.
- [ ] Exact source/tree/parent, binary patch, evidence hashes, exclusions and reconstruction manifest.
- [ ] Parent-owned publication handoff, no merge/deploy.

Protected filesystem rehearsal, browser, denied audit, blocked issue40 and deployed acceptance remain explicit exclusions—not passed tests. Interrupted137 processes remain inconclusive, not converted to successful measurements.
