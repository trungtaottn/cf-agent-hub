# Native R2 conformance runner

Status: **source development; live conformance blocked**. A passing source test, protected JSON file, HTTPS URL or synthetic receipt does not verify F24. Formal acceptance remains deferred until after R4. Issue40 independent signoff and the complete issue47 regression are still pending.

## Commands

- `npm run test:native:r2:source` checks source contracts with synthetic data and bounded local subprocess negatives. It makes no live acceptance claim.
- `npm run test:native:r2 -- --config <absolute-protected-config-path>` is a dedicated protected-input consumer, not a Vitest `--config` alias. Missing/unsafe input exits2 before any request. No trusted live authority/observer/control adapter is bundled; valid protected input exits3 with an explicit blocked message, not a pretend pass.

The source API separates structural configuration, independently authorized host integration, immutable executable custody, owned-process execution, bounded scenario steps and typed observation assembly. Supplying an adapter object is not proof of its authenticity. A deployment operator must review and provision that integration independently before enabling any execution path; config cannot name arbitrary modules or shell commands.

## Protected configuration

Version1 has closed keys: `candidate_sha`, `candidate_tree_sha`, `composition_sha256`, `node` and `build` path/SHA pairs, an exact HTTPS `origin`, distinct primary/foreign `workspaces`, native `actors`, explicit `fixture_stores`, `fixture_directory`, `output_directory`, `authority_record_sha256` and finite `budgets`. Paths and origins are private execution input. Do not put actual config, stores, tokens, runtime proofs or original transcripts in a repository, PR or public evidence bundle.

Actors have `id`, equal native `principal_id`/`agent_id` and an existing protected `state_directory`. Independent actors have different principal/agent/store identities. Alternate credentials for one agent need separate explicitly authorized controls; inventing another principal is not equivalent. Credentials must already be provisioned through the approved protected-store procedure. The runner does not import tokens from configuration or argv.

State, fixture and output directories must preexist, be private and canonically disjoint, have safe ancestry and no Git ancestry. The existing CLI storage checks remain unchanged. A protected-file mode alone does not establish state-store eligibility. If environment ancestry blocks an otherwise positive rehearsal, retain that blocker; do not move the fixture into an alternate root to bypass the guard.

## Authority and budgets

An independent host integration must bind the exact candidate/tree/composition, Node/build bytes, application/provider deployments and namespaces, both workspaces, actual credential/store slots/generations, current grants/runtime proofs and allowed fixture effects. TLS, a workspace GET, a configured `isolated` flag or an arbitrary hash cannot establish that authority. Authorization must be fresh at each effect, with explicit expiry. Config rejects classification flags rather than trusting them.

Reserve complete scenario upper bounds before dispatch, including observer/control/provisioning/fault actions. Unknown control costs block execution. Counters are cumulative across the run; one monotonic deadline bounds all steps. Retained uncertain reservations are never automatically refunded. stdout and stderr share a bounded output allowance. Never silently omit a live case to fit a budget.

## Process and evidence custody

Use an absolute independently pinned Node executable plus exact bundle, never PATH/shebang or an inherited loader/proxy/token environment. Persist a prepared record before spawn and PID/start/boot identity immediately afterward. A crash in that gap is **unknown**, not evidence that no request was sent. No automatic retry or kill-by-stale-PID is allowed. Timeout signalling affects only the owned child; even an observed child close does not prove descendant or remote cleanup.

Original streams, argv/config commitments and process identity are protected custody records, not public release artifacts. Hashing an arbitrary private value is not sanitization. Public projections must contain only schema-allowlisted non-secret fields. Missing observer/state/request records remain missing; unrelated local SQL snapshots or stdout cannot substitute.

The managed local Node runtime is owned by a UID outside the new harness's current-owner/root policy. No independent host ownership attestation has been obtained. Positive process-custody tests therefore remain blocked; no Node copying/chown, exception hardcoding or existing storage guard weakening is authorized by this document.

## Reachable replay semantics

The built CLI executes once and exits. Its Linux replay clock has a process-random epoch. A restarted uncertain intent cannot prove continuity; both uncertain restart dispatch and settled intent dispatch fail closed with exit5/no-send. These are the issue47 cases `native/lost-response-retained`, `native/restart-no-send`, `native/settled-no-send` and `native/revoked-after-disable`. A source-only same-process coordinator replay is not deployed executable evidence.

Readback and intent inspection do not settle the retained journal, release uncertain holds or authorize a new key. Revocation belongs to a separately authorized control fixture, not the native command map. Preserve uncertainty and diagnostic custody; no automatic destructive cleanup follows a failure.

## Current source boundary and remaining implementation

The host composition API is a bounded execution framework, not a complete deployed evidence producer. Its public return is a `producer-fragment` with external inspection pending. Protected observation references are bound to controller-owned invocation/process/source/config/actor/workspace facts; they do not yet constitute a complete typed issue47 family or all380 preparation records. A later trusted integration must provide the real native37 fragment and scoped preparations, with original-record custody, before downstream assembly can validate it.

The scenario separately identifies local wrong-target/runtime/proof-store no-send checks and the separately authorized **server** foreign-workspace producer definition and still-unimplemented server runtime-proof denial producer. These are different claims. Even if all currently executable source steps complete, those external requirements and live authority keep issue48 incomplete. Do not close issue48 from this source checkpoint.

The fixture declarations are closed to `swap-slot`, `swap-generation`, `swap-principal` and `server-foreign-workspace`, each tied to the submitter role and its separately admitted current native principal/store. The full scenario requires all four before any effect. They are pre-provisioned authorized isolated fixtures, not permission to mutate the main store.

The server foreign-workspace source scenario uses a separate imported-but-unenrolled store: foreign GET 401, then same-credential own GET 200. Independently observed null binding/no runtime proof, unchanged credential slot/generation/principal/current own read grant, and foreign resource existence/non-admission are required. The negative no-effect/no-leak observation precedes the positive control. This source definition does not provision the store or authorize either request. Live execution and actual observer integration remain pending.

Controller observations bind the exact nullable `httpStatus` to the source scenario, so a foreign 403 cannot masquerade as the required 401. Null means no observed final HTTP response for local/no-response steps, not numeric status zero. This controller metadata is distinct from closed issue47 typed observations, whose retained/no-send rows omit HTTP status entirely.

## Scoped native evidence projection

The source-only `assembleNativeEvidence` module accepts bounded, already-materialized protected original records. It reserves cumulative byte lengths before decoding or hashing; the host reader still owns pre-read filesystem limits. It does not authenticate these records, open files, contact a deployment, or create the missing observer/harness records.

A successful structural result covers exactly37 native cases, with a distinct scoped preparation fragment. Each subject must actually be prepared before its own case validation harness starts. A successful validation harness exit0 is not a relabeled CLI exit: negative product invocations retain their actual3/5. The Git tree40hex and the issue47 canonical source inventory SHA25664hex remain different commitments. Retained/no-send typed observations omit HTTP status; no numeric zero or invented response is exported.

The global380-case preparation timeline cannot yet represent dynamically generated later native subjects without additional reviewed integration. Therefore `rootMergeStatus` remains `pending-authenticated-global-preparation-timeline`, even when all local structural checks pass. No343 filler cases or backdated aggregate preparation receipt is emitted. Current framework observations alone do not supply the required per-case prepared subjects, original validation-harness execution records, independent resource/transport/journal/scan measurements, revocation causal records, or actual assembly execution record. Missing originals return an incomplete fragment without partial evidence exports. Synthetic contract fixtures are not live observations.

The scoped projector checks per-operation native conformance and the explicitly required retained-intent/revocation causal joins. It does not independently establish the entire successful task/run/artifact scenario DAG from37 rows; that requires actual controller-owned prior-step preparation/resource joins. A structurally valid native fragment is therefore not a claim that the whole scenario was executed, nor a replacement for the separate graph/recovery/platform evidence families.
