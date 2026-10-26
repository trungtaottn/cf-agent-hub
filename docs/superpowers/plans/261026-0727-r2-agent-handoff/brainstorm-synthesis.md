# R2 Brainstorm Synthesis

Status: Source-grounded planning pending review; no R2 implementation or release claimed.

## Product intent and user flow

External agents enroll with bounded native credentials, discover eligible durable tasks, claim one fenced execution attempt, produce immutable artifacts and submit evidence. A different authorized reviewer accepts the result. Humans see a truthful accessible board; CLI and HTTP use the same backend commands. Recovery restores complete SQL and committed bytes without reviving old authority.

## Explicit owner instructions

Publish the prior R1 fix as PR and close that workspace, then analyze R2 issues with AK on CH and prepare detailed tasks for agents. The prior PR/cleanup is complete; this new workspace is for planning. The owner will merge PR93; this task never merges it. The owner subsequently authorized one separate branch per existing R2 task and explanatory comments on the corresponding issues; no issue body/label mutation or automatic PR is included. No runtime implementation was requested in this stage.

## Confirmed repository facts

| Surface | Current evidence | Planning consequence |
| --- | --- | --- |
| R1 candidate | PR93 head4c8e487, devfcbe6139 at intake | Stack source analysis on candidate; reconcile final merged dev before implementation |
| Storage | `src/storage/schema-version.ts` version7; migrations0001–0007 | #24 sole migration owner, tentative0008 not historical0002 |
| Transaction | `src/workspace/commands.ts` executeCommand reauthorizes in SQL, stores JSON outcome/event atomically; rejects async callbacks | Extend descriptors, never await bytes/network in SQL; first-time secret projection separate |
| Identity | `src/config/bootstrap.ts` applyAuthorityRows treats all native credentials as static; auth/messages reference static_agents | Explicit provenance + canonical registry amendment, including higher-epoch install/restore |
| Native context | `src/workspace/context.ts` has trusted sessionId; VerifiedIdentity agent currently has credentialId/tokenDigest only | Runtime proof added through reviewed trusted lane, not caller-supplied actor fields |
| Artifacts | Product artifact modules/binding absent; RECOVERY_BUCKET exists | #32 proposes distinct trusted ARTIFACT_BUCKET; #22/#39 reuse private recovery lane, not public transfer APIs |
| Search | `src/http/cursors.ts` AES-GCM, R1 operation union and message/event retention semantics | Extend confidential cursor scope/current visibility; do not substitute readable HMAC pagination |
| Clients/UI | Existing `HubClient`, browser cookie/CSRF transport, write-intent and Settings | Extend same transport; no duplicated replay/auth/client domain logic |
| Recovery | Existing durable jobs/barriers, typed table registry, manifest V1 max_artifacts0, schema7/static restoration | Extend V2 and preserve V1 compatibility explicitly; no replacement operator plane |
| Evidence | `scripts/verify-release.mjs` currently R1-only | #47 implements additive R2 gate before any claimed R2 acceptance |
| Test discovery | Node excludes TS CLI, Workers omits agents/runtimes/tasks/artifacts/search/import/R2 acceptance | #23 owns exact runner discovery; focused empty collections are failures |

## Architecture invariants

One authoritative workspace DO; one synchronous transaction for domain/event/outbox/replay. Recheck current session/credential/proof and maintenance generation after every await. 60s execution lease, 20s suggested renewal, 90s presence; presence never renews execution. Same-key/same-body replay reauthorizes; changed body conflicts. Submit is Review, independent acceptance is Done. Unknown/exhausted holds never silently requeue. Native agents cannot use human-only management lanes. R3 approvals remain unavailable. Immutable private artifacts commit only after verified byte generation; recovery completion grants no live admission.

## Existing partial implementation versus gaps

Do not label the entire system absent: auth, transactional command wrapper, durable messages/outbox, settings, browser client, authenticated recovery and validators are implemented R1 source. The R2 schemas/design exist, while agent lifecycle/runtime proofs/tasks/artifacts/native CLI/board/import/search/V2 recovery are missing or deliberately unavailable. The four subsystem phases identify exact extension files and new modules; capability status stays Specified until the relevant implementation and evidence exist.

## Proposed decisions requiring review

| ID | Decision | Recommendation, not approval | Blocking consumers |
| --- | --- | --- | --- |
| D1 | Higher-epoch handling of human-managed credentials absent static bundle | Add credential provenance in the one registry; retain dynamic metadata but revoke dynamic credentials/proofs on epoch advance and restore; fresh human issuance required. Preserve static current-ledger behavior; advance retained active agent epoch without resurrecting archived state or granting scopes, then test fresh issuance/runtime succeeds while old authority fails. Review security/UX impact explicitly. | #20/#22 freeze; #24–26/#43 |
| D2 | Trusted product artifact/recovery binding map | Distinct product ARTIFACT_BUCKET and existing RECOVERY_BUCKET; RecoveryWorkspace exposes trusted artifactBucket, server-side copy under existing protocol; absent binding fails closed. No provisioning implied. | #22/#32/#39/#43/#46 |
| D3 | Protected CLI secret backend and supported OS matrix | Select the supported OS/threat model first: phase04 proposes a narrow POSIX owner-only-file pilot (access control, not encryption/keychain) or an OS credential-vault adapter for stronger/cross-platform guarantees. Neither is approved; never silently fall back after secure storage failure. | #41/#44/#48 |
| D-HISTORY | Full historical result read seam | Current Task.result/getRun/events do not expose previous result details after requeue. #20/#23 must freeze a public operation/schema before #27/#35 query/projection and #42 full history. Show unavailable honestly; do not narrow completion criteria or invent private routes. | #42/#49 full acceptance |
| D-JOURNAL | CLI journal storage cap/retention | Select explicit reviewed values; unresolved operations never silently evict, block new admission at limit. | #41/#44 |
| D4 | Final planning-branch base | Publication is now authorized as32 separate docs/r2-NNN-plan branches and corresponding issue comments, not32 PRs. Pin one base and reconcile accepted dev before runtime pickup. | Source-drift review; no additional publication approval needed |

These are not invented approvals or a request to redesign already-fixed constants. Detailed canonical policy limits, catalog semantics, import bounds and search rules are retained. D1/D2 are gaps revealed by current code; they cannot be silently settled by a coding agent.

## Superseded assumptions

Historical migration0002 and illustrative recovery names are superseded by actual source interfaces. Historical issue snapshots referencing retained2222663/unpublished PR1 describe earlier state, not current publication. Original Task8/9 broad sequencing is decomposed into search fixtures → import → client → full isolation without circular dependencies. No historical receipt is rewritten.

## Non-goals

No LLM hosting, agent execution sandbox, connectors, R3 approval activation, new authority service, global dependency bump, deployment/secret provisioning, automatic issue closure, merge or release.
