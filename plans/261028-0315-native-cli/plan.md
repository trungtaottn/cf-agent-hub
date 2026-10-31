# Issue 44 — explicit native CLI execution plan

Status: Local source implemented and scoped independent reviews passed; integrated acceptance pending. No released capability is claimed.

Plan metadata: title: Explicit native CLI and retained artifact I/O; status: implemented-local; issue: 44; route: feature; base: 167cb18a94419c1a7cc542bda7285faad34f7b31

## Pickup and authority

The isolated checkout starts at exact issue 43 HEAD `167cb18a94419c1a7cc542bda7285faad34f7b31`, tree `8346e9d106c7016bb879692ef61f358c358481ae`. Preparation compared 32 prerequisite files byte-for-byte with issue 42 and all 33 enabled native operations. Immutable pickup and three independent design lenses passed before implementation. The corrected original issue plan is pinned at `eead8cb4a84810319037ae3b7165cd65586ad0cb`; this additive plan supersedes its stale missing-client/journal assumptions, not historical evidence.

Actual installed AgentKit vibe/cook instructions govern execution. The code router/hooks are not claimed to have run. Local synthetic development is authorized; GitHub publication stays with the parent, stacked after the predecessor. No merge, deployment, real credential action, denied dependency-audit retry or blocked issue 40 review retry. Live acceptance remains the owner's post-R4 gate.

## Selected approach and alternatives

Use Node's built-in strict `util.parseArgs` tokens and a static map, retaining generated canonical input validation. Compare [Node v24.22.1 implementation](https://github.com/nodejs/node/blob/v24.22.1/lib/internal/util/parse_args/parse_args.js) and [Commander](https://github.com/tj/commander.js): Commander offers a mature DSL but adds dependency/output behavior without an observed capability deficit. This is a source-based fit decision, not a measured speed ranking. Keep pinned esbuild and private root-package metadata; no new dependency or workspace graph.

For uploads, original paths or only-open descriptors cannot provide durable identity. A private spool plus separate closed protected ledger preserves journal v1, with explicit quotas, exact file identity and no restart replay. Exclusive same-directory hard-link publication follows existing protected I/O principles; rename-overwrite and direct-final-write are rejected.

## Bounded implementation phases

1. **Presentation:** all 33 enabled operations, strict command/context/body parsing, six exit classes, canonical envelopes, protected enrollment redaction and metadata-only download receipts. Pure locals never invent server envelopes. Unit TDD and actual bundled subprocess checks.
2. **Durability:** exact provider → journal → upload ordering, final-pinned heartbeat admission, bounded journal scans, separately retained content and raw-upload identity, reservation-before-copy and keyless-admission-before-key-generation. No awaited network in SQL transactions. Actual process races, killed-process restart and filesystem-failure tests.
3. **Integration and evidence:** main orchestration, safe retained handles on failure, before-send interactive context, explicit cleanup, docs, independent exact-source reviews, serial full regression and immutable checkpoint. Source tests do not clear deployment, browser, audit or release gates.

Main owns integration/tests/docs and final evidence; command, artifact and heartbeat implementations have disjoint ownership. Reviewers are separate from authors of their reviewed source.

## Reviewed amendments applied before affected coding

- Stage/PUT success does not release content. Persist bounded exact public association receipts separately from immutable request identities; validate artifact version transitions rather than equality across stage/upload/commit. Exact successful commit journal evidence may settle only the matching reference chain. Other artifacts sharing bytes, uncertain siblings and missing crash-gap receipts remain held. Seven-day eligibility starts no earlier than the latest proven settlement. [ADR0010](../../docs/adr/0010-r2-native-cli-effects.md) owns the resulting rules.
- Interactive non-JSON mutations, including supplied-key and retained dispatch, await a safe resolved-context stderr callback before preparation/send. Missing or failed display is exit 5/no send. Exact standalone `--help` is static and reads no context, credentials or state; mixed help flags fail closed.
- Safe original intent handles are retained for stderr on both successful result and post-prepare failure paths, without exposing bodies or credentials. A durable outcome is not undone by output failure.

## Required verification and stopping condition

Record commands, exact source digest, start and terminal exit. Focused tests cover each corrected defect; full Node, Workers, operator and current-restore operator suites run serially. Preserve inherited historical recovery CLI environment failures, unavailable pinned browser, denied audit and issue 40 review as separate unresolved limits. No weakened timeout, fake acceptance or alternate browser bypass.

Done means reviewed implementation, exact final serial evidence and a clean immutable local source/patch/manifest/handoff, not PR publication or integration. Formal feature rows remain unchanged. Source and test refinements must be re-reviewed and their affected tests rerun before the final checkpoint.
