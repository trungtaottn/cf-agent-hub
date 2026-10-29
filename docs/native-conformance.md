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

The host composition API is a bounded execution framework, not a complete deployed evidence producer. Its public return is a `producer-fragment` with external inspection pending. Protected observation references are bound to controller-owned invocation/process/source/config/actor/workspace facts; they are not authenticated live evidence or all 380 preparation records. Opt-in recording can assemble a scoped native37 structural fragment only when all required actual originals are supplied. A trusted deployment integration must still provide those originals with independently inspected custody.

The scenario separately identifies local wrong-target/runtime/proof-store no-send checks and the separately authorized **server** foreign-workspace producer definition and still-unimplemented server runtime-proof denial producer. These are different claims. Even if all currently executable source steps complete, those external requirements and live authority keep issue48 incomplete. Do not close issue48 from this source checkpoint.

The fixture declarations are closed to `swap-slot`, `swap-generation`, `swap-principal` and `server-foreign-workspace`, each tied to the submitter role and its separately admitted current native principal/store. The full scenario requires all four before any effect. They are pre-provisioned authorized isolated fixtures, not permission to mutate the main store.

The server foreign-workspace source scenario uses a separate imported-but-unenrolled store: foreign GET 401, then same-credential own GET 200. Independently observed null binding/no runtime proof, unchanged credential slot/generation/principal/current own read grant, and foreign resource existence/non-admission are required. The negative no-effect/no-leak observation precedes the positive control. This source definition does not provision the store or authorize either request. Live execution and actual observer integration remain pending.

Controller observations bind the exact nullable `httpStatus` to the source scenario, so a foreign 403 cannot masquerade as the required 401. Null means no observed final HTTP response for local/no-response steps, not numeric status zero. This controller metadata is distinct from closed issue47 typed observations, whose retained/no-send rows omit HTTP status entirely.

## Scoped native evidence projection

The source-only `assembleNativeEvidence` module accepts bounded, already-materialized protected original records. It reserves cumulative byte lengths before decoding or hashing; the host reader still owns pre-read filesystem limits. It does not authenticate these records, open files, contact a deployment, or create the missing observer/harness records.

A successful structural result covers exactly37 native cases, with a distinct scoped preparation fragment. Each subject must actually be prepared before its own case validation harness starts. A successful validation harness exit0 is not a relabeled CLI exit: negative product invocations retain their actual3/5. The Git tree40hex and the issue47 canonical source inventory SHA25664hex remain different commitments. Retained/no-send typed observations omit HTTP status; no numeric zero or invented response is exported.

R2 evidence format 3 can represent actual per-case preparation times for dynamically generated later subjects; see [the release evidence contract](r2-release-evidence.md). The scoped fragment still reports `rootMergeStatus: pending-authenticated-global-preparation-timeline` because no authenticated global 380-case aggregate is created here. No 343 filler cases or backdated aggregate preparation receipt is emitted. Independent subjects, resource/transport/journal/scan measurements and authorized revocation observations must still come from the trusted host; the recorder derives only its own actual invocation, lifecycle and validation-completion records. Missing originals return an incomplete fragment without partial evidence exports. Synthetic contract fixtures are not live observations.

The scoped projector checks per-operation native conformance and the explicitly required retained-intent/revocation causal joins. It does not independently establish the entire successful task/run/artifact scenario DAG from37 rows; that requires actual controller-owned prior-step preparation/resource joins. A structurally valid native fragment is therefore not a claim that the whole scenario was executed, nor a replacement for the separate graph/recovery/platform evidence families.

## Opt-in owned recording

The controller accepts an optional, closed third-argument evidence context (`environment_id`, `config_epoch`, `observer_id`, `source_inventory`). Its run ID is generated by the controller. This mode requires explicit trusted-host `describeEvidence`, `prepareEvidence`, `observeEvidence`, `observeAuxiliaryEvidence` and `observeDisableEvidence` methods before admission. The default command installs none of them and grants no authority.

`prepareEvidence` supplies only an independently observed subject and its source record ID. The controller derives and retains the exact source-built argv snapshot it executes, invocation digest and actual preparation/wrapper times. Typed retrieval methods return closed `{record: {id, sha256, bytes}, usage}`; the recorder joins it to the existing generic observation and the actual protected child-process originals. It does not accept caller-selected success, timestamps or wrapper exit codes. Operation-inapplicable keys/proofs and incomplete current runtime bindings fail before preparation is emitted.

Before reading process-original payloads, a single handle-bound reservation charges all three exact record lengths and slots against the run-wide budget. The reader pins an admitted private directory, derives only the expected filenames, checks private single-link regular files and exact committed sizes, then verifies descriptor/name identity and digest stability. Failed or uncertain reads do not refund the reservation. Source metadata/negative tests do not establish real positive filesystem custody under the current managed runtime restriction.

Recorder output is explicitly **memory-only**: no durable recovery, no successful restart reconstruction and no crash-survival claim. Failed, reordered, missing or backward-clock observations cannot produce a successful wrapper. A completed per-case wrapper means its scoped typed-recording checks completed; it does not mean every later controller/scenario check completed. Full typed-case validation is still required. The recorder now captures exactly `prepare/fail-create`, `prepare/revoke-own-positive` and `control/revoke-submitter` as auxiliary originals, not invented native cases. Owned completed bindings feed scoped assembly; the protected accessor remains `partial-originals-pending` until assembly succeeds, then exposes a `structural-fragment` with external inspection pending. No complete live result is implied.

Assembly now also offers an opaque two-phase interface: validate immutable exact core inputs, record the actual completed validation command, then finalize against that process-local token. No synthetic provisional completion receipt is needed. Final timing, schema and exact-size gates can still reject after a successful core validation. The legacy one-shot interface and full validator findings/order are preserved. This does not supply the still-missing authenticated global380 originals or prove the full successful scenario DAG.

### Evidence-specific accounting and custody

Opt-in evidence mode preflights exactly 40 typed retrieval costs and one assembly cost alongside the base plan, under the same cumulative caps. Missing costs block before effects; explicit zero cost is a trusted host declaration, never an inferred default. Assembly reserves one command and charges its actual serialized output plus completion original. Returned original bytes must fit the assigned output reservation.

Recorder-owned capture facts are supplied before the generic observer/control producer commits its original digest. Later retrieval must match that digest. Generic commitments and usage are copied into immutable closed snapshots immediately, before subsequent authorization or retrieval awaits. Finishing keeps its active lifecycle slot reserved during descriptor capture, and revocation disable is one attempt even after failure. These controls prevent local commitment drift or retry ambiguity; they do not establish the host's authenticity.

## Source-owned resource binding registry

The controller's mandatory `native-r2-bindings.mjs` registry uses the fixed source scenario order and predecessor edges, independently of optional typed recording. It rejects substituted known task/run/runtime/artifact/content path references before dispatch. For bound operations, completed owned transcripts then pass canonical generated response validation and fixed identity, state and version comparisons before becoming usable predecessor bindings. Main, fail, cancel and requeue task fixtures remain distinct; submit preserves the original run and committed artifact, and acceptance uses a distinct reviewer principal and agent. Artifact download stdout is metadata, not a new binary receipt.

Controls advance the registry only after existing generic and optional typed observation checks. Process bytes and custody are detached before awaited host callbacks, bounded by the admitted process output allowance and checked against complete transcript digests. Tokens are process-local, single-use and non-reentrant; a failure makes the journey unusable rather than admitting a replacement. A private detached summary supports diagnosis, not release evidence or authorization. Synthetic registry tests establish consistency logic, not authentic execution.

This is deliberately **not complete request authority**. The controller now admits an owned raw input snapshot, validates source-known body resource relationships and supplies its digest to the CLI same-buffer gate described below. A path or prepared digest alone still cannot prove that a failed invocation reached that gate, authenticate host intent, or establish full external consumption provenance. Output mismatch detection cannot undo a prior effect. Lists are bounded pages, not complete workspace enumeration. Local wrong-runtime/foreign/swap probes retain their deliberate mismatches and cannot update successful resource bindings or substitute for server-denial cases.

The missing concrete host adapter, command-entry orchestration, server wrong-runtime-proof producer and authenticated global380 composition remain explicit source/integration work. Their interfaces and operator questions are recorded in the [issue48 plan](r2-task-plans/issue-048.md). The protected runtime guard, root2/root3 evidence dispatch, native37 roster and post-R4 acceptance boundary are unchanged.

Typed recording finishes before the mandatory resource binding is promoted. If that later binding check fails, protected diagnostic records may retain the already completed scoped per-case wrapper. The controller still returns incomplete, does not include the failed step in its completed count, and never runs final scenario assembly. Wrapper presence alone must not be treated as controller/scenario completion or reused to manufacture complete evidence.

### Message output lineage

The fixed scenario now validates create-message, reviewer inbox, ACK and thread
responses with canonical generated schemas. The created message must bind the
workspace, submitter, sole reviewer recipient and known main task. The default
unacknowledged inbox must contain that exact message before its first ACK; ACK
may acknowledge only that observed message. Thread dispatch uses the captured
thread ID, and its response preserves the original message except the
reviewer-specific non-null acknowledgment time. Duplicate IDs, substituted
content/identities, unexpected recipients and unrelated thread rows fail closed.

An inbox or thread page that omits the required target is incomplete scenario
evidence even when `has_more` is true; this does not declare the API page invalid.
The runner does not invent extra pagination requests beyond its budget. Other
valid inbox items remain allowed. Other same-thread messages need not name the
reviewer as recipient because thread participation allows reading history.

The protected summary reports `source-consistent-output-lineage` only after this
chain completes. It still reports request-body custody pending. An observed ACK
is recipient acknowledgment, not delivery/execution/acceptance proof, and output
checks cannot prevent or undo an already wrong request body.

### Controller-owned exact-byte input admission

The CLI accepts optional `--input-sha256` on body commands and checks it against
the same bounded file bytes that it parses, before protected-store/network
effects. Equivalent JSON with different raw bytes does not match. Legacy
commands without the pin retain their existing behavior.

`executeNativeScenario` now constructs the source-owned input admission ledger
before scenario effects: all 27 input steps reserve 65,536 bytes each, totaling
1,769,472 bytes under a separate 8 MiB input ceiling. This does not consume or
increase output/evidence budgets. Each source step gets one attempt; failure
poisons the ledger without refund. The reader pins a private admitted parent
and regular single-link 0600 file, bounds allocation before reading, checks
name/descriptor/parent identity and metadata before and after, hashes captured
raw bytes and uses fatal UTF-8/JSON parsing. No caller digest or body replaces
that read. Bodies are transient; protected summaries retain step/digest/size
metadata, not raw bodies or public paths.

Strict registry pre-admission uses generated request schemas and checks known
task/runtime versions, run/fence, retained artifact size/hash, committed artifact
references, reviewer recipient/main-task/fresh-thread message relationships,
and exact observed message ACK IDs. The intentional foreign-runtime no-send
probe remains schema-only for its independently observed foreign version.
Operator-selected text/routing values are not authenticated by this check;
the CLI remains final authority for generated byte rules and request preparation.
This is schema/resource pre-admission, not complete request validation or semantic
response-echo proof.

The current controller always uses strict admission and the pinned builder.
Recorder and nonrecorder paths share the same frozen argv; recorded argv is
compared before spawn. The 79-byte digest argument adds 82 serialized JSON bytes;
final argv retains 128-argument, 8,192 UTF-8-byte per-argument and 65,536-byte
serialized bounds. Historical builders, registry/recorder preparation APIs and
root-2/root-3 originals remain explicitly unpinned and unchanged. No new evidence
field or retroactive consumption claim is added.

A file replaced between controller admission and CLI reading must contain the
same admitted bytes or fail the CLI input gate before store/network effects.
Prepared argv or a failed exit alone does not establish that the gate was reached.
Raw-file SHA, canonical HTTP-body SHA and external observer commitments remain
distinct. Full host authorization, actual consumed-body provenance and live
native37/global380 acceptance remain pending.

Local verification distinguishes pure relationship/builder/recorder tests and
source-text controller wiring checks from actual execution. In the current
managed environment, all authorized fixture roots have Git ancestry; 19 new
reader disk tests explicitly skip rather than weaken that guard. Their FD,
parent/name swap and positive raw-byte coverage remain unverified locally and
must run on an eligible ordinary test host. Existing protected runtime custody
coverage remains separately skipped. Green source tests do not complete #48.


### Executable local backend integration (separate from native conformance)

The exclusive `--local-sandbox` mode now composes a source-owned real local
Worker/SQLite/emulated-R2 fixture, two synthetic native identities, independent
selected SQL observations and configuration-disable control. It exercises
actual server handlers directly, not a built CLI child or network TLS. Its
closed local report and exit status never satisfy this native evidence contract.
See [local sandbox scope, commands and limits](local-native-sandbox.md). Default
protected `--config` conformance remains blocked without its real host adapter.

## Source-owned request preparation

The private binding registry now plans each of the 27 source-known JSON request
bodies from its exact next step and previously validated outputs. Fixed synthetic
text and current versions, IDs, fences, artifact digests and message relations
replace delegated host body construction. Plans are detached immutable canonical
JSON with exact byte length and SHA256; planning alone is not an admitted or
consumed-input record.

The controller reserves a separate 27 × 65,536-byte publication budget, obtains
fresh current authority after host preparation, and exclusively creates the
input beneath the qualified fixture root. It never overwrites or deletes an
existing/uncertain input. The existing protected raw reader then checks exact
planned bytes before strict relationship validation and the CLI same-buffer pin.
Publication failure stops before process dispatch and retains protected files.
A same-UID hostile writer is not contained by this mechanism; the pin still
matters and no authenticated consumption claim is inferred from publication.

The protected entry still lacks its real host adapter. The bounded
[producer integration design](native-host-producer-design.md) distinguishes code
we still must implement from the small set of operator trust/capability choices;
it does not install a service or fabricate authority.

## Protected-entry source/config readiness diagnostic

A valid protected `--config` input now emits bounded diagnostic JSON on stdout
and retains exit 3 plus the blocked stderr summary. Invalid or unsafe input still
has empty stdout and exits 2. The JSON type is `native-r2-source-readiness`, not a
release evidence receipt or preflight authorization. It is deterministic, at most
16 KiB, and does not echo supplied paths, principals, origins or credential data.

The diagnostic joins the actual fixed scenario's actor roles and explicitly
required fixture stores with the supplied configuration. It identifies absent
roles/stores and source-known insufficient command, mutation, artifact and output
budgets. Current necessary lower bounds are 68 command reservations, 34 mutation
reservations, 2 artifact bytes across two separately reserved steps, and 56 output
bytes across non-control steps. These are only necessary minima, not useful
execution budgets or full admission: observer, control and evidence costs remain
unknown until the actual adapter is available.

All 68 source steps and the two separate external-observer obligations are
classified. Even with every fixture declaration present, each of the three
slot/generation/principal-only controls remains explicitly unsupported under the
current contract. Local producer success is not native capability. An exact
source-scenario digest guard rejects unreviewed future classification changes;
it does not amend the scenario, its case roster or acceptance semantics.

Only the existing protected config-file read has happened at this entry point.
Executable/store custody, installed authority, network observation, subprocess
execution, full budget admission and native acceptance remain unperformed.
There is no partial execution, extra secret lookup, installer or configurable
module loader. Source classification failure remains blocked with no raw errors.
The diagnostic improves actionable failure information; it does not complete
the still-missing fixed native host adapter or authorize real fixture effects.

### Captured-output verification boundary

The recorder-enabled controller reserves an additional 159,744 output bytes
(39 originals at 4,096 bytes each) in the same cumulative run budget before
scenario effects. It reuses the existing protected prepared/spawned/final read
once, before host observation, and joins detached stdout/stderr bytes to the
actual final original's subjects, invocation, exit, lengths and digests.
A source-owned parser covers all 33 native operations; the older lineage parser
retains its original operation applicability. Invalid syntax retains a bounded
failed-check original and prevents subsequent observer composition.

The verification original is private, copy-returned and memory-only. It reports
secret-inventory, foreign-identifier, artifact-byte, transport and prepared
invocation checks as **not evaluated**. Valid JSON, a masked enrollment response,
or a recognized exit-5 diagnostic cannot establish leak absence, no-send,
artifact integrity, journal settlement or native acceptance. Existing three-file
prepared-invocation joins remain necessary. No new evidence role or acceptance
version is introduced; installed authority and the three unsupported tuple-only
controls remain unresolved.
