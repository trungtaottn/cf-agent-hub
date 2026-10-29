# Issue43 — isolated schema16 restore development

Status: Local source implementation in progress; verification and integrated acceptance remain pending. No released capability is claimed.

## Scope and source

This implementation starts from the exact issue42 checkpoint `016aadbe63f786364597a06fc403b7abe1b3760d` (tree `9684729353d2baf9b3fcfcbe0278ad7f80add6cb`). It preserves historical V1 and retained schema15 capture/read behavior. The new restore path accepts only exact schema16 → schema16 and requires an independent fresh anchor capability absent by default. No migration, live deployment, merge or release acceptance is included.

The reviewed plan lives at `plans/261028-0130-isolated-v2-restore/plan.md`; companion transformation, resolver and envelope contracts record all 36 table dispositions and bounds. Reviewed refinements preserve original source rows until semantic validation and add truthful recovery event provenance without new tables.

## Workflow and implementation

The actual installed AgentKit vibe/cook instructions were read and followed through bounded planning, meaningful RED tests, implementation, focused integration checks, review and serial verification. This does not claim the AgentKit CLI router or automatic hooks executed. The implementation uses existing canonical bootstrap continuity rules rather than a parallel authority policy. Prior research compared etcd-style isolated restoration and restic-style verified immutable object copying; those sources inform the reviewed design, not reused unlicensed code.

The core state machine has bounded source chunks, a durable pending reservation and deterministic cursors. Original source relationships are validated before authority invalidation; committed objects are fully hashed with conditional writes; final state stays closed. Operator raw/canonical envelopes are enforced at both HTTP and actual DO boundaries. Controls have distinct bounded admission records and exact post-transition replay checks.

## Evidence and limitations

Focused development evidence includes a genuine current-schema capture, terminal independently accepted work, an active replay-safe run, committed bytes, messaging/import history, eviction after every transfer/verification step, authenticated malformed original relationships, resolver rotation and pending PUT evidence. Dedicated operator integration tests exercise the actual authenticated HTTP entry and real WorkspaceDO rather than only helper functions. Artifact and audit tests include negative cases and current authorization.

The dedicated integration command is `npm run test:current-restore-operator`, also included in `npm run check`. Standard Workers tests intentionally skip that file outside its isolated binding composition. Final test counts and immutable source hashes belong in the local handoff/checkpoint, not speculative claims in this document.

Synthetic fresh-anchor handlers prove bounded controller rejection and replay behavior, not independent production freshness, provider latency or service availability. Browser/UI acceptance and the historical CLI's V2 orchestration remain outside this checkpoint; the CLI limitation is retained rather than retried as a known blocked lane. Real provider/client wiring belongs to issue46. Live integrated acceptance remains the owner's post-R4 stage.
