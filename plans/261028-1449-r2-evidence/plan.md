# Issue47 — reconstructed additive R2 evidence controller

Status: source implemented and independently reviewed; final immutable regression/checkpoint recorded separately; live acceptance pending.

## Scope and authority

Reconstruct from verified46 `14cbd7bc3da07dbd9ea7d56bf83da603202a693d`, tree `c3bf0ea3f405ad80003155ec326dbe795f3a6b5c`. Prior uncommitted47 work was lost after environment reset. Its historical574/2881 counts and test/review outputs do not certify this reconstruction. Official issue47 and pinned plan `c65ee2485b5ccae3862a2930e052617fd16ec574` require additive policy/schema/controller, not release acceptance. Owner development amendment permits source MVP work before formal postR4 acceptance; issue40 security signoff and all denied environment checks remain pending.

Existing `verify-release.mjs` remains sole executable. Preserve exact format1/R1 behavior; add exact format2/R2 dispatch, closed schemas and fail-closed typed evidence. No product routes, migration, dependency, credentials, deployment, merge or publication in this task. Parent owns draft publication and all remote writes. Every synthetic fixture remains explicitly non-live.

## Phases

1. [Policy and bounded IO](phase-01-policy-loader.md): independently sourced required coverage, explicit version dispatch, cumulative pre-read allocation limits.
2. [Typed evidence graph](phase-02-receipts.md): exact candidate/six-component identity; source-derived case outcomes; full recovery, native causality, result graph and deployed platform evidence.
3. [Integration and verification](phase-03-verification.md): existing CLI, mutation tests, independent reviews, docs, serial regression and immutable private checkpoint.

## Workflow and decisions

Actual owner-licensed AK vibe1.4.1, plan2.2.2, cook2.5.1, research1.1.3 and code-review2.0.3 guidance read through CH; workspace closed. Implementation uses local Node24.22.1/npm11.19.1, --tdd --auto --skip-journal; journal skipped by --skip-journal. No hooks/slash CLI execution claimed. Owner has already approved autonomous source scope, so no repeated routine confirmation. Changes to semantics beyond that scope require explicit decision.

Compare in-toto immutable typed subjects and SLSA verifier expectations before coding; reuse the existing JSON-schema/AJV stack rather than add an attestation server or signing authority. Independently review Security, Assumptions and Failure lenses against concrete interfaces before affected implementation. Preserve accepted corrections in all phases, then whole-plan sweep. Full verification runs serially with publisher coordination.

## Gates before implementation

- [x] Concrete interface and source mapping reviewed; assumptions/risks adjudicated.
- [x] Whole-plan consistency and required tests/path ownership checked.
- [x] R1 characterization collected25 tests and passed on unchanged baseline.
- [x] Fresh source-derived coverage frozen with independent parity checks, without fabricated historical counts.

## Handoff

Exact source commit/tree, binary diff, source archive, command/start/terminal receipts, independent reviews and checksummed manifest. Duplicate immutable artifacts in persistent scratch and private Library, excluding dependencies/runtime stores/credentials/licensed kit. Partial or denied gates are explicitly pending; source completion never promotes Verified/Released.

## Implemented source boundary

Fresh policy has 380 cases, not the lost historical roster. Focused final snapshots passed 102 controller/loader/R1 tests, 48 case-policy tests and 212 recovery/platform tests; suites overlap with final regression and are not a unique-test total. Independent scoped reviews verified the exact helper/controller hashes and inspected those terminal logs. Six TypeScript profiles passed after a test-only tuple-call typing correction. Conditional simplification review resulted in three small clarity cleanups. Final full serial gate receipts belong to the immutable external checkpoint, not an invented live acceptance claim. See [R2 evidence controller](../../docs/r2-release-evidence.md) for bounded loading, structural-only results and producer limitations.
