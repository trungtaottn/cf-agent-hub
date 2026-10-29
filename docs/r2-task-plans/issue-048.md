# R2 Issue 48 — Prove native CLI conformance against a real isolated HTTPS deployment

Status: Partial source implementation on stacked draft PR #123; authentic deployed conformance remains pending and incomplete. MVP source development is owner-authorized; formal integrated acceptance is deferred until after R4, not deemed passed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give authorized users and external agents truthful, bounded access to durable work without duplicating the domain authority.

**Architecture:** A bounded source-owned native scenario invokes the built CLI through an owned process/custody runner. Protected configuration, current host authority, independent transport/state observations and typed evidence are separate boundaries. The CLI durably records intent before dispatch; domain decisions remain server-owned. No generic browser workflow or alternate authorization path is introduced.

**Tech Stack:** Existing pinned TypeScript, Node 24.22.1/npm 11.19.1, Cloudflare Worker/SQLite DO, Vitest and Playwright. No new UI framework or general-purpose retry engine.

**Spec:** `docs/superpowers/plans/2026-10-23-r2-durable-work.md` Tasks 1, 8–11; `spec/openapi.json`; `docs/cli.md`; `docs/kanban.md`; existing issues #21, #36–38, #40–42, #44–45 and #48. Exact issue snapshots are in [historical issue snapshot](https://github.com/trungtaottn/cf-agent-hub/blob/fdabd716b4af7ef0e5082e660dc2c397f003c303/docs/superpowers/plans/261026-0727-r2-agent-handoff/research/issues-clients.json) (prior evidence only; current live issue remains authority).

## Global Constraints

- Planning baseline: PR #93 candidate `4c8e487eee7b8a3d4f76562ecca2369819aa0a9a`; `dev` was `fcbe6139c65f9baafee9804a5c50867a1fcc0968`. Re-read the actual accepted baseline before execution.
- The original planning-only #17 pickup prohibition was superseded by the owner's MVP development direction recorded in the [common contract](common.md). This permits source development, not acceptance, live target operations or automatic issue closure. Named technical prerequisites and authentic evidence requirements remain.
- Preserve one native API/domain command model. Generated canonical DTOs remain snake_case; browser cookie/CSRF and native credential lanes remain separate.
- Import limit: 100 rows / 65,536-byte envelope; preview lifetime 15 minutes. Search: NFC case-sensitive literal matching, 2,048 UTF-8-byte query, 256-code-point snippets, 2,000-candidate maximum.
- Raw credentials/runtime proofs never enter URLs, journal bodies, logs, normal stdout, browser storage or issue evidence.
- No silent retry/new key, automatic conflict rebase, `--all`, production destination, package publication or R3 decision execution.

## Review Focus

1. Revocation during cursor crypto, artifact verification or response preparation must prevent publication; #36/#40 own these barrier tests.
2. A crash between durable intent and key attachment must send nothing; a crash after attachment must reuse the exact binding; #41 owns process-level fault injection.
3. A malformed HTTP success or wrong content type must never become CLI exit 0; #38/#44 test transport and subprocess behavior.
4. A stale board must not let a user accept a different result; #45 pins expected_version, preserves ordinary conflict drafts and requires a fresh action.
5. Imported source text/URLs and hidden references must remain inert and non-disclosing; #21/#37 test authority fields, foreign IDs, literal text and no outbound fetch.

## Observed source and integration ownership

| Current source | What exists | What must not be assumed |
| --- | --- | --- |
| `packages/client/src/native-client.ts`, `packages/cli/src/main.ts` | Native authenticated transport, canonical response validation and built CLI command/intent flow | Ordinary local tests do not prove real isolated deployment conformance |
| `scripts/test-native-r2.mjs`, `scripts/lib/native-r2-config.mjs` | Protected input validation and a deliberately blocked command entry | No installed concrete host adapter or executable end-to-end live orchestration; supplying credentials alone does not enable it |
| `scripts/lib/native-r2-scenario.mjs`, `native-r2-controller.mjs` | Fixed bounded scenario, current-authority hooks, owned process execution and observer/typed-evidence integration | Adapter callback interfaces are not implementations or independent deployment authority |
| `scripts/lib/native-r2-recorder.mjs`, `native-r2-original-reader.mjs` | Owned original custody, auxiliary captures and two-phase native37 structural assembly | Structural fragments do not supply the full global380 preparation/producer evidence set |
| `scripts/lib/r2-case-policy.mjs`, `validation/r2-runtime-evidence.schema.json`, `validation/r2-case-evidence.schema.json` | Versioned root2/root3 dispatch and causal preparation timeline checks | A validator does not generate authenticated preparations or make synthetic fixtures live evidence |
| `test/native-r2/`, `vitest.native.config.ts` | Source contracts and negative tests, with protected positive execution explicitly skipped when host runtime provenance is unavailable | No guard bypass, deployed status, or completed F24 claim |

**Shared-file rule:** #23 owns generated roots, enabled-operation/type map, runner discovery and first shared cursor/event plumbing. #21 supplies its reviewed schema change; #36 supplies search integration. #38 owns shared client edits before #42/#44 consume them. #42 then #45 serialize `src/ui/app.ts`, `write-intent.ts`, test server and helpers. One integrator applies shared OpenAPI/docs/package hunks; parallel branches may not overwrite those files.

**Proposed internal interfaces** below are implementation decisions for review, not claims they already exist. Canonical public schemas and operation IDs win; if producers differ, stop and reconcile interfaces before coding consumers.


## Pickup scope and exact prerequisites

Implement only issue #48; other issue numbers in subsystem context identify producers/consumers, not extra assigned tasks. Read [common authority and integration contract](common.md).

**Current state:** SOURCE PARTIAL / LIVE BLOCKED — source development is owner-authorized; deployed conformance and final acceptance remain separate. Do not mark #48 complete from green ordinary CI.
**Hard:** #44. **Interface:** none additional. **Evidence:** #40.
**Branch purpose:** reviewed partial source delivery on stacked unmerged PRs. Reconcile the exact current public predecessor before every source addition; preserve original plan history.

## Task #48 — Real isolated HTTPS conformance of the built CLI

### Summary / problem
Own the live runner now rather than depending on a test first invented at final acceptance. Missing environment/credential authorization keeps this evidence blocked.

### Touchpoints and interfaces
Implemented touchpoints are `scripts/test-native-r2.mjs`, `scripts/lib/native-r2-*.mjs`, `vitest.native.config.ts`, `test/native-r2/`, `package.json`, `docs/cli.md`, `docs/testing.md` and `docs/release-checklist.md`. The original proposed `test/acceptance/r2-native-conformance.test.ts` / `r2-native-config.ts` layout was not used; do not claim those files exist.
Produce `npm run test:native:r2 -- --config <protected-isolated-config-path>`. The runner consumes protected input itself; it must not pass that path as Vitest's --config. Exact HTTPS origin/workspaces, secret-store references, bounded fixture budget and isolated target classification are required. No embedded credentials, production fallback or redirects.

### Acceptance criteria and TDD
- [ ] First test missing/insecure/production/secret-bearing config fails before network; fake target classification cannot silently authorize a destination.
- [ ] Implement a source-controlled bounded scenario driven by the **built CLI processes**, not only native helper calls: Backlog → Ready → enrolled-runtime Claim → staged/uploaded/committed artifact → Submit Review → distinct second agent accepts Done.
- [ ] Run separately authorized foreign-workspace/runtime and revoked-authority server cases. Preserve the exact original request/key/binding after controlled lost response. **The shipped one-shot CLI uses a process-random replay-clock epoch: uncertain restart must exit 5 with zero outgoing mutation, not positive replay.** Settled dispatch also refuses re-dispatch. Same-process coordinator replay is source coverage only; server readback does not settle a retained journal or release holds. Changed slot/generation/principal probes must likewise send nothing. Any future supported reconciliation mechanism requires its own reviewed producer contract; do not implement the old positive-restart wording by bypassing current guards. Deterministic 24h/GC tests remain local #41/#44 coverage, not live time manipulation authority.
- [ ] Verify real status/content-type/envelopes/request IDs, stdout redaction and process exit codes. Record committed artifact byte integrity and independent actor attribution. Include explicit imported opaque-token enrollment, durable proof capture/reopen under the same slot/generation, then claim; prove a slot/generation or principal swap results in zero outgoing claim without inventing credential metadata access.
- [ ] Execute the new command only after explicit isolated target/credentials/fixture cleanup authority; no authorization is granted by this plan. Capture exact source SHA, binary digest, runtime, redacted target/config identity, case counts and fixture cleanup outcome.
- [ ] On failure preserve receipts and uncertain intent; do not issue new cleanup effects until outcome is reconciled. Independent reviewer verifies actual HTTPS provenance and server state, not a mock receipt.
- [ ] Link exact immutable evidence to #49. Skipped live cases leave F24 unverified.

### Notes / gate

The original live issue body still describes positive reconciliation after process restart. The source-faithful no-send criterion above is an explicit reviewed correction to that historical wording, not a claim that positive replay was implemented or the old criterion was fulfilled. Issue40 owner approval is operational authorization, not evidence of a completed independent security scan; denied review actions are not retried or replaced through another route.
Hard #44; evidence #40; operational authorization/isolated configuration required. No production deploy, package publication or broader recovery rehearsal.

## Handoff contract for every task

Pick exactly one existing issue after its gates clear; read this section, that issue's live body, root AGENTS and producer receipts. State exclusive files before edits. Run the named red test with nonzero collection, implement minimal scoped change, rerun focused and integration checks, then request independent review. Record SHA/base, tests with counts and exit codes, type/schema changes, negative/restart evidence, remaining blockers and next task. A failing required gate pauses downstream pickup; do not weaken tests or claim completion from scaffolding. Keep `ai-handle` distinct from `ready to cook`; owner-authorized MVP source work does not authorize live operations, acceptance, release or promotion.

## Current source boundary and next operator interface

The source runner is not an installed live runner. `scripts/test-native-r2.mjs` deliberately stops after protected configuration validation; the composition API `executeNativeScenario` requires a concrete trusted host adapter that is not bundled. Do not tell an operator that entering credentials alone completes this interface.

Remaining **source/integration** work, distinct from deferred acceptance:

1. Select the operator-owned host integration and wire the command entry to that reviewed adapter. Its current authority, deployment identity and bounded reservations must be independently authenticated; configuration self-classification is insufficient.
2. Controller-owned raw input admission and the CLI same-buffer `--input-sha256` pin are now integrated, including source-known body version/run/fence/artifact/message relationships and identical recorded/executed argv. The fixed 27-input reservation is 1,769,472 bytes; historical unpinned evidence is unchanged. This closes the missing source pin wiring, not complete host-authorized consumed-body provenance. Failed invocations may never reach the input gate, and generic pins do not authenticate operator intent. Local reader disk cases remain explicitly skipped when no authorized fixture root meets unchanged noGit ancestry guards.
3. Supply the separately authorized server wrong-runtime-proof producer without weakening the CLI's local no-send guard. Local wrong-runtime rejection is not server-denial coverage. Message creation/inbox/ACK/thread output lineage is now source-checked; source request-resource pre-admission is integrated, while authentic host authorization and full consumption provenance remain pending.
4. Compose authentic typed observers, original controls and the global380 preparation/producer timeline. The native37 fragment and schema-valid synthetic tests do not produce those originals automatically.

Before designing the concrete host adapter, obtain only these non-secret interface decisions from its owner:

- Which operator-controlled host runs the pinned built CLI, and how does it attest executable/store ownership and the independently authenticated isolated deployment/workspace/namespace identity?
- Which authorized fixture-controller interface supplies bounded current grant/proof/binding observations, per-operation before/after state commitments, scoped fault acknowledgment/disarm and same-credential revocation acknowledgment? Public API readback is not an SQL observer substitute.
- Which protected reference mechanism delivers stores and exact operation input custody, and which capabilities/limits cover each effect and evidence read? Do not send tokens or proofs in issues/chat/config examples.
- Which owner reviews retained uncertainty and authorizes cleanup? Failure preserves originals and intent; no automatic cleanup, new key, re-dispatch or hold release.

These choices select missing interfaces; they are not permission to deploy, provision credentials, execute fault/revocation controls or run live conformance. Formal integrated acceptance remains after R4. Ordinary source CI, private backups and draft publication may proceed independently without relabeling acceptance as passed.
