# Owned recording and preparation integration

Status: bounded recording and two-phase source implementation reviewed; final regression pending, live authority unavailable.

## Independent source slice
Preserve the reviewed ec8e750 partial draft. New work uses a separate branch and does not alter prior immutable evidence or promote unknown issue47 gates.

Implement a bounded source-owned reader for the three actual child-process originals, with full cumulative admission before payload reads, pinned private directory, exact derived filenames, descriptor/name stability and digest joins. Do not weaken existing protected storage checks. Pure metadata and negative tests are distinct from a real positive protected-storage execution.

Record actual preparation and wrapper start/end around controller work. Source-owned time cannot be supplied by the host observer or clamped to conceal clock reversal. In-memory recording is explicitly non-durable and cannot reconstruct a successful run after restart. Missing typed original bytes never create a successful wrapper.

Refactor assembly into exact core validation, actual completion original, then token-bound finalization. The token is opaque, immutable, process-local and tied to exact inputs/validation implementation. Final schema, timing and byte gates can still fail; a true core validation exit0 does not imply final evidence acceptance. Preserve existing one-shot API and full47 validator behavior.

## Explicit integration boundaries
Authentic deployment identity, protected fixture stores, current grants/proofs, network/state/scanner/control observations and revocation authority remain external prerequisites. Source recording does not authenticate them.

Later full-root preparation compatibility requires separately reviewed explicit version dispatch: per-entry actual preparation times rather than a fabricated early aggregate timestamp. Preserve existing v1 global semantics and exact380-case root coverage; no invented remaining343 subjects. The successful scenario DAG also needs actual prior-step resource joins, not labels alone. Neither change is silently included in this first recording slice.
