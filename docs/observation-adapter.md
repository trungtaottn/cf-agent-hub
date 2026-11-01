# Bounded local observation adapter

Status: Implemented local source; full acceptance and activation pending; independent staged source review and synthetic offline tests are not installation, pilot activation, supported CI acceptance, publication, or release.

## Scope and activation boundary

This Linux/Node adapter projects the pinned `claude-posttooluse-path-docs-20261101-v1` PostToolUse profile for Read, Write and Edit into path observations. It does not execute tools, discover a checkout, infer a run, read file contents, inspect a transcript, evaluate shell/diff text, install hooks, or report task completion. Coverage is always `unknown`.

The independent artifact is `dist/observation-adapter/reporter.mjs`. Executing it without trusted integration exits zero with no stdout/stderr and no initialization, provider access or network. This neutrality is **not a working installation**. No credential, state path, launch binding, executable path or hook setup is accepted through command-line arguments or hook JSON.

An explicitly authorized operator integration imports `runTrustedHook(prepare, input, invocationStartedAt?)`. `prepare` is trusted synchronous code returning a `TrustedLaunch` or null. The launch supplies exact checkout/profile, canonical observation timestamp, immutable run/principal comparison binding, current-binding callback, private state options and an already enrolled private credential-store directory. The real provider opens `create:false` only after durable pending/refence, uses the existing private provider/lease/proof association and closes at invocation end. The optional fetch implementation is trusted code-only injection for embedding/testing, not user data. Labels and JSON fields never authenticate a caller.

Default start time zero includes Node process startup/imports in the soft two-second budget. Embedded callers pass `performance.now()` captured **before** launch preparation. Input, state operations, provider acquisition, proof dispatch, one HTTP response and persistence share that budget. Synchronous filesystem latency is not preemptible: this is not a hard wall-time promise. There is no background sender, retry loop, or second HTTP request in one invocation.

Before activation the operator must separately approve/install the exact Node/flock installation, launch mapping, observation pilot configuration and already enrolled provider. Explicit trusted initialization through `withStateLock(... purpose:'initialize')` and `store.initialize(binding)` is separate from the normal hook. Missing ordinary-hook state/directory/lock is unavailable, never implicit genesis. No live installation or real credential-store operation was performed for this source work.

## Bounds and durable uncertainty

- Strict UTF-8 JSON: 1 MiB, depth16, nodes8192, at most1024 reads including EOF/empty reads; duplicate keys, unpaired surrogates and nonfinite numbers fail closed. The adapter-local parser accepts finite fractions where the reviewed tool profile allows them; the shared frozen integer-only parser is unchanged.
- Only absolute lexical Linux paths under the exact approved checkout/cwd are projected; stored relative paths are at most1024 UTF-8 bytes. No contents, output, transcripts, raw errors, credentials, proofs or hook payloads enter the durable state.
- Per lane:64 queued records/65536 queue bytes,32768 request bytes,16384 metadata bytes and131072 complete state bytes. Metadata includes framing, bindings and receipts, excluding only independently bounded queue/request body representations. Overflow records local coverage loss; it does not infer completeness.
- A separate open of the stable lock inode is required per invocation. The real fixed configured pinned `flock` is used, not a JavaScript mutex. State directory is current-user0700; files are current-user0600, regular, single-link and nofollow. State must be outside the worktree.
- Pending is synchronously written, file-fsynced, atomically renamed and directory-fsynced before **every** dispatch or owner-status request. Ambiguous post-rename durability is conservatively refenced on the next invocation. Shared-open-description negative controls demonstrate why a shared lock FD is not independent exclusion.
- Establish/replacement receipts persist `awaiting-owner-status` with unknown highwater. A later invocation queries status; no successor highwater is guessed. Unexplained activity, replacement, changed owner/config or denied uncertain work remains held with the original pending intent retained. A later403 is not evidence that an earlier operation did not commit.
- Only four owner routes are exposed by the internal transport: establish, append, replacement and owner-status. Generic CLI/MCP/native owner catalogs and native16/17/18 commitments remain unchanged.

The operator-controlled pinned executable path/hash/version and installation owner are trusted. Identity checks and digest verification do not exclude a malicious installation owner's hash-to-exec replacement. No general mount-policy engine, permission changes or alternate binary is used. Process-crash tests are not power-loss certification. The test-only acquisition-stall seam preholds an independent lock and substitutes blocking flock only after asserting production nonblocking arguments; it confirms SIGSTOP before releasing the preholder. This tests acquisition lifetime/FD cleanup, not that the stopped child acquired the lock. Ordinary nonblocking contention and parent death after successful acquisition are separately exercised. A deliberately stopped acquisition child after hard parent death requires explicit test teardown; automatic reaping in that scenario is not claimed. A wrong-owner chown fixture was not executed without authority.

## Source verification

Run the standalone required gate with the pinned Node24.22.1 and installed reviewed dependencies:

```sh
node scripts/check-observation-adapter.mjs
```

It builds the separate artifact, runs `tsconfig.observation-adapter.json` and the actual dedicated Vitest suite. The existing required CI source job invokes it unconditionally after `npm run check`; a governance test guards registration and fail propagation. `package.json` remains byte-identical to the final reviewed B1 base because it is part of the frozen native host's embedded inventory. Earlier implementation checkpoint npm aliases were removed rather than exempted from that inventory.

The synthetic test profile measures the trusted image's fixed `/usr/bin/flock` with bounded nofollow hashing and bounded `--version`, freezes the parent pin and passes that exact pin unchanged to children. No installation, PATH lookup, substitution, emulated lock or production pin relaxation occurs. Missing/unsupported installation fails the gate. Profile measurements are test evidence, not operator approval for an installation.

Evidence includes genuine synthetic protected-store enrollment/reopen through actual local Workerd routes; a real flock/durable reporter/provider/server chain; exact replay fingerprints; authorization/config invalidation; one HTTP per invocation; actual multiprocess contention and SIGKILL checkpoints; loopback durable commit with lost/delayed responses; and built-entry stdout/stderr neutrality without diagnostic suppression. Synthetic local server tests do not replace the genuine Worker authorization tests, and neither is a real two-agent pilot. Two synthetic agents/credentials/checkouts are attributed to their distinct configured lanes; making one existing lane unsupported sends no request and creates no additional session.

The native host regression checks **4,170,954 bytes**, unchanged4MiB cap, SHA256 `0362f94729789325c39c7c45d52ef039dafae164a1a2a40130268ee5bfb67cfa`, and exact baseline manifest. The adapter measures3,460,327 bytes (SHA256 `e86dd63e00b420168bfbc2b233f9ebd8687f953a3b1dab8d03a2120c61f1b3f0`) with a separate build graph; its artifact is not part of that native commitment.

The initial execution base was B1 `87bee667fc72cbe88750545330abf220d9298e8a`; final source is rebased onto reviewed B1 `ad0d1ab770010c660c9d5042ae40ffd934f1e010`. The latter corrects three inherited native test assumptions by explicitly partitioning the frozen33 R2 operations from the current34 read-capable surface; frozen proofs and native build inputs are unchanged. All37 adapter-owned files remained byte-identical across that rebase. The original reviewed design provenance is unchanged.

Post-rebase local evidence: the standalone adapter build/types gate passes167 tests in11 files; native source regression passes2834 with34 documented platform-custody skips, zero failures. Skips are **not** native acceptance. The adapter artifact regression reproduces exact native host bytes and manifest. Fresh post-rebase Node suites passed2446 tests in112 files; generated contracts and aggregate types passed. Documentation and governance passed locally; the unchanged actual local observer previously completed7 observations/184 service requests. These are source-only receipts, not full supported CI or deployment evidence.

The unchanged B1 server/config/Worker graph/package/selected tests permit reuse of the source-integration **1984 passed/4 intentional skips** baseline as unchanged-base evidence, not new-head execution. Fresh adapter actual Workerd tests cover the current integrated chain. Full exact-head supported CI remains mandatory before acceptance; no skipped local test is counted as a passed gate. No live pilot or installed integration was performed.
