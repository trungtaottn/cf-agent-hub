# Native CLI

Status: issue 44 local source implementation; no released binary; deployed conformance and operational acceptance pending. The [feature matrix](feature-matrix.md) keeps F24 acceptance separate from source tests.

`cf-agent-hub` is a thin native HTTP client, not an agent runner or another authorization path. Generated [HTTP contracts](http-api.md) validate every request and response. Server permissions, current versions, leases and fencing remain authoritative. This CLI does not expose human administration, arbitrary HTTP requests, deployment or recovery operations.

## Build and explicit context

The local build uses the repository's pinned Node 24 and esbuild; see [toolchain](runbooks/toolchain.md). `npm run build:cli` builds the executable; no npm publication or global installation is implied. Supported protected persistence is Linux on the filesystems allowed by [ADR0009](adr/0009-r2-cli-local-durability.md). Actual source evidence on overlayfs does not certify hardware power-loss recovery or other platforms.

Every remote command requires:

- HTTPS canonical origin: `--origin` or `CF_AGENT_HUB_URL`, with no path, query, fragment or user information.
- Explicit workspace: `--workspace` or `CF_AGENT_HUB_WORKSPACE`.
- Explicit absolute `--state-dir` outside the checkout, with private owner/mode and no-symlink protection.

If a flag and its environment value are both present, their normalized values must agree. There is no saved context, default state directory, last-used workspace or automatic token import. Unknown, duplicate and foreign flags fail closed. There is no `--all`, hidden pagination or generic URL/header option.

## Credentials and local state

`state init --state-dir DIR` explicitly creates empty protected stores and a bounded private content spool. It never overwrites or repairs an existing partial setup. `credential import --state-dir DIR` imports only `CF_AGENT_HUB_TOKEN` into a fresh protected slot. Ordinary commands ignore this environment variable; there are no secret arguments, raw runtime-proof imports or rotation commands. These are explicit operator actions, not instructions to place real credentials into a development checkout or test.

The state directory contains separate `secrets`, `journal` and `uploads` subdirectories. Their databases and retained artifact bytes are access-controlled plaintext, **not encrypted files or OS keychains**. Journal bodies may contain sensitive task/message content. Do not upload these files as evidence, include them in backups without their threat model, or print them for debugging. Unsupported paths and malformed stores are rejected rather than repaired.

`runtime register --input FILE` explicitly enrolls and captures the one-time proof before returning success. Imported credentials are not verified principal bindings until enrollment succeeds. Capture failures and lost enrollment responses are uncertain: a consumed enrollment attempt cannot be replayed to recover its proof. Credential changes cannot rebind existing intents. This implementation uses synthetic credentials only for development verification; no real account setup is part of that evidence.

## Command layout

All body-bearing commands require `--input FILE`: a regular, non-symlink, at most 65,536-byte UTF-8 JSON file. The canonical generated closed schema remains the final authority. An interactive mutation may generate its key only when both stdin and stderr are terminals and `--json` is absent. Otherwise an explicit nonempty `--idempotency-key KEY` is mandatory. Key generation follows durable keyless-intent creation, never precedes it.

| Area | Commands | Notes |
| --- | --- | --- |
| Workspace | `workspace show`, `workspace configuration`, `workspace profile` | Current workspace and configuration reads |
| Tasks | `tasks list`, `tasks show ID`, `tasks results ID` | Bounded page reads |
| Task changes | `tasks create`, `tasks update ID`, `tasks ready ID`, `tasks claim ID`, `tasks submit-result ID`, `tasks accept-result ID`, `tasks fail ID`, `tasks cancel ID`, `tasks requeue ID` | Explicit JSON body, original key, current versions |
| Runs | `runs show ID`, `runs heartbeat ID` | Heartbeat does not bypass lease/fence checks |
| Agents | `agents list`, `agents show ID` | Durable identity, not a trusted display label |
| Runtime | `runtime register`, `runtime heartbeat ID` | Explicit protected enrollment and proof-bound heartbeat |
| Messages | `messages send`, `messages ack`, `inbox list`, `threads show ID` | ACK and delivery are not task completion |
| Artifacts | `artifacts list`, `artifacts show ID`, `artifacts stage`, `artifacts upload ID`, `artifacts download ID`, `artifacts commit ID` | Separate stage, byte transfer and commit actions |
| Events/search | `events list`, `search --query TEXT` | Explicit bounded reads |

List commands support only their declared page filters. `--limit` and `--after-sequence` use strict integer syntax; `--acknowledged` accepts exactly `true` or `false`. Events `--cursor` and `--after-sequence` are mutually exclusive. Task and artifact filters use `--project-id` and `--task-id` respectively. Server-issued cursors are opaque; there is no automatic all-pages traversal.

## Durable intent and heartbeat stop

A mutation records its exact origin/workspace, canonical operation/path/body/query, idempotency key and verified principal/slot/generation/provenance before dispatch. Each explicit dispatch invokes fetch at most once; it does not retry, enroll, rotate, rebase or silently invent a new key. A keyed intent never stamped as dispatched may be sent once after reopening. A previously dispatched intent requires the proven **same-process** clock epoch and a strictly less-than-24-hour replay horizon. Restart, expired continuity or an uncertain outcome means retained no-send reconciliation, not permission to start a replacement request.

`intent inspect ID` prints safe intent/key/operation/replay metadata on stderr, never the body. `intent dispatch ID` uses only an existing ordinary JSON intent; it takes no replacement body or key. Enrollment and retained raw uploads have distinct handling.

An unresolved, failed or uncertain runtime/run heartbeat blocks dependent owner mutations for that exact protected runtime binding, including work on another run of the same runtime. A different key, restart, age or apparent server presence does not clear the stop. Only the same exact heartbeat intent may be considered for permitted replay. Provider pinning serializes final heartbeat admission through the synchronous fetch invocation, with provider → journal → upload-ledger lock order; awaited network work is outside SQL transactions. A returned heartbeat failure is not evidence that the server saw nothing.

## Artifact lifecycle

1. `artifacts retain --file FILE --state-dir DIR` copies one regular source into the private bounded spool, hashes it and records exact owned inode identity. It prints the safe content ID on stderr. It performs no network request.
2. `artifacts stage --content-id ID --input FILE` verifies the declared manifest against retained bytes. A durable content-use hold commits **before** the stage journal intent. Successful stage preserves the hold; it is not upload success.
3. `artifacts upload ID --content-id ID` uses exact retained bytes and the existing staged artifact. Alternatively `--file FILE` first retains that file; the two options are exclusive. There is no restaging, automatic commit or unjournaled upload. Original request/version/key and successful resulting artifact version are distinct retained identities.
4. `artifacts commit ID --input FILE` is a separate version-bound operation with a separate key. Existing local association requires exact held bytes and fully completed successful PUT evidence; a status GET is not proof an earlier upload stream drained. A remote-created artifact with no local association can use the canonical server commit operation.
5. `artifacts download ID --output FILE` first validates committed metadata, then streams to a private exclusive same-directory temporary inode, checks length and digest, fsyncs, publishes without overwriting and fsyncs the directory. Existing destinations fail. Link success followed by fsync failure is uncertain: the final path may exist even though the command fails. Do not blindly delete or retry it.

Reopening retained content checks owner, mode, link count, lossless device/inode identity, size and full digest, then streams from the same descriptor. Removal of the original source after retention does not change retained identity. A mutated/replaced retained file fails closed. No continuous adversarial same-UID writer protection or encrypted-at-rest guarantee is added.

### Bounds and cleanup

Local policy limits are 64 content records (including reservations/deleting), 64 MiB reserved content bytes, 10,485,760 bytes per file, 128 combined upload intents/content holds, 16 KiB per metadata record and 4 MiB total metadata reservation. Physical SQLite overhead is additional. Existing journal limits remain 1,000 entries/64 MiB. At capacity, admission stops; it never automatically deletes unresolved evidence or silently raises limits.

`artifacts inspect-content ID`, `artifacts inspect-upload ID` and `artifacts dispatch-upload ID` provide safe inspection or explicit original-intent dispatch. A restarted dispatched upload is no-send; current server object state cannot clear its uncertainty.

`state cleanup` is explicit bounded cleanup, without force/all/age overrides. Journal pruning is conservatively deferred while any retained content remains blocked, preserving evidence needed by unresolved reference chains; the local result reports `journalDeferred`. Exact successful commit/journal evidence and bounded public stage/PUT receipts may settle only the matching reference chain. Shared content retains every other artifact's reference; failed, uncertain, unbound or receipt-gap references never age out. Settled references remain counted until eligible cleanup. Content eligibility is no earlier than seven days after its latest proven settlement. Cleanup marks a ready, unreferenced eligible record deleting before unlinking only its exact owned inode; reservation release follows directory fsync. A crash gap can retain content indefinitely. These limits intentionally bound throughput and are not a maximum data-retention promise.

## Output and exits

Remote results use native wire envelopes, including snake-case `request_id`, not the internal client's camel-case `ApiResult`. Machine output is on stdout; diagnostics and safe local metadata are on stderr. The current surface uses the same safe envelope even without `--json`; it does not add a terminal table renderer.

Exceptions are explicit:

- After successful protected enrollment, output is `{data:{runtime:…,runtime_token:null,revealed:false},request_id:…}`. A failed enrollment may lack correlation by design and remains stderr-only/nonzero; no proof is exposed.
- Successful download JSON is the validated **metadata-read** envelope, emitted only after verified durable file publication. Its request ID belongs to that metadata read, not to the binary response, which has no such receipt.
- Pure local controls never fabricate server envelopes; even with `--json` stdout is empty. Retained intent/upload dispatch is network-capable and preserves native result handling. A no-send reconciliation result is exit 5, not local success.
- Invalid responses, transport failures and other client-local uncertainty never become invented server responses. Raw exceptions, remote messages and credentials are not printed. An output write failure after a settled mutation does not undo that durable outcome or authorize retry.

| Exit | Meaning |
| --- | --- |
| `0` | Validated success and any required protected capture/file publication completed; or explicit local action completed |
| `2` | Local argument/configuration/body/file rejection before network send |
| `3` | Validated401/403 authentication/authorization rejection |
| `4` | Validated version, state, idempotency or stale-run conflict |
| `5` | Network/timeout/abort, invalid response, capture failure, unresolved intent, dependency failure, interrupted transfer or uncertain local write/output |
| `6` | Other validated nonretryable server rejection |

Client-local uncertainty takes precedence over carried HTTP status: malformed 401/409 responses are exit 5, not authenticated rejection/conflict evidence. A nonzero exit alone never proves that a request was not applied.

## Separate acceptance and recovery boundaries

Generated operation availability does not prove a deployed route is enabled. Synthetic source/subprocess tests do not establish HTTPS deployment conformance, installed package provenance, real account operation or release acceptance. No npm publication, merge, deployment or real credential action is authorized by this document. Integrated acceptance remains deferred to the owner's later R4 gate; issue 40, dependency audit and other outstanding gates remain separate.

Native CLI44 does not add backup/restore commands or change the [recovery decision](adr/r2-recovery-contract.md). Recovery/operator tooling has its own explicit authorization, protected file and verification contracts. [ADR0009](adr/0009-r2-cli-local-durability.md) and [issue 41 evidence](r2-task-plans/issue-041-execution.md) remain the persistence groundwork and historical limitations, not a claim of cross-process replay continuity.
