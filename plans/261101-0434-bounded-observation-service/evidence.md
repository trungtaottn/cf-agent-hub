# Bounded observation service evidence

Status: reviewed source candidate; aggregate acceptance pending; no full acceptance, deployment or live pilot claim.

## Exact baseline and scope

Public [PR138](https://github.com/trungtaottn/cf-agent-hub/pull/138) head `77ee610c13a61077dc866a66556eafdfcb1d2553`, tree `3c6eb659c6ad6d30ddd30bc6b22500d819a6c73a`, is equivalent to local baseline `e427ab862183527516daba5dd53e78d1222a8dce`. Its [source CI](https://github.com/trungtaottn/cf-agent-hub/actions/runs/41270452582) passed 2,427 Node tests, 1,921 Workers tests with four intentional skips, 47 Recovery CLI tests and 108 browser tests. These baseline results do not establish acceptance of this candidate. Separate Phase A screenshot evidence remains unexecuted pending operator workflow dispatch.

This slice adds the authenticated bounded diagnostic service, schema18 recovery/native compatibility and typed read-only client/CLI access. No hook adapter, observation UI, real two-agent pilot, new grant, product action, merge or deployment is included. Reported records are not verified execution witnesses or file-write/merge authority.

## Reproducible source checks

Use the repository-pinned toolchain and locked dependencies. Local checks used Node24.22.1 and npm11.9.0; CI remains the authoritative supported toolchain gate. Where Wrangler needs writable configuration, the command receives a new empty `XDG_CONFIG_HOME`; no credentials or global configuration are copied or changed.

| Command or scoped proof | Observed result | Boundary |
| --- | --- | --- |
| Fresh baseline `npm test` | 2,427 passed in 109 files | Unmodified schema17 baseline |
| Candidate `npm test` | 2,446 passed in 112 files, exit0 | Node aggregate, not Workers/browser |
| `npm run typecheck` | All six TypeScript configurations passed, exit0 | Source types only |
| `npm run verify:generated` | Config, auth, operator, native17 and native18 checks passed | Historical artifact identities remain frozen |
| `npm run build:ui` | Passed, exit0 | Build, not rendered browser evidence |
| `npm run check:runtime` with fresh command-local configuration | Passed, exit0; schema18, liveness and empty-authority closed | Local isolated runtime, not deployment |
| `node scripts/build-native-host.mjs` | Passed; host 4,170,954 bytes against unchanged 4,194,304-byte cap | Exact final build must remain below cap |
| Docs and plan validators | Passed using existing docs environment | Schema/document consistency, not runtime semantics |
| Core service focused tests | 28 actual Workers tests and 15 Node tests passed | Real authenticated fixture routes and bounded fault cases |
| Independent core, recovery and native review | Scoped review receipts retained separately | Final combined acceptance still pending |

## Genuine historical recovery and compatibility

The unmodified schema17 capture was produced before migration18 changes. [Fixture provenance](../../test/fixtures/genuine-schema17-provenance/README.md) records the original encoder, signatures, chunk hashes and exact baseline source inventory. Actual baseline capture/replay/control evidence passed 33 tests. Original bytes remain unchanged; the packed reproducer is not a regenerated fixture.

Independent recovery checks passed 13 actual Workers tests plus 15 operator-envelope Node tests. They cover genuine17 to fresh18 restore, physical17 continuation of authenticated16 source, and original observation-graph validation before resumable diagnostic invalidation. Independent native checks passed 29 Workers tests and 41 Node tests with one explicitly protected-output environment skip. Producer native source regression reported 2,826 passed and 34 protected-filesystem environment skips; these skips are not installed-custody success. Native full-profile fixture journeys use synthetic host carriers, not live credentials or deployed acceptance.

## Preserved failures and corrections

The first native18 host build exceeded the unchanged 4MiB cap at 4,299,534 bytes. A closed current-profile compact delta, verified against the full canonical descriptor, removed duplicated runtime data; no old cap or frozen16/17 artifact was changed.

Earlier recovery aggregate failures and four root TypeScript errors remain historical evidence. The latter came from imported empty JSON arrays inferred as `never[]`; two typed readonly aliases changed no fixture bytes, runtime behavior or assertions. Root TypeScript and all five continuity tests then passed.

Local Recovery CLI with fresh command-local configuration reported 30 passed and 18 failed, all at protected-checkout input guards. An earlier run also encountered a Wrangler configuration-path error. The guard was not bypassed and protected checkout markers were not altered. Supported exact-head CI must close this gate. An initial runtime-boot attempt also failed creating the default Wrangler configuration path; the unchanged command then passed with fresh empty command-local configuration, rather than hiding that failure.

## Remaining gates

The first complete candidate Workers run finished with 1,935 passed, 37 failed and four intentional skips across 142 files (1,039.99 seconds). The failures were reproduced in 13 test files: explicit current-schema expectations and projection dictionaries still described schema17, and five R1 inventory cases still expected unimplemented404 rather than the new disabled-pilot boundary. Independently reviewed test-only corrections preserve historical fixtures, exact current1..18 ledgers, future19 rejection, valid closed observation inputs, unchanged R1 grants and both-workspace no-effect snapshots. A separate malformed physical9-plus-forged18 configuration case retains the observed missing-table rejection and rollback, without claiming semantic validation of arbitrary migration gaps.

All 13 affected Workers suites then passed 260/260 tests; full TypeScript passed again. Production source and frozen historical artifacts were unchanged by these corrections. The corrected full Workers aggregate on commit `3e807387362a910da89071cfd5c09b2c5586ee94` then passed 1,974 tests with four intentional skips across 141 passed files and one skipped file, exit0 in 1,034.66 seconds. That result predates the subsequent counter-boundary correction below; a new final aggregate remains pending. Supported Recovery CLI, actual pinned-browser regression and all exact-head CI jobs remain required before source acceptance. The final native host check passed at 4,170,954 bytes with identical repeated builds; it built and imported the executable but did not invoke an executor. Local browser execution is not claimed. Any review correction requires affected tests and final exact-head verification; source publication is a draft validation checkpoint, not a release or full Phase B pilot.


## Counter-boundary correction after the aggregate

Independent adapter review exposed floating-point rounding in left-associated range arithmetic. Actual authenticated observation-route tests confirmed three exhausted-range cases returned `500 INTERNAL_ERROR`; SQL constraints and transaction rollback preserved complete SQL snapshots, so this was not accepted valid-input corruption. A fourth exhausted-high-water case returned `VERSION_CONFLICT` rather than the required limit error. Legal maximum sequence/ingest edges and exact retained-receipt replay remained valid.

The reviewed correction checks subtraction-based bounds before additions and mutations, preserving replay before exhaustion checks. A follow-on adversarial control found that its intermediate version lost the original safe-integer rejection for deliberately corrupted REAL ingest counters. The original implementation rejected that fixture without writes; the intermediate correction returned success and changed diagnostic rows. The final correction retains the safe-integer check as well as the new range guards. This is preservation of an existing malformed-storage defense, not a claim that valid requests or authenticated restore admitted fractional counters.

All 38 observation Workers tests and full TypeScript passed on the corrected source. The prematurely started intermediate aggregate was stopped normally with exit130 before a final result, and is not counted as a pass. Final exact-tree aggregate and supported CI remain required; no sequence reset, schema change, grant expansion or cap increase was made.

## Migration preflight lesson

Before another schema upgrade, inventory explicit current-version assumptions and complete table/index projections across all test suites, separately from frozen historical fixtures and signed profile identities. Review the intended current-versus-historical distinction before a long aggregate run. Never bulk-replace version literals, silently drop unknown tables or weaken historical guards merely to obtain a passing count. The original 37-failure run remains part of the evidence history.

## Final local aggregate and native roster correction

The final counter-preserving source at `87bee667fc72cbe88750545330abf220d9298e8a` passed **1,984 Workers tests with four intentional skips**, across 142 passed files and one skipped file, exit0 in 1,042.72 seconds. This closes the local aggregate pending in the historical paragraphs above; it does not replace supported exact-head CI, Recovery CLI or browser verification. This run used Node24.22.1 and pinned npm11.19.1 with fresh command-local configuration.

A later full native source regression exposed three inherited test assumptions equating the evolving generic CLI's 34 commands with the frozen R2 proof roster's 33. The production parser, resource projection and scenario already retained the correct closed R2 boundary. The reviewed three-test-only correction preserves the literal 33-operation roster, 37 scenario cases and existing fixtures, asserts uniqueness and the exact sole additive complement `listTaskObservations`, and separately verifies that this read has a valid response schema but cannot substitute for frozen R2 proof or invocation authority. No runtime helper, grant, profile, capacity or frozen artifact changed.

All three affected files passed 131 tests. The complete native source suite then passed **2,834 tests with zero failures and 34 protected-custody environment skips**, exit0; all skip names and reasons were unchanged. Those skips are not installed-custody acceptance. All 204 native host input hashes remain identical and none of the three test files is embedded; the existing exact host remains 4,170,954 bytes with SHA256 `0362f94729789325c39c7c45d52ef039dafae164a1a2a40130268ee5bfb67cfa`. The unchanged Worker runtime graph retains the 1,984/4 baseline receipt, explicitly not a fresh execution on a later test-only commit. Full exact-head supported CI and actual browser execution remain required.
