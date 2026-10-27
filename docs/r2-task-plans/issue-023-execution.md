# Issue 23 local execution ledger

Status: Local source implementation reviewed; live acceptance pending until after R4, not passed. Publication waits for the controller's exact remote predecessor baton.

## Authority, scope and validation

The retained [published task](issue-023.md) is historical. The [owner amendment](owner-development-amendment-2026-10-26.md) supersedes its blocked-start/publication-only paragraphs. This execution consumes reviewed local #22 `5b3982fdff3e5966b3469fb419a83e15ead1a2ce`, tree `c47859b86559198c3858566bfe504b91010e3837`, including #20–22. It does not claim that synthetic ancestry is a remote PR head. Installed AgentKit `ak-vibe` 1.4.1 and CLI 2.19.0 are the actual workflow; no invented ak-vibecode alias or CLI semantic red-team command.

Two bounded batches: (1) generated aliases/validators and explicit runner discovery; (2) closed cursor/event boundaries and thin unavailable dispatch. Independent review follows each; final regression/docs/handoff follow integration. No migration, registry, domain state engine, secret response channel, new grant or operational action.

Validation resolves existing owner-delegated technical choices without reopening settled questions. Checked canonical DTO names and amendments, command signatures/sessionId, current schema 7, generator ownership, Worker/Node/operator selectors and public route selectors. Unknown schema rows in ImportEnvelope remain unknown[] by canonical design; NativeDTO has no unknown fallback. Config/operator generators already cover their reviewed #20/#22 schemas and are regenerated, not gratuitously rewritten. No new artifact binding before #32.

## Red-team findings and adjudication

Independent Security Adversary and Assumption Destroyer reviewed the actual sources before implementation.

- Accept: `src/http/cursors.ts` checks events versus other positions but lacks runtime operation closure. Add strict binding/operation validation, preserving only implemented inbox/thread/events lanes.
- Accept: `src/index.ts` and `src/workspace/workspace-do.ts` own public matching. A helper-only route test is insufficient. Integrate unavailable dispatch at fallback without auth/storage/scheduler side effects; test actual Worker and DO entry points. These two small integration edits are necessary additions to the historical file list.
- Accept: ImportEnvelope rows intentionally preserve malformed input for later row reports. Generated aliases preserve this exact schema, not a narrower ImportBatch.
- Accept: operator runner and TypeScript ownership require `vitest.operator.workers.config.ts`, `tsconfig.operator-test.json` and root exclusions in addition to listed runner files.
- Accept: D-HISTORY now has reviewed `listTaskResults`/`TaskResultListResponse` from #20. Generate types; do not activate route/cursor before its producer.

Whole-plan sweep: the dated ledger governs stale #17, D-HISTORY and pre-#20–22 observations in retained prose. Event types, current-resource predicates and task/run/fence evidence expand only with real persisted producers; none exists yet. Missing predicates continue denying. Future runtime suite paths are reserved but absent files are never counted as tests. Request-decision/approval remains unavailable. No unresolved implementation decision remains within this bounded scope.

## Research and choice

Use the existing Ajv standalone generation instead of a second runtime compiler/DTO engine: [Ajv standalone documentation](https://ajv.js.org/standalone.html) supports build-time validators. Use explicit Vitest runtime selectors, not a broad acceptance glob: [Vitest 4 CLI](https://v4.vitest.dev/guide/cli) documents list/JSON discovery. Installed 4.1.12 help independently confirms `--filesOnly`, `--json` and optional static parsing; actual collection will run without static parsing. No dependency upgrades.

Toolchain: Node 24.22.1, task-local npm 11.19.1 on PATH for nested calls, isolated XDG paths and metrics disabled. Offline npm ci could not find zod 4.6.7 in cache (ENOTCACHED); copied the predecessor's unchanged locked node_modules to this isolated checkout instead. This is reused dependency installation, not a claimed successful npm ci. No cache/permission workaround or predecessor mutation.

## Checks and completion

- Batch 1 red: shared boundary suite 8 failures / 1 pass before generated roots and cursor closure; generated subset then 3 passes. Runtime discovery config assertion failed 1 of 14 before wiring, then all 14 passed.
- Batch 2 red: actual Workers test exposed unknown-event hidden-summary projection through a permissive hook (1 failure / 1 pass). The closed producer/resource guard fixed it. Focused Workers idempotency plus boundary run: 20 passed across 2 files; this includes existing async-hook rollback and current-authority replay regressions. A requested nonexistent auth filename in that focused filter collected no additional file; the full run below includes all real auth suites.
- Integrated `npm run check`: exit 1, **not an aggregate pass**. Generated freshness, all five TypeScript projects and R1 contract verification passed; Node 798 tests / 29 files, Workers 474 / 24, operator 18 / 2, deployment verifier 13 passed. Recovery CLI: 8 passed / 20 failed, matching the predecessor environment limitation. The protected `/tmp/.git` marker makes recovery fixtures fail the outside-checkout guard (`RECOVERY_INPUT_REJECTED` / protected IO rejection); no marker, permissions or tests were changed. New-head CI remains required after authorized publication.
- Actual `vitest list --config <config> --json=<file>` (without static parsing): Node 798 / 29 files; Workers 474 / 24; operator 18 / 2. Every collected file belongs to exactly one runner. No live native suite was collected. Future domain/CLI/operator/acceptance files are reserved paths only, not invented passing coverage.
- Freshness fault injection: one extra generated DTO newline caused canonical `generate-auth-contract.mjs --check` to exit 1; regeneration restored byte-canonical output and `npm run verify:generated` exited 0. No manual generated changes retained.
- Pinned lock SHA-256 `8fa7894880bd0b77bfdf6fffe7e13fd8eb1a8b695b1316682dc33f7783873634` is unchanged. Dependency copy verification compared 4,136 files (excluding task-written Vitest cache): zero byte differences, shared inodes or external symlinks. Sorted path/content manifest SHA-256 `cdd64afb74071fd4d03aea74d4a172b45fc65451b90ee7ac0717952286b67beb`.
- Independent batch reviews: each reported 0 Critical / 0 Important / 0 Minor; the first reviewed generators/aliases/discovery, the second security boundaries and actual entry-point tests. Simplification review found no necessary changes; generated output expansion is canonical, not a hand-maintained DTO layer.

Research experiment: 5 rounds × 100,000 mixed valid/invalid synthetic TaskCreateRequest checks gave median 4.112 ms for standalone versus 3.883 ms for runtime Ajv. Both accepted exactly half. Standalone module import was 24.646 ms and runtime schema compile 48.494 ms, but setup scopes differ and are not a fair production latency comparison. There is no meaningful steady-state performance win claimed. Preserve standalone generation for one canonical contract, build-time compilation and Worker compatibility, not a fabricated benchmark advantage.

`npm run check:runtime` passed: local isolated runtime boot, liveness, SQLite schema 7 and empty-authority denial. This is not deployed acceptance. Documentation validation passed (94 Markdown documents, 165 JSON files, 1,206 local links); historical plan validation passed 636 checks. `git diff --check` passed. No real deployment, credentials, object provisioning, recovery acceptance, browser/UI acceptance, dependency audit, release or GitHub mutation was performed. Source tests and discovery are not R2 endpoint acceptance.

## Shared ownership handoff

#24 owns migration/version/registry and persisted R2 evidence. Later domain owners extend current-resource predicates and the closed event map only alongside real commands; retain synchronous hooks, current actor/session checks and sanitized replay. #25 owns first-response secret issuance, #26 runtime proof, #27 history query/envelope proof, #32 artifact binding, #36 mixed-search retention, #46 operator suite and #48 dedicated live native runner. Scope allowlists remain the reviewed #20 lists; generating a schema never activates or grants an operation. Neither cursor history/search nor event task/run/fence joins are implemented here.

The published issue plan is retained byte-for-byte at Git blob `a77428a004badc6b6745e34370133a525e1edbff` from commit `12e38918f9e79b89774102e53a9121986b7de913`; this dated execution record, not edits to historical receipts, reconciles its stale instructions.
