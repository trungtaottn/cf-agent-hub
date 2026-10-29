# AK validation / red-team disposition

Status: Local source implementation in progress; verification and integrated acceptance remain pending. No released capability is claimed.

Source pin: 016aadbe63f786364597a06fc403b7abe1b3760d / tree 9684729353d2baf9b3fcfcbe0278ad7f80add6cb. Three independent native reviewers cover authority/security, failure, and assumptions/plan validation. Actual installed AK 2.19.0 plan validation and red-team workflow files were read; this is native review guided by that workflow, not a claim an unavailable CLI router/hooks ran.

## Initial deduplicated findings (accepted)

| Finding | Source evidence | Plan disposition |
|---|---|---|
| Restored preview plans retain usable authority | migrations/0008-durable-work.sql:138–147; imports/integrity.ts:8–10; imports/commands.ts:56–61; config/catalog-commands.ts:14–17,127–133 | Expire previewed catalog/import plans; preserve applied evidence; test fresh login with old still-in-TTL plan |
| Whole-database authority overlay is unbounded | config/bootstrap.ts:53–57,74–75,83,130–138 | Shared canonical per-row validation/transforms, bounded preparation receipts and bounded final publication; unchanged helper cannot run over restored million-row state |
| Reserved source PUT/DELETE is valid capture evidence | recovery/maintenance.ts:49–56; artifacts/content.ts:57–63; artifacts/reconcile.ts:59–60 | Accept never-dispatched reservation, preserve effect evidence, disable old continuation/scheduling, no fake drained timestamps; phase2 specifies projection |
| Typed codec alone cannot validate raw source CHECKs | recovery/encoding.ts:40–56; migrations/0008-durable-work.sql:46,95–104 | Original enum/CHECK/uniqueness/graph validation before lossy staging; malformed authenticated source fixtures |
| Current status assumes capture-only job | recovery/capture.ts:68; recovery/jobs.ts:114; workspace/workspace-do.ts:150 | Phase1 explicit schema+operation status/read dispatch, restore receipt/eviction tests |
| Original begin retry rejected after epoch transition | recovery/restore.ts:24–27; recovery/operator.ts:130–134; recovery/protocol.ts:39,47–48; workspace/workspace-do.ts:137–139 | Narrow authenticated exact prior-admission replay, unchanged full-body fingerprint, actual operator→DO ownership in43 |
| Combined restore envelope cannot fit individual limits | recovery/manifest.ts:21,44; spec/recovery-command.schema.json restore payload; recovery/operator.ts:118; workspace/workspace-do.ts:138 | Exact current-restore operation-specific bound and finite parser; see operator-envelope-contract.md |

## Additional selected design

Cached request policy anchor is not independently fresh after awaits. Parent selected bounded trusted deployment binding resolver contract with monotonic generation, exact admitted binding snapshot, timeout/failure/rotation failclosed, no default provider. Issue43 implements conditional controller and actual DO synthetic binding tests;46 owns real provider/CLI/deployment. Shared helper cannot close over cached request anchor and claim freshness.

## Re-review pending

All three initial reviewers were independently reactivated against immutable42 and all amended files on 2026-10-27 around18:44 UTC. New attention: exact aggregate envelope accounting; generic parser ceiling vs accepted operation caps; verify/resume completion-envelope compatibility; binding trust origin, timeout and rotation; narrow authenticated epoch-crossing replay; exact source reservations and constraint-preserving projection. Plan remains draft-review and implementation blocked until material contradictions resolved and parent accepts final gate.

## Second-pass findings and accepted amendments

- Accepted restore could not resume with a near64KiB ledger. All three reviewers confirmed. Parent approved current16 verify/resume-specific composed caps; now72,218/203,479 bytes with explicit64KiB per signed receipt/cutover caps, authoritative stored-job resume dispatch and raw-count enforcement. HistoricalV1/all other accepted caps unchanged. Verify's maximum genuinely producible manifest also depends on capture progress serialization; tests must use producer-valid capture, not assume raw manifestcap implies producibility.
- Source16 capture controls lacked persisted trusted resolver snapshot. Added separate4KiB bounded internal per-control admission in existing idempotency_outcomes, distinct operation namespace/parser, without mutating historical capture jobs. Fresh checks and exact replay required. Storage contract amendment under independent re-review; no SQL migration.
- Exact original HTTP begin retry has fresh current installation digest, not original null. Explicit saved-original-vs-observed-current distinction added; original body fingerprint unchanged.
- Existing stream/signing guards are synchronous void callbacks. Added explicitly async-aware awaited current16 variants; never pass a Promise-returning resolver into existing void helper. Delayed resolver tests must prove effects do not escape before guard completion.

Targeted final review reactivated after these amendments around18:47 UTC. Readiness remains pending final material-findings resolution.

## Final review gate — 2026-10-27 18:50 UTC

- Authority/security reviewer: no remaining blocking plan findings after final envelope, trusted binding, separate control admission and replay amendments.
- Failure reviewer: reread pending/completed post-transition fence section and confirmed no remaining material plan blockers in assigned scope.
- Assumptions/AK validation reviewer: reread rejection ordering, post-fence replay, ownership and explicit NUL reproduction; confirmed no remaining material plan issues. Exact three envelope caps independently recomputed; all36 dispositions checked.

Source remains clean at immutable42 HEAD016aadbe63f786364597a06fc403b7abe1b3760d/tree9684729353d2baf9b3fcfcbe0278ad7f80add6cb. This is a reviewed implementation plan, not implemented behavior, passing product tests, live provider availability, security40 clearance or runtime acceptance. No product file edits, tests, CH, GitHub publication, merges or deployments occurred in this preparation. No permission denial occurred. Parent pickup/implementation gate pending; real provider wiring46 and postR4 acceptance remain explicit limitations.

## Implementation refinement — original source validation before invalidation

The parent approved this refinement on 2026-10-27 before implementation of the affected source-row stage. Immediate SQLite foreign keys require temporary nulling of cyclic task and artifact pointers. The controller now performs separate bounded stages: import with only FK-cycle staging; restore original pointer values; validate original typed rows and semantic relationships; verify the authenticated source database digest and artifact bytes; apply final authority, run, credential, preview and artifact transformations; add missing current authority rows in pages; publish the restored, still-closed receipt.

No lossy invalidation is allowed to conceal malformed original task/run/result/fence relationships. Each page is limited to the signed chunk ceiling of 200 rows and 1 MiB. The target remains in the persisted restoring maintenance state throughout, including after eviction, and no intermediate stage is reported complete. Publication requires an independent review of the final sequence, maintenance guards and negative/restart evidence. There is no new SQL table or migration.

## Audit projection amendment — truthful recovery producer

Parent approved the affected design before changes to audit projection. The existing task.expired reader accepts only the natural lease-expiry producer. Recovery must not impersonate that producer or silently hide its new transition history. The narrow amendment allows a system:recovery expiry event only with matching non-importable operator.recovery.audit provenance, a completed schema16 restore job, the exact signed source task page/offset, restore timestamp and task/run/fence/history correlation. Existing current caller visibility and authority checks still apply.

The producer atomically inserts the event, history and bounded provenance in the existing idempotency table. Source operator outcomes are evidence only and are not imported as executable target provenance. Forged, mismatched, incomplete-job and source-event cases must deny, and independent affected-code review is required before the final checkpoint. No new event enum, table or migration is introduced.

## Independent implementation review — 2026-10-27 19:25 UTC

The first code-level review identified material gaps not claimed resolved by the planning review: source Done state lacked a required matching acceptance; original agent principal and history-event associations were under-validated; recovery-generated audit provenance would disappear after another restore; and artifact copy retry could mistake matching destination bytes for drainage of an earlier unresolved PUT. A separate control review found that the DO envelope selector covered restored targets but not genuine current-schema captured-source resume.

The parent authorized narrow repairs and regression evidence, not weakened acceptance. Original-source association tests first demonstrated three authenticated malformed snapshots accepted by the old code; strict tuple checks then rejected them while a genuine restore remained accepted. The broader run ended with exit137 without a semantic test result and is retained as a failed environment attempt, not a pass. Artifact effects use a bounded non-executable durable ledger with dispatched-unknown holds; retained audit is a flattened, non-executable authenticated attestation, not imported control authority. Source-capture envelope dispatch must identify a validated server-held schema16 job, never trust a caller flag. Independent re-review and full regressions remain pending.

## Approved integrity refinements and retention

The parent approved two bounded uses of the existing idempotency registry, without SQL migration. The artifact-copy ledger is separate from source imports and binds the exact job/index/entry, manifest, operation/fingerprint and fence. It must durably mark dispatch before PUT; only a fulfilled callback under the unchanged guard establishes terminal evidence. Existing bytes, conflict responses and readback never drain a previously dispatched unknown operation. An old callback after rotation cannot finish current work. Unknown holds have durable retention and cannot be pruned by ordinary domain idempotency expiry.

For repeated restore, only a closed audit-attestation namespace may be staged from authenticated source chunks. Validation occurs after complete original-row import and joins the exact event/history/run tuple plus a bounded completed source-job summary. A flattened target attestation retains original actor/time/source attribution and binds the current importing restore. It contains no credentials, callbacks, operator receipts or executable resume/retirement authority. A later restore must validate the previous importer and flatten again rather than accumulate a recursive chain. Retained audit has durable retention consistent with its event/history, not transient replay expiry. Generic operator namespaces remain excluded. Genuine second/third restore tests and independent final-code review are required; approval of this design does not imply those gates have passed.

The captured-source resume envelope repair passed the actual HTTP composition (four tests) and a separate changed-code rereview. Its exact raw-cap fixture uses whitespace padding; it is not a near-limit signed-ledger performance benchmark. Signed component budgets have separate contract tests. Live provider wiring and acceptance remain deferred as recorded above.

## Engine alarm metadata amendment

A real probe→resume→recapture test exposed a strict-registry mismatch from workerd alarm metadata. Actual reserved-name CREATE, SELECT and DROP denials and exact sqlite_schema identity/SQL were observed before the parent and independent reviewer approved a schema16-only predicate. It accepts only the exact optional engine table and rejects name/type/owner/SQL drift or extra owner objects. It does not weaken the 36-table product registry, frozen15/V1 policy or export/import engine content. The narrow table-registry inspection change is a reviewed exception to prior file preservation; migration files and registry definitions remain unchanged. Genuine no-adapter multi-generation tests and final source review remain required.

## Final regression reconciliation

The first full serial Workers pass exposed three inherited tests that still asserted every current-schema restore/control was unavailable by format. The reviewed issue43 policy instead enables exact current16 controllers while requiring current authority, an empty target and the independent anchor. The parent approved replacing the obsolete blanket helper assertion with all seven actual controller missing-binding denials and full product-row/sequence plus object/alarm/scheduler no-effect checks. Other current16 tests now assert the precise epoch/nonempty-target/missing-anchor or uninstalled-state conflict; unsupported historical formats retain their old assertions.

The operator regression also exposed a real status-ordering defect: an oversized malformed legacy request reached schema validation and returned400 instead of413. Three focused negative tests reproduced it. A finite global transport ceiling still applies before JSON parsing; immediately after identifying operation/manifest tuple, operation-specific raw counts are checked before detailed schema validation. This is provisional transport selection only; authenticated stored-job checks still determine current eligibility at the DO. Current composed caps remain available, while ordinary legacy65536-byte rejection is preserved. Original failed full-run receipts are retained separately. Final focused and full reruns plus independent changed-scope review are required.

The four tests skipped in the general Workers configuration are exactly the dedicated current-restore HTTP integration tests, executed separately in their explicit binding composition; they are not omitted acceptance assertions.

The operator-boundary rereview additionally identified oversized syntactically invalid JSON/UTF-8 as unable to qualify for a composed current envelope. A dedicated syntax-failure negative first failed and then passed: such malformed transport above the legacy bound now preserves413, while smaller malformed syntax remains400 and valid current requests keep their operation-specific caps. The finite global ceiling still precedes decoding. Final contract suite13/13; focused affected Workers91/91, ordinary operator18/18, isolated current HTTP4/4 and types passed before the fresh full serial run.
