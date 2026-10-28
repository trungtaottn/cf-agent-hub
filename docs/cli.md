# CLI command contract

Status: CLI command surface planned · Contract revision 0.1 · Local persistence/provider groundwork implemented; distribution and operational acceptance pending.

The planned `cf-agent-hub` CLI is a thin native HTTP client for external runtimes and operators inspecting their workspace. The name and commands below are proposed interfaces; no package installation command, released binary or working login flow is supplied. Contract fixtures can be reviewed now. Execution examples become onboarding instructions only after the CLI is implemented and verified.

## Connection and credential ownership

Every command selects an HTTPS hub origin and an explicit workspace ID. A saved local context may supply those values, but the CLI must print the selected context before an interactive mutation and record it in the local operation journal and on standard error, keeping machine-readable standard output within the native envelope. It must never guess a workspace from the last task ID or an ambiguous list. The origin is deployment configuration; a workspace profile cannot change it.

Proposed configuration inputs are `CF_AGENT_HUB_URL`, `CF_AGENT_HUB_WORKSPACE`, `CF_AGENT_HUB_TOKEN` and, for runtime-bound commands, `CF_AGENT_HUB_RUNTIME_TOKEN`. Native and runtime tokens must be injected through a process environment or protected credential store; avoid command-line secret arguments, shell history, output logs and shared project files. Environment values are operational secret inputs, not configuration-preset fields. There is no native credential in browser localStorage.

Runtime enrollment returns a one-time opaque `runtime_token` bound to the issuing native credential, agent, workspace and runtime. The CLI must persist it securely before using the runtime. A lost enrollment response requires a fresh enrollment; replay cannot recover the token. Credential rotation, revocation, expiry or runtime expiry invalidates the proof, so a replacement credential must enroll a new runtime. A running process does not inherit authority merely by keeping the same display name.

## Proposed command mapping

All commands map to [native HTTP operations](http-api.md); state and permission checks stay on the server. `--json` returns the native envelope, with one explicit secret-handling exception: after successful secure capture, runtime enrollment output retains the envelope shape but replaces `runtime_token` with null and `revealed` with false. It must never echo the secret-bearing initial HTTP response. File inputs below are JSON request bodies validated against the [OpenAPI schemas](../spec/openapi.json).

| Proposed command | Native operation | Required behavior |
| --- | --- | --- |
| `workspace show` | `getWorkspace` | Show actor, workspace and effective scopes |
| `agents list` / `agents show ID` | `listAgents` / `getAgent` | Read durable identity, not claimed presence |
| `runtime register --input FILE` | `createRuntime` | Enroll this process and securely capture one-time proof |
| `runtime heartbeat ID --input FILE` | `heartbeatRuntime` | Update presence with both credentials |
| `tasks list` / `tasks show ID` | `listTasks` / `getTask` | Bounded state-aware reads |
| `tasks create --input FILE` | `createTask` | Create Backlog work |
| `tasks ready ID --input FILE` | `readyTask` | Schedule current version after holds/policy checks |
| `tasks claim ID --input FILE` | `claimTask` | Claim with runtime identity/proof and expected version |
| `runs show ID` / `runs heartbeat ID --input FILE` | `getRun` / `heartbeatRun` | Inspect or renew active lease |
| `tasks request-decision ID --input FILE` | `requestTaskDecision` | Freeze proposal/input evidence and end the attempt |
| `tasks submit-result ID --input FILE` | `submitTaskResult` | Submit evidence to Review; never imply Done |
| `tasks fail ID --input FILE` | `failTask` | Record failed or uncertain outcome |
| `tasks cancel ID --input FILE` | `cancelTask` | Explicit cancellation with current version and reason |
| `inbox list` / `threads show ID` | `getInbox` / `getThread` | Preserve cursor and complete retained history |
| `messages send --input FILE` / `messages ack --input FILE` | `createMessage` / `ackMessages` | Keep admission and receipt distinct |
| `artifacts stage --input FILE` | `stageArtifact` | Reserve immutable manifest and upload deadline |
| `artifacts upload ID --file FILE` | `uploadArtifactContent` | Stream raw bytes matching manifest, with runtime proof for native writes |
| `artifacts commit ID --input FILE` | `commitArtifact` | Verify bytes and ownership before association |
| `artifacts download ID --output FILE` | `downloadArtifactContent` | Authorize committed content and write safely |
| `events list` / `search --query TEXT` | `listEvents` / `searchWorkspace` | Bounded, permission-filtered inspection |

Human-only approval and administration commands are deliberately absent from the native-agent CLI contract. The independent result-review surface is separately authorized. A future human CLI session needs its own verified identity/CSRF-equivalent flow; pasting a native token into a command must never emulate it.

## Mutation identity and machine behavior

Every mutation requires `--idempotency-key KEY`. For an interactive invocation, the implementation may generate a fresh key only after it durably records that command intent in its local operation journal. A retry reuses the stored key and exact body. Noninteractive automation must explicitly provide or durably generate the key. Neither a timeout nor a version conflict permits automatic creation of a new intent.

The proposed CLI keeps JSON on standard output and progress/diagnostics on standard error. Human-readable mode must retain request ID and relevant entity/version information. Secrets are never printed in ordinary JSON or verbose diagnostics; enrollment captures the one-time token through a dedicated secure storage path. A failed secure write must tell the operator enrollment may have succeeded and require fresh enrollment, without logging the token. The CLI must not claim success until it has received and parsed the expected success envelope.

| Exit status | Proposed meaning |
| --- | --- |
| `0` | Command/read succeeded according to the returned envelope |
| `2` | Local input/configuration error; no request sent |
| `3` | Authentication or authorization rejected |
| `4` | State/version/idempotency conflict requiring reconciliation |
| `5` | Retryable transport/dependency problem or unknown mutation outcome |
| `6` | Other nonretryable server rejection |

These numeric process statuses are CLI contract values, not retry budgets. On an unknown mutation outcome, preserve the journal record and key. Report that the outcome needs reconciliation rather than saying the operation failed definitively.

## Pagination, uploads and operational recovery

`--limit` and `--cursor` expose bounded pages. An optional `--all` is planned only as an explicit sequential traversal with progress, interruption and a local output budget; it cannot disable server limits. Print continuation metadata so callers never mistake one inbox/thread page for all history. Interrupted traversals retain the last cursor; expired cursors require a new read.

For artifacts, compute size and SHA-256 locally, stage the manifest, stream bytes, inspect status after ambiguous upload, then commit the verified object. Never overwrite a committed artifact or revive an expired cleanup tombstone. Result requests refer only to committed IDs. Approval requests additionally reference the exact immutable JSON input artifact and digest that the human reviews.

The CLI does not start models, schedule wakeups, clear uncertainty holds, reset retry budgets or execute arbitrary remote commands. A failed heartbeat stops further task effects pending reconciliation. See [delivery semantics](delivery-semantics.md) for the response-loss and external-action cases.

## Acceptance criteria

Before distributing a CLI, verify command-to-operation mapping, JSON/error envelopes, explicit workspace selection, secure credential capture, redaction, cursor continuation, interrupted upload and same-key retry after a committed-but-lost response. Exercise wrong-workspace and wrong-runtime proofs, expired leases and approvals, unexpected content types, safe output-file handling and nonzero exits. Document supported platforms and package provenance only after actual builds are produced; this baseline supplies neither.

## R2 recovery contract boundary

The [issue #22 recovery decision](adr/r2-recovery-contract.md) defines the closed V1/V2 envelope, simultaneous SQL-plus-artifact bounds, trusted private bindings and bounded future restart state. This is a contract, not enabled V2 recovery. Current runtime remains V1-only; nonzero artifact capture budgets and V2 restore are unavailable. No new CLI command or caller-selected bucket/key/URL is added. Existing protected files, HMAC authentication, separate AES-GCM file protection, operator Access identity, current ledger, maintenance and explicit resume remain required.

## Local shared-client prerequisite (issue38)

The typed native facade and bounded stream hooks exist in source. Issue41 now adds the local protected provider and durable journal described below; a distributed CLI and cross-platform support do not. The [client contract](http-api.md#local-typed-native-client-facade) reuses the browser's transport without using browser cookies or human-only administration. Generated operation support is not proof that a deployment enables that route.

Enrollment deliberately uses `enrollRuntime` with mandatory protected capture and returns safe `Runtime` metadata only. Its process-local receipt rejects forged/copied/cross-provider provenance but is not a durable store format. Issue41 must validate protected-store integrity/writer ownership and restore/import associations before trusting persisted bindings. Arbitrary token imports remain unbound for ordinary mutations until a supported explicit binding flow succeeds. No parsed bearer identifier or caller principal label is evidence. Credential rotation cannot silently rebind unresolved journal entries.

The earlier proposed CLI JSON projection remains a CLI presentation rule: after confirmed secure capture, issue41 may construct its documented redacted enrollment envelope. The shared transport does not falsify wire `RuntimeIssue.revealed` or return a secret-bearing response to ordinary callers. `CREDENTIAL_CHANGED`, `REQUEST_TIMEOUT`, `REQUEST_ABORTED`, network failure and capture failure can occur after dispatch; the error code alone never authorizes clearing or replaying a journal entry. Journaled calls must preserve and pass `expectedBinding` with the exact target/body/key, then apply the reviewed finite replay horizon and no-send reconciliation rules.

There is no implemented all-pages helper. Artifact consumers must await stream completion and their own destination write, and must not treat receipt of binary response headers as a completed download. Source tests and synthetic Workers transfers do not establish installed CLI, package distribution or deployed-native conformance.


## Local durable CLI groundwork (issue41)

`packages/cli/src` implements the Linux protected SQLite backend, mutation journal, credential/proof provider, conservative clock and `DurableMutations` coordinator. These are source APIs, not installed commands or permission to import a real token. [ADR0009](adr/0009-r2-cli-local-durability.md) owns the accepted threat model, filesystem policy, limits and unsupported operations; [execution evidence](r2-task-plans/issue-041-execution.md) separates local tests from release gates.

Use explicit private directories outside the checkout. `journal.sqlite` stores exact sensitive user task/message bodies; `secrets.sqlite` stores credential/proof material and initial enrollment attempts. Both are access-controlled plaintext, **not encrypted files or OS keychains**. Never copy either to logs, audit reports, issue evidence or ordinary diagnostics. Existing insecure paths fail rather than being repaired. Storage failure never authorizes unjournaled network dispatch. No automatic expiry/eviction removes unresolved operations; new admission stops at the documented cap. Seven-day settled pruning is explicit eligibility, not guaranteed erasure or a maximum age.

For ordinary JSON mutations, `prepare` records the immutable operation/target/query/body/context and verified slot/principal binding. Noninteractive callers supply a key; interactive generation occurs only after a keyless record commits. `dispatch(id)` reconstructs the stored canonical request, uses the same key and `expectedBinding`, durably records the first-dispatch stamp and sends at most once. It does not retry, enroll, rotate, rebase or invent a new key after failure. Raw artifact upload replay is closed in this coordinator until issue44 provides retained file/digest binding; the existing bounded native stream API is unchanged.

Initial `prepareEnrollment` uses a distinct protected unbound attempt (`principalId:null`), not invented authenticated metadata. `dispatchEnrollment` commits one-time consumption before fetch, captures the one-time proof under the actual lease and commits protected activation before returning safe Runtime metadata. A consumed attempt cannot replay; lost/failed capture requires explicit fresh enrollment. No CLI JSON formatter is supplied yet; the earlier redacted-envelope presentation rule may only be applied after confirmed capture, never as proof of replay success.

A keyed intent that never reached its first-dispatch stamp can be recovered with its original key/body. Once dispatched, this Linux clock adapter supports replay only within the proven **same-process** epoch and strictly before24hours; after restart, missing continuity means retained no-send reconciliation, not automatic retry. Read/manual reconciliation must establish the original result before a new action. Never edit journal fields or replace its database to bypass a conflict. Offline same-UID backup rollback is unsupported and not automatically detectable; fresh setup/enrollment and explicit reconciliation are operator responsibilities.

No real account authentication, secret import/setup, credential issuance, OS-vault configuration or ongoing access was performed for this development task. Those remain separate action-time-authorized operations. Actual filesystem evidence is overlayfs subprocess crash/reopen; ext-family/XFS support is source-policy/unit-branch evidence, not hardware reboot/power-loss certification.
