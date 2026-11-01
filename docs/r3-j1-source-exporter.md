# J1 local source exporter

Status: Implemented local source runner; actual eight-test/six-observation execution and two-case transport-capacity probe passed. Final source review is separate; release acceptance pending. Not R3 acceptance.

`scripts/r3-source-producer.mjs` runs the dedicated eight-test J1 file, stages six closed safe observations, and publishes a controller record only after all test/module/run gates and actual child CLOSE exit zero. It never supplies the J1 validator's independent comparison context. J2 and formal #67 remain missing; acceptance and authenticated provenance remain false.

Launch only from a clean committed checkout with the pinned dependencies, using an empty inherited environment:

```sh
env -i PATH=/usr/bin:/bin /absolute/path/to/node scripts/r3-source-producer.mjs
```

The controller uses its own Node path and fresh private `/tmp` home/config/tmp/output directories. It does not install dependencies or invoke npm. Its only successful stdout is a bounded output reference, not a release verdict. Raw child diagnostics are bounded and discarded, never parsed as success or exported. On failure only, a separate private control-root diagnostic may retain a fixed reporter phase and actual child CLOSE scalars; it contains no raw error, task payload or source artifact and is never a completion record. No retry, user filter, alternate config, shell command, credential, proxy, or deployment target is accepted.

## Measured scope

The source inventory combines an esbuild `write:false` module graph and explicit Worker/config roots, with fixed count/byte limits. Source bytes, Git identity and selected toolchain package/entry bytes are checked before and after the run. Untracked and ignored checkout files are rejected on both checks except the two explicit dependency locations. Dependency lock and selected actual toolchain entry hashes are recorded; this does not authenticate installation origin or every transitive installed dependency. Declared npm engine is not an executed installer receipt. No product build is claimed (`product_build:null`). A mutate-and-restore attack during execution is outside this unauthenticated local consistency claim.

The fixed configuration declares no file parallelism and resolves to one worker. Vitest has no global `repeats` setting in the pinned resolved API; every actual test diagnostic must report zero repeats/retries/flakiness. The reporter checks the resolved single-module/project/pool/include/exclude/retry/worker constraints and exact eight final states, not `.ok()` or stdout strings.

Metadata has a 262144-byte logical observation bound, canonical base64 encoding and a separately checked 360448-byte serialized field bound BEFORE producer assignment. Host callbacks occur after Vitest RPC materialization; arbitrary hostile framework-memory consumption is not bounded by the reporter. Only six validated safe observations are carried, after the producer's final empty-production-registry assertion. The two guards carry no payload.

## Atomic output and limitations

Outputs are private, bounded, fixed-path and no-clobber. The final execution record is file-fsynced under a temporary name, then linked exclusively into place, temporary link removed, and directory fsynced. Partial bytes never appear under the final name. A caught publication/durability failure reports failure and removes only this invocation's owned link. A process crash after publication but before directory fsync can leave complete visible bytes with uncertain crash durability; filename existence alone is not completion evidence. Consumers must validate the whole bounded record and references. Staged observations alone are not child completion.

Independent pre-command workspace/actor configuration context, authenticated producer/host origin, installed product action parity, J2 and formal isolated acceptance remain separate reviewed work. The production action registry and release dispatcher are untouched.

## Measured local source checkpoint

The actual controller run on `d6e02195f30ac28188aaf069e479f4122ffce33a` completed all eight tests, produced six validated observations, and observed child CLOSE exit zero without signal/error. Its closed execution-record SHA-256 is `3dedf43e2289cf3ca0316dc84ae7ded37d9e993e9f6baf4c53fb61234fc9da8b`; the private record and observation bytes remain separate from this source document. A disposable two-test Workers probe separately transported 262144 logical bytes /349528 base64 characters /349769 serialized metadata bytes and rejected 262145 bytes before metadata assignment. This measures the supported logical maximum, not an exact 360448-byte field or hostile framework-memory protection. Both records remain local synthetic source facts, not release acceptance or an independently authenticated actor/context join.
