# ADR0010 — bounded native CLI effects and presentation

Status: Accepted local development design; implementation verification and integrated acceptance pending. No released capability is claimed.

## Decision

Issue 44 presents existing native operations through strict explicit commands. It does not add server authority or a second API schema. Use built-in Node argument parsing and pinned esbuild rather than a new command framework. [CLI documentation](../cli.md) owns actual commands, output and exits; [execution plan](../../plans/261028-0315-native-cli/plan.md) records research and reviewed changes.

Preserve [ADR0009](0009-r2-cli-local-durability.md), protected provider and journal v1 formats. Add a separately versioned closed `uploads.sqlite` and private spool; no server migration. Access-controlled files remain plaintext. Unsupported paths/filesystems fail closed, with no automatic repair.

## Heartbeat and lock ordering

All owner-dependent commands use the same protected runtime/provenance boundary. Pending, failed or uncertain runtime/run heartbeats stop dependent effects for that runtime, including another run. Derive runtime identity from verified protected association and canonical fields, never display labels. A new key or process cannot clear an old stop.

The provider lease pins final admission through the synchronous fetch invocation. Lock ordering is provider → journal → upload ledger; awaited network is outside transactions. First-dispatch CAS occurs at the final admission point, not during an earlier asynchronous preparation. The journal decodes bounded rows canonically and validates checksums before interpreting heartbeat evidence. The existing same-process clock and finite horizon remain mandatory; no restart continuity is invented.

## Retained bytes and reference lifecycle

Reserve bytes/records before copying. Capture into exclusive private files, hash and verify source identity, fsync file and directory, then mark ready. Reopen exact sealed device/inode/owner/mode/link/size/hash and stream from that descriptor. Content states are reserving, ready and deleting. Unknown foreign files block rather than being deleted.

The ledger binds raw upload operation, public artifact ID/version/manifest, complete verified principal/slot/generation/provenance, runtime, original key, fingerprint and first-dispatch stamp. Generated keys follow committed keyless admission. Previously dispatched uploads do not replay after restart; object presence or status is not proof a prior PUT drained.

A content-use hold commits before stage/commit journal preparation, then binds its exact journal ID. Unbound crash gaps remain charged. Successful stage retains a closed public association receipt. Successful fully drained PUT retains a separate result receipt; never rewrite the original request version. Server transitions are stage version 1, PUT admitted version `v` to uploaded `v + 1`, and commit expected uploaded version `u` to committed `u + 1`.

Only an exact validated commit result, matching request and verified settled journal evidence may settle its content-reference chain. Each stage hold needs its own successful journal and exact result association. Other artifacts sharing bytes, different bindings, unbound holds, uncertain PUTs/commits and missing receipts remain. Receipts exclude request IDs, secrets, runtime proofs and private server generation/effect IDs. Exact repeat settlement is idempotent; conflicting evidence rejects.

No cross-database atomicity is claimed. Journal evidence is canonically read before upload-ledger mutation. Crash after journal success but before ledger settlement keeps references. Cleanup cannot substitute a GET, missing row or matching digest for exact retained proof.

## Bounds and cleanup

Limits: 64 content records, 64 MiB reserved content bytes, 10,485,760 bytes per file, 128 combined holds/upload intents, 16 KiB reserved per metadata record and 4 MiB total metadata reservation. Physical database overhead is additional. The current maximum of 192 content/reference rows reserves at most 3 MiB, below the total cap. Remaining settled rows consume quota until explicit cleanup.

After at least seven days from proven settlement, explicit cleanup can remove settled references. Content must also be eligible and have zero remaining references before its ready→deleting transition. Only the exact owned file is unlinked and directory-fsynced before releasing reservation. Unresolved and reserving records never age out. Incomplete deleting work may be continued under the same exact identity rules. Cleanup conservatively defers journal pruning while content remains blocked, preventing loss of later settlement evidence at a cost to capacity.

## Output and file publication

Emit native wire envelopes rather than internal `ApiResult`. Enrollment prints a redacted issue only after protected proof capture. Binary success prints the validated metadata-read envelope only after length/hash verification and durable no-overwrite publication; it is not a fabricated binary receipt. Pure local controls are stderr-only. Original safe intent identity survives failure for explicit reconciliation.

Interactive mutations display selected resolved context before admission/send through a trusted awaited output callback. Output failure cannot erase a settled journal outcome. Download uses exclusive same-directory temporary files, complete verification, file fsync, no-overwrite hard link and directory fsync. A link followed by fsync failure can leave the final destination present with an uncertain result; it is not automatically removed or blindly retried.

## Consequences and limits

Capacity and unresolved-reference retention are intentionally conservative. Process crashes, failure-injection tests and synthetic transports are source evidence, not power-loss certification or real HTTPS deployment acceptance. No same-UID malicious-writer protection, encrypted store, secret import beyond explicit setup, automatic retry, all-pages helper, package publication, deployment or recovery command is added. Formal F24 verification remains separate.
