# Issue43 revised pickup plan

Status: Local source implementation in progress; verification and integrated acceptance remain pending. No released capability is claimed.

Plan metadata: title: Isolated V2 schema16 restore and authority invalidation; status: implemented-final-verification; issue: 43; route: feature; base: 016aadbe63f786364597a06fc403b7abe1b3760d

## Scope and selected decision

Root selected exact format2 / contract_revision0.2 / source schema16 -> empty isolated target schema16. Preserve all historical supported V1 paths. Retained frozen15 captures continue capture/status/read under42 unchanged, but15 restore/write/verify/probe/resolve/retire/resume remain denied before writes. Do not interpret a15 signed manifest as16 or migrate source recovery state. No new schema migration, package, CLI command, public endpoint or independent SQL ledger is planned. A conditional trusted fresh-anchor service binding interface is explicitly required; real provider wiring remains46 and is unavailable by default.

Live issue43 https://github.com/trungtaottn/cf-agent-hub/issues/43 requires V2 complete restoration with compatible schema, not specifically15 restore. Corrected original plan e61350712cdb3e16035177c9020e592a51e5d327 explicitly rejects unsupported cross-schema restore. The selected boundary satisfies source scope subject to review; document schema15 operational restore unsupported rather than imply all V2 works. Changes below supersede stale schema7-era observations only for current implementation; historical plans/fixtures remain untouched.

## Prerequisites and authority

Immutable42 checkpoint is 016aadbe63f786364597a06fc403b7abe1b3760d, tree9684729353d2baf9b3fcfcbe0278ad7f80add6cb; implementation must use an isolated exact-tree clone. Local development authorized by user's later MVP instruction; R1/live acceptance remains deferred afterR4, not cleared. Hard producer39 complete capture, interfaces26 credential/runtime and31 run holds, schema42 successor16. Current repo baseline inspected read-only at /workspace/shared/r2-042-local/repo now clean and pinned to the above immutable checkpoint. No GitHub writes, label promotion, CH, merge/deploy, realcredential setup or live recovery during this preparation. Formal AK validation/red-team required before cook. Publication remains stacked after its exact predecessors; the parent owns remote reconciliation and ordering.

## Required invariants

- Isolated target, separate trusted product/recovery bucket bindings, public admission and dispatch closed throughout restoration. Reject wrong workspace/environment/object mapping, nonempty domain/evidence target and unsupported source/target tuple before first restore mutation.
- HMAC-authenticated exact source manifest plus independently anchored fresh ledger with strictly newer epoch. Recheck live context, proof expiry, epoch, installation digest, ledger anchor, maintenance generation and exact job/step after every awaited cryptography/bucket operation.
- All36 registered source tables, ordered typed chunks, complete row/count/byte/digest coverage and exact committed artifact generations; no truncation, arbitrary SQL or caller-chosen keys/URLs.
- Preserve source rows/chunks as immutable evidence. Source validation occurs before intentional transformations; final target equals documented transform, not raw snapshot authority.
- Snapshot execution authority is never revived: sessions/login attempts/runtime proofs invalidated, dynamic credentials revoked, active runs expired/ended with Backlog outcome_unknown regardless replay-safe classification; preserve budgets/latest history and existingholds.
- No missing-receipt=no-effect inference. No auto-redrive/ACK. Completion yields closed restored state. Explicit resolve, retirement, fresh probe, exclusive cutover and resume are distinct gates.
- Historical schema15 frozen capture compatibility remains byte/behavior protected;16 control support cannot accidentally broaden15 dispatch or constructor retention.

## Phases and ownership

1. [phase-01-admission-sql.md](phase-01-admission-sql.md): exact contract and bounded typed SQL restore, immediate-FK cycles, continuation.
2. [phase-02-artifacts.md](phase-02-artifacts.md): immutable artifact restore and coverage verification, paused effects.
3. [phase-03-authority-controls.md](phase-03-authority-controls.md): authority overlay, run invalidation, reconciliation/control lifecycle, full gates/docs.

Shared files serialized: protocol.ts/jobs.ts/manifest.ts/encoding.ts/workspace-do.ts and generated contracts. One integration owner holds these; phase helpers may be isolated but not simultaneous edits. Do not implement across a still-changing42 tree.

## Limits retained

At most1,000,000 source rows;1,000 artifacts;268,435,456 total SQL+artifact bytes;200rows/page;1MiB SQLchunk;256SQLchunks;65,536-byte manifest;10MiB individualartifact. Bounded persisted detail must fit existing limits. Source registry/counts and target registry/counts are separately accounted where control/evidence tables or intentional transforms differ. No million-row JS maps or one unbounded final transaction.

## Verification approach

Meaningful actual Workers RED first for unsupported current restore. Use genuine16 capture including active runs, terminal results, message/result artifact associations, imports, archived identities, revocations and bounded unfinished stages. Existing genuine15 fixtures used only to assert capture compatibility and unsupported16target restore rejection. Commands read from final42 package.json; likely focused npm run test:workers -- test/recovery/complete-restore.test.ts, existing recovery/crash/admission suites, then serial full Node/Workers/operator/deploy, generated/types/docs/plan checks. No fresh npm audit retry, blocked40 security-review reroute or browser claim. Report each actual command/exit/count; live acceptance absent.

## Decision record

Selected exact16 route avoids unreviewed migration of frozen source records and retired15 constructor semantics. Alternative15->16 mapping explicitly deferred, not silently supported. Existing controller chosen over newbackupdependency after read-only comparison of etcd isolated restore/new membership/revision invalidation and restic interrupted in-place restore. Source links and scope in ../../HANDOFF.md. No benchmark claims yet; implementation measures actual worst-case serialization, chunk peak retention, continuation SQL work and artifact stream behavior.

## Validation and red-team status

Independent initial review found seven material amendments, accepted and incorporated: preview expiration, bounded shared authority preparation, valid never-dispatched reserved effects, source CHECK validation before projection, restore status/read dispatch, exact admission replay and bounded operation-specific envelope. Parent selected the explicit conditional trusted fresh-anchor binding contract in trusted-anchor-contract.md. All three independent final re-reviews report no remaining material plan issues; their scope and limitations are recorded in review-log.md. Implementation remains gated on parent acceptance of this reviewed plan. Actual provider wiring remains46 and default runtime availability stays closed. Author source-scout found immediate foreign-key cycles in migrations0008 tasks/runs/results and artifacts/generations; phase1 therefore uses bounded two-pass imports with explicit temporary pointer projection and immutable source chunks, never PRAGMA foreign_keys=OFF/defer_foreign_keys or altered historical migration. Review explicitly covered source-vs-target validation, evidence coverage, current capability matrix, async guards, envelope completion feasibility and post-transition replay.

## Additional selected contract

[Trusted fresh-anchor resolver and original-epoch admission replay](trusted-anchor-contract.md) defines the parent-selected conditional capability, exact trust origin, failure behavior and operator46 boundary. No cached request anchor is described as live freshness.

[Minimal operator admission and exact envelope contract](operator-envelope-contract.md) is issue43 scope approved by parent, with independent re-review recorded in review-log.md. This supersedes any statement that all operator integration is deferred to46.

Parent additionally approved exact current16 verify/resume composed envelope caps to guarantee downstream feasibility; operator-envelope-contract.md defines record bounds and server-selected resume dispatch. All other operations and historical V1 accepted caps stay unchanged.
