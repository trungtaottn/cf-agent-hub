# Bounded Observation Adapter Implementation Plan

Status: local source implementation plan; independent source acceptance and activation pending.

> Implementation proceeds sequentially with immutable independent review checkpoints. Source acceptance and activation are separate decisions.

**Goal:** Implement and test an offline-source Linux path-observation adapter without activating hooks or contacting a real service/provider.

**Architecture:** A separate executable projects a closed Claude hook profile to relative path records, serializes one private state lane with independent-open flock, and durably freezes each request before one authenticated owner HTTP operation. A narrow transport reuses the actual protected-provider provenance/lease/proof boundary, never the generic owner-excluding native catalog. Explicit genesis, continuation status and exact latest-receipt reconciliation preserve uncertainty rather than guessing sequence numbers.

**Tech Stack:** Node 24.22.1, TypeScript, existing locked esbuild/Vitest/Workers harness; Linux util-linux flock 2.41.5 at /usr/bin/flock, pinned by measured executable hash. No dependency install or lockfile changes.

**Spec:** [Sanitized reviewed design](../specs/2026-11-01-bounded-observation-adapter.md). Original reviewed SHA256 `9759e046af39e6aeb592642156755d2fb73410194ff54e0dad710613697d75f2`; this is a sanitized derivative with checkout paths removed, status formatting normalized and internal coordination terms replaced by product/reviewer terms. Review receipt SHA256 `a8ba616961b9e907910f3b6ee5f20a9416f46b942c2a2bd2dadccc7b01f6bdb7`. This plan does not alter the reviewed authority or acceptance boundary.

## Global Constraints

- Base `3e807387362a910da89071cfd5c09b2c5586ee94`, tree `57bcd43d0c4febe1a5f799f31363a07943056ecd`, isolated branch `feature/bounded-observation-adapter`.
- LOCAL source only. No publication, transfer, commit without checkpoint approval, merge, deployment, hook installation, real protected-store reads, new grants, permissions or settings. B1 publication/full CI remain independently held.
- Always `completeness:'unknown'`. No content, transcript, tool response, secret, absolute root, raw exception or response request-ID persistence/output. Empty stdout/stderr and neutral exit for hook invocation.
- Profile `claude-posttooluse-path-docs-20261101-v1`: PostToolUse Read/Write/Edit only; exact source shapes and optional discarded fields in spec; Linux absolute contained lexical paths only, no filesystem mediation claim.
- Raw input 1,048,576 bytes; 1,024 read attempts including EOF/empty attempts; JSON depth16/nodes8192; duplicate-key and invalid UTF-8 rejection. Read offsets/limits safe positive integers; duration_ms finite nonnegative.
- State131072 bytes; queue64 records/65536 bytes; request32768 bytes; metadata16384 bytes; batch32 records; path1024 UTF-8 bytes. Count JSON escaping and duplication. Two state files262144 logical bytes; allocation is separately measured.
- Fixed lock/state.json/state.tmp, private0700 directory,0600 regular single-link files, no symlink components. Stable lock inode never unlinked or renamed. Production state outside worktrees/shared temp roots.
- All critical filesystem operations synchronous and checked before/after against the same process-entry2000ms soft budget. Retain lock during blocking calls. No hard filesystem latency promise, no detached mutation/callback/child.
- Durable pending before credential acquisition or network. One HTTP per invocation including status; every HTTP is preceded by state re-fencing. No implicit genesis/recovery; no highwater guesses; establish/replacement must durably await owner status.
- No edits to frozen16/17/18 source inventories, shared provider/native client, native host build graph or owner operation catalog. Exact native artifact byte/hash/cap regression required; unavailable prerequisites are blockers, not skipped passes.

## Review Focus

1. Fractional optional duration/response numbers must not cause an undocumented profile restriction: adapter-local strict parser accepts finite JSON numbers without changing shared safe-integer parser (Task1).
2. Structurally valid state can be semantically contradictory or contain a forged fingerprint: reject impossible phase/session/pending/receipt combinations and recompute frozen intent (Task2).
3. Lock acquisition child can survive parent death: actual process-death tests must demonstrate eventual descriptor closure, not merely mock cleanup (Task3).
4. A complete settled file after failed directory fsync must not authorize a successor without a new durability fence (Tasks3/4).
5. Real protected provider acquisition can rotate or block between currentness checks: use actual synthetic protected-store provider and callback-bound send checks, without real credential access (Task5).

## File ownership and interfaces

All new runtime files live in `packages/observation-adapter/src/`; no unrelated refactor. New fixtures/tests live in `test/observation-adapter/`, except actual Workers parity in `test/observations/adapter-parity.test.ts`.

- `strict-json.ts`: `parseHookJson(bytes:Uint8Array):unknown`; adapter-local finite-number strict parser with the existing parser's root/container depth and value-node counting. Shared parser is safe-integer-only and cannot support reviewed duration_ms/tool_response numbers unchanged.
- `claude-hook.ts`: `readHookInput(reader:ReadableStreamDefaultReader<Uint8Array>,deadline:Deadline):Promise<Uint8Array>`; `projectHook(bytes:Uint8Array,context:ProjectionContext):ObservationRecord|null`. ProjectionContext freezes `{root,profile,observedAt}`; no identity from hook accepted.
- `contract.ts`: exports FrozenBinding, Session, Intent, Pending, State, OwnerOutcome, OwnerStatusOutcome and OwnerTransport from reviewed design, with discriminated operation outcomes; `validateState(value:unknown):State`; `emptyState(binding:FrozenBinding):State`; `freezeIntent(binding:FrozenBinding,intent:Intent):Pending`; `sameFrozenBinding(a:FrozenBinding,b:FrozenBinding):boolean`. Reuse canonical DTO/generated closed validators and canonicalBody, not duplicate wire schema. Fingerprint Node SHA256 exact B1 preimage.
- `state-file.ts`: `withStateLock<T>(options:StateDirectoryOptions,deadline:Deadline,run:(store:LockedStateStore)=>Promise<T>):Promise<T>`; locked store `read():State`, `persist(state:State):void`, `initialize(binding:FrozenBinding):void`. Options contain ephemeral directory/worktreeRoot and pinned flock identity; no provider. Genesis is explicit API only; normal read never creates state.
- `reporter.ts`: `runInvocation(context:InvocationContext,input:ReadableStream<Uint8Array>):Promise<void>`; immutable context contains binding/root/profile/state options, shared Deadline, current-binding getter and lazy transport factory. `OwnerTransport.dispatch(pending,deadline)` and `.status(binding,sessionId,deadline)` return closed outcomes, distinguishing no-send from uncertain send. Pure `planTransition(state,record)` returns state plus zero/one operation; pure `settleTransition(state,outcome)` validates exact receipts. Coverage loss prepares replacement only after status, never when pending exists.
- `owner-transport.ts`: `createOwnerTransport(provider:ProtectedCredentialProvider,fetcher:typeof fetch,currentBinding:()=>FrozenBinding):OwnerTransport`. Actual registered association/lease required; no JSON registrar, environment bearer, public verified flag or arbitrary provider acceptance.
- `main.ts`: `runHook(context:InvocationContext,input:ReadableStream<Uint8Array>):Promise<0>` neutral boundary; separate executable entry captures absolute deadline before other work. Production launch setup/verified mapping remains explicit external prerequisite, not a hook-supplied authority or hidden HTTP lookup. Missing approved launch is unavailable, not auto-init.
- `scripts/build-observation-adapter.mjs`: independent esbuild entry producing `dist/observation-adapter/reporter.mjs`; no native build imports/edits.
- `vitest.observation-adapter.config.ts` and `tsconfig.observation-adapter.json`: independent suite/type scopes; package.json gets only `build:observation-adapter`, `test:observation-adapter`, `typecheck:observation-adapter`. Existing Workers suite already includes new parity file. No node_modules staging or lock mutation.
- `docs/observation-adapter.md`: implemented boundaries, source-only profile, explicit setup/activation gates, evidence links; feature matrix receives source-only evidence link, never Verified/Released promotion.

### Task 1: Bounded closed projection

**Files:** Create strict-json.ts, claude-hook.ts; test/observation-adapter/projection.test.ts and fixtures/hooks.json; independent Vitest config and package test registration.

**Interfaces:** Produces parseHookJson/readHookInput/projectHook above; consumes existing Deadline and ObservationRecord DTO. Projection context stays entirely ephemeral.

- [ ] Write failing tests named `projects_read_write_edit_paths_only`, `rejects_unknown_or_ambiguous_shape`, `preserves_unicode_case_without_decoding`, `rejects_wrong_cwd_and_traversal`, `accepts_fractional_discarded_duration`, `rejects_duplicate_invalid_utf8_and_unpaired_unicode`, `enforces_exact_input_depth_nodes_reads_caps`, `slow_input_aborts_without_output`. Assertions: exactly path/activity/source_oid:null/timestamp; no raw fields; all cap/+1 boundaries; Read1.5 offset rejected while duration1.5 accepted.
- [ ] Run `npm run test:observation-adapter -- projection` and retain expected RED evidence (missing projection behavior, not test syntax errors).
- [ ] Implement bounded parser and projection; preserve shared parser source unchanged, pin docs reference/date in fixture description. Stream reader cancellation never awaits an unbounded cancel promise.
- [ ] Run same command GREEN and `git diff --check`; freeze exact file hashes and test log for independent checkpoint. Do not commit or start Task2 until checkpoint direction.

### Task 2: Closed state, intent and byte bounds

**Files:** Create contract.ts, test/observation-adapter/contract.test.ts, test/observation-adapter/helpers.ts; add independent typecheck scope/registration.

**Interfaces:** Produces exact State/FrozenBinding/Pending and pure validation/freeze functions above; consumes canonical DTO validators/canonicalBody. Fields remain those in reviewed spec, not a new authority format.

- [ ] Write failing tests `rejects_unknown_fields_and_impossible_phases`, `recomputes_exact_route_body_fingerprint`, `rejects_mixed_binding_and_forged_receipts`, `enforces_queue_request_metadata_state_exact_caps`, `never_persists_secret_shaped_input`. Assert unknown completeness invariant, null highwater only with continuation, pending body matches queue prefix, safe counters, actual serialized escaping/duplication maxima and combined-max rejection.
- [ ] Run focused suite RED; implement minimum contract validation and canonical exact route/fingerprint construction; use owner-specific operation union, never cast generic catalog.
- [ ] Run contract/projection suite GREEN plus `npm run typecheck:observation-adapter`; record immutable checkpoint for independent review before Task3.

### Task 3: Independent-open locking and durable genesis/state

**Files:** Create state-file.ts, state-file.test.ts, multiprocess.test.ts, crash.test.ts, fixtures/lock-child.mjs and fixture bounded filesystem fault hooks owned only by tests.

**Interfaces:** Produces locked-store API above; consumes validated State and shared Deadline. No async filesystem mutation or local SQLite queue. Test injection is a filesystem dependency boundary, not production environment bypass.

- [ ] Write failing tests `missing_is_not_genesis`, `genesis_refuses_existing_or_partial_state`, `private_directory_and_file_checks_fail_closed`, `independent_open_contenders_serialize`, `shared_fd_negative_control_detects_overlap`, `parent_child_death_releases_stable_inode`, `pending_fsync_rename_dirsync_precedes_send`, `partial_write_enospc_fsync_rename_fail_closed`, `postrename_failure_requires_refence`, `blocking_fs_overrun_retains_lock_until_return`. Test symlinks/hardlinks/modes/owner where privilege permits, stale temp cleanup only after valid committed state, actual measured file/allocated sizes.
- [ ] Record Node/flock path/version/hash/filesystem type; run focused RED including actual process/barrier contention, not mock-only assertions.
- [ ] Implement independent no-follow open + fixed argv flock child, deadline-bounded child kill/reap, stable inode checks, synchronous bounded read/write loops/fsync/rename/directory sync and explicit genesis. Missing/corrupt state never falls back to temp.
- [ ] Run state/multiprocess/crash GREEN. Kill at before/after acquisition/temp sync/rename/directory sync and verify old/new complete states only. If host protected-root policy prevents required test setup, report blocked rather than using unsafe paths/permissions.
- [ ] Freeze files/logs for review checkpoint before Task4; no commit yet.

### Task 4: One-request reporter and uncertainty reconciliation

**Files:** Create reporter.ts, main.ts, state-machine.test.ts, deadline.test.ts, response-loss.test.ts, fixtures/server-child.mjs and fixtures/reporter-child.mjs.

**Interfaces:** Consumes Task1 projection, Task2 contracts and Task3 locked state; produces runInvocation/runHook and pure transitions above. Synthetic server durable state is test-only; production transport not yet claimed.

- [ ] Write failing transition tests `establish_requires_later_status_then_later_append`, `replacement_receipt_always_awaits_status`, `unexplained_activity_holds`, `exact_latest_receipt_settles_only_matching_prefix`, `pending_never_expands_or_rebinds`, `overflow_marks_only_witnessed_loss`, `replacement_requires_status_no_pending_and_discards_old_queue`, `binding_changes_at_every_boundary_hold`.
- [ ] Write failing process tests `remote_commit_response_loss_restart_exact_retry_once`, `replacement_response_loss_later_append_holds`, `receipt_lost_after_second_replacement_or_slot_reuse_unknown`, `config_reset_revocation_never_rebind`, `late_network_result_no_settlement_after_unlock`, `two_lanes_then_one_unsupported_no_third_lane`. Assert maximum one HTTP, frozen pending identity, empty output, no domain operations; hold first remote request beyond abort while exact retry proves one logical effect.
- [ ] Run focused RED, implement only reviewed transitions and neutral boundary; deadline created once at entry, no timers reset, provider factory called only after durable pending/refence. Keep logical uncertainty on errors even if later401/403 arrives.
- [ ] Run full adapter suite GREEN including process kill before/after send/receipt/settled fsync; freeze checkpoint. Fake transport/server evidence is explicitly not authenticated production acceptance.

### Task 5: Genuine protected owner transport and B1 parity

**Files:** Create owner-transport.ts and owner-transport.test.ts; test/observations/adapter-parity.test.ts. Existing provider/native-provenance/client files unchanged.

**Interfaces:** Implements OwnerTransport using concrete ProtectedCredentialProvider create:false, protectedAssociationFor, samePrincipalBinding, assertLeaseBinding, runtimeBinding and dispatchRuntimeProof; actual use/proof callbacks synchronous one-shot linked to returned send promise. Secret headers ephemeral only. Fresh binding/currentness checks after awaits and before settlement.

- [ ] Write failing tests `unregistered_cloned_structural_provider_denied`, `actual_synthetic_protected_store_dispatches_four_closed_routes`, `rotation_before_during_after_callbacks_denied`, `async_repeat_wrong_return_callbacks_denied`, `origin_redirect_cookie_oversize_malformed_denied`, `credentials_never_persist_or_print`. Create only synthetic test stores through existing test setup; never inspect a real store.
- [ ] Write actual B1 Workers tests `adapter_fingerprint_receipts_match_server`, `delayed_establish_old_frozen_runtime_denied_after_config_install`, `stale_owner_cross_scope_revocation_denied`. Exercise actual service/auth boundaries, not fake-provider assertions as acceptance.
- [ ] Run focused RED, implement pinned HTTPS transport with credentials omit/redirect manual/cache no-store, closed request/response validators, <=1MiB response and exact receipt matching. At-most-one HTTP tracked independently of response status. Release lease and cancel response in finally; no hidden config lookup.
- [ ] Run adapter suite and `npm run test:workers -- test/observations/adapter-parity.test.ts` GREEN; freeze transport trust-boundary checkpoint for independent reviewer before claiming genuine adapter integration.

### Task 6: Separate artifact and exact regression/evidence closure

**Files:** Create build script and docs/observation-adapter.md; modify package.json only scoped script registrations and docs/feature-matrix.md source-only link. New artifact-regression.test.ts proves owner catalog exclusion and separate build graph.

**Interfaces:** Separate reporter artifact exports trusted invocation API; no automatic real launch/config/provider discovery, installation or genesis. Unconfigured executable exits neutral/unavailable. Actual launch-provider/setup wiring cannot be invented from another agent's environment and remains explicit activation prerequisite.

- [ ] First capture baseline native16/17 commitments, native18 inventory and complete-host output bytes/hash/size from unchanged base using same pinned build toolchain; keep private receipt outside git. Write failing separate-entry/owner-exclusion/artifact tests.
- [ ] Add separate build entry without native imports and measure reporter size. Rebuild native host and compare exact baseline byte/hash/inventory equality plus unchanged4MiB ceiling; stop on drift, never widen cap or regenerate frozen contracts.
- [ ] Run `npm run build:observation-adapter`, `npm run test:observation-adapter`, `npm run typecheck:observation-adapter`, `npm run verify:generated`, `npm run typecheck`, `npm test`, `npm run test:workers`, existing native source/observer regressions and `npm run check:native-host`. Use command-local empty XDG directories where already authorized; no config/auth copying. Record every exact exit/failure, no suppressed/skipped gates.
- [ ] Run `python -B scripts/validate_docs.py`, `python -B scripts/validate_plans.py`, `git diff --check` if prerequisites available; missing dependencies remain blocked, not installed implicitly.
- [ ] Freeze exact diff/file manifest and sanitized command logs for independent whole-source review. Address findings with new RED→GREEN evidence and re-freeze changed hashes. Only source-owner approval can authorize a local commit, using explicit owned paths excluding node_modules. No publication/transfer/merge/deploy step exists in this plan.

## Finite handoff and evidence

Each task ends at independent review checkpoint; one task per batch. Record base/branch, immutable file hashes (precommit), commands/exits, known failures, test-only assumptions, logical/allocated sizes, Node/flock identity and filesystem type. Final source report distinguishes implemented offline behavior, authentic synthetic-provider/Workers evidence, frozen native byte regression, blocked/full-CI prerequisites and unperformed real activation. No synthetic two-agent scenario is called a real pilot.


## Execution amendments (2026-11-01)

Source-owner-authorized execution base is final reviewed B1 `87bee667fc72cbe88750545330abf220d9298e8a`; the original design hash/review provenance above is unchanged. Task5 actual parity uses Node-side `test/observation-adapter/worker-parity.test.ts` with the existing local Wrangler harness/recovery-anchor dependency, so the genuine Node protected provider and actual Workerd routes execute in one chain.

Task6 measured package metadata embedding: the two adapter npm registrations changed native host bytes solely through package.json. Restore package.json exactly to B1; replace those historical aliases with `node scripts/check-observation-adapter.mjs` (build, scoped types, dedicated tests), invoked unconditionally by the existing required source CI job and guarded by `test/governance/observation-adapter-ci.test.mjs`. No metadata exemption, native inventory rewrite or cap adjustment. Earlier npm command logs remain truthful historical evidence. Add a test-only fixed-path bounded flock profile measurement, freeze the parent pin and pass it unchanged to subprocess fixtures; production configured pin remains mandatory. Missing profile fails, with no install/substitution/fallback.

Source-owner-authorized local validation ordering: prove the entire B1 server/config/Worker graph, selected Worker tests/configs and package.json unchanged at87bee; retain1984 passes/4 intentional skips as unchanged-base evidence rather than rerunning the17-minute aggregate locally. Fresh dedicated actual Workerd chain, full Node/types/generated/docs/native/artifact gates and independent review remain required. Any affected Worker graph change/failure requires rerun. Full exact-head supported GitHub CI remains mandatory, with no skipped or weakened gate.


## Final source checkpoint (2026-11-01)

All six staged implementation checkpoints received independent source review. Final source rebases onto B1 `ad0d1ab770010c660c9d5042ae40ffd934f1e010`, adding only the separately reviewed inherited native-test partition/evidence correction beyond87bee. The37 adapter-owned file hashes were unchanged across rebase; all nonowned inherited files match that B1 base. The original reviewed design remains an archived sanitized derivative with unchanged technical requirements.

Fresh post-rebase standalone build/scoped types/adapter167 tests and native source2834 passes/34 documented custody skips/zero failures pass locally. Fresh post-rebase Node2446 tests and generated/aggregate types pass; documentation/governance and unchanged actual observer evidence remain separately scoped source receipts. UnchangedB1 Workers1984 passes/4 intentional skips are not a new-head aggregate run. Native artifact/manifest remain exact baseline0362f947/ac80 with unchanged4MiB ceiling; reporter size is independent. All local source evidence and review remain distinct from mandatory full exact-head supported CI, real installation, activation and release.
