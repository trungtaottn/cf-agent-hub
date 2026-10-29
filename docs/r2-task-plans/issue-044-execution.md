# Issue 44 — explicit native CLI local implementation

Status: Local source implemented; deployed conformance, distribution and integrated acceptance pending. No released capability is claimed.

## Scope and pickup

The source starts at exact issue 43 commit `167cb18a94419c1a7cc542bda7285faad34f7b31`, tree `8346e9d106c7016bb879692ef61f358c358481ae`. It preserves historical recovery contracts and the isolated current-restore operator suite. The [reviewed execution plan](../../plans/261028-0315-native-cli/plan.md), [ADR0010](../adr/0010-r2-native-cli-effects.md) and [CLI usage](../cli.md) own scope and decisions.

Implemented: all 33 enabled native operations, strict shell/context/input validation, a private pinned-esbuild executable, protected explicit synthetic-tested setup/import, durable ordinary/enrollment/raw-upload paths, heartbeat serialization, bounded retained bytes and references, safe file publication and truthful six-class exits. Pure local controls, protected enrollment redaction and download metadata correlation have explicit output exceptions.

## Workflow and corrections

Actual installed AgentKit vibe/cook instructions were read and used for planning, meaningful RED tests, implementation, review, simplification assessment and a local technical journal. No automatic router or hook execution is asserted. The no-new-dependency choice follows the recorded comparison of Node argument parsing and Commander. Root-package bin metadata is the only lockfile metadata addition; dependency versions and integrity remain unchanged.

Independent review identified and corrected raw-upload key generation preceding durable keyless admission, loose retained-row decoding and missing retained intent identifiers on failure. Reviewed amendments established exact artifact version transitions and per-stage receipts, conservative shared-content reference settlement, and awaited interactive target display. The simplifier found no behavior-preserving abstraction worth obscuring those explicit boundaries.

## Verification interpretation

Focused evidence covers canonical command inventory, actual built subprocess behavior, original intent identifiers after loss, non-overwrite download publication, stage/PUT/commit transitions, shared-content and uncertain-sibling retention, receipt gaps, quota exhaustion, malformed retained metadata and controlled filesystem failures. Real child processes exercise final provider-pinned heartbeat ordering, competing rotation/busy timeouts, killed-process no-send and cleanup/admission serialization. The bounded heartbeat scan was measured at 1,000 entries and 64 MiB reserved; that sample is not a latency or memory guarantee.

The immutable local handoff owns exact final tree/source hashes, commands, counts, exits and independent reviewer fingerprints. Full serial source regression is separate from focused tests. No synthetic transport is represented as actual isolated HTTPS deployment conformance; no process-crash test is represented as power-loss certification.

## Retained limits and publication

State and content are access-controlled plaintext. Already-dispatched replay continuity is same-process only. Missing stage/PUT/commit evidence can retain charged references indefinitely; cleanup has no force or age override. Journal pruning is conservatively deferred while content remains blocked. Unsupported paths fail closed rather than being repaired.

No real credentials, npm publication, merge, deployment or live acceptance was performed. The existing pinned-browser availability, historical recovery-CLI environment guard, denied audit and issue 40 review limitations remain separate; this implementation does not clear them. Root owns any stacked PR publication after its predecessors and specific disclosure authorization. Integrated acceptance remains the owner's post-R4 gate.
