# Native conformance source runner

Status: source implementation in progress; independent verification and live acceptance pending.

Base: additive documentation-only follow-up `b0ba92598416dbf5b14b444b46751c6610580466` atop frozen issue47 `86b1e62eca70a9d4a562396084bcf4a2681f9ccb`. Its final regression has 11 terminal passes, an unknown provider execution and eight unrun gates. This stacked source work does not resolve those gates.

The owner explicitly authorized continued local implementation while CI waits on 2026-10-29. Earlier plan pickup restrictions are amended for source development only, not live acceptance. Follow actual AK vibe 1.4.1, cook 2.5.1 `--tdd --auto --skip-journal`; no merge or remote writes by this worker. Journal skipped by --skip-journal. Hooks are not activated.

## Scope and authority
Implement the dedicated runner/config consumer and source-level subprocess, scenario and evidence contracts. No network call, credential import/revoke, fixture provisioning, fault injection or cleanup is authorized in this session. The default CLI must fail closed until an independently installed, reviewed authority/observer/control integration exists; a self-declared protected config or synthetic receipt is never that integration. Do not invent a remote endpoint or manufacture issue47 observations.

## Phases
1. [Admission and producer contracts](phase-01-admission.md): protected configuration, immutable source plan, exact case ownership, preflight negatives.
2. [Owned execution and integration](phase-02-execution.md): bounded executable harness, deterministic source scenario adapters, partial custody and exact evidence projection; docs and source tests.

3. [Native producer integration](phase-03-native-producer.md): reviewed scoped evidence and auxiliary server-denial source contracts.

## Ownership
Controller owns config, runner, package.json/docs/discovery and integration. One helper may own only scripts/lib/native-r2-process.mjs and its test; another may own only scripts/lib/native-r2-scenario.mjs and its test. Reviewer owns no implementation files. Freeze interfaces before delegation.

## Validation decisions
- Production destination cannot be excluded by hostname heuristics: externally provisioned allowlist/authority adapter must match origin, workspaces, namespaces, build and operation budgets before invocation. No bundled permissive adapter.
- Reuse protected-io read checks; separately validate full ancestry and candidate/store identities without weakening existing CLI guards. No alternate-root bypass if positive disk tests are blocked.
- Native entry is one-shot, random epoch; uncertain and settled restart dispatch no-send/exit5. Same-process replay belongs to source evidence only.
- Live observations need authorized network and state observer; subprocess stdout alone cannot establish requests, current grants, state effects or cleanup.
- Source fixtures do not produce live acceptance. Missing authority leaves an explicit blocked report/nonzero exit.
- New subprocess tests persist unique token, PID/start identity, bounded timeout and terminal status. Never duplicate the original unknown issue47 provider process.

## Research
Compared Node core child_process shell-free spawn and Execa cancellation/timeout semantics (upstream GitHub, 2026-10-29). Use built-in spawn: no dependency/lock expansion, exact executable argv, bounded streams and explicit ownership receipts. Execa is useful generally but neither API authenticates isolation nor persists execution custody across host transport loss. Full benchmark is unnecessary to choose a security boundary; measure bounded source process tests instead.

## Review gates
Independent assumption/security review before affected implementation, independent code review after source tests, conditional simplification, source checkpoint and private backup before long regression. No ready/released/verified labels from local source work.
