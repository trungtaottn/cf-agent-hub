# R1 implementation and acceptance

Status: R1 source candidate · Implementation and local verification records retained; isolated deployment acceptance pending; no released artifact.

The candidate implements the R1 foundation for CF Agent Hub: current human/static-native authority, durable messages and recipient ACK, bounded reads, truthful browser state, policy-preserving settings and logical SQL recovery. This document identifies reviewable source and the remaining acceptance boundary. It is not a release evidence manifest or a claim that a deployed environment passed.

## Published baseline and remaining work

The published `dev` baseline observed on 2026-10-26 is [`fcbe6139c65f9baafee9804a5c50867a1fcc0968`](https://github.com/trungtaottn/cf-agent-hub/commit/fcbe6139c65f9baafee9804a5c50867a1fcc0968). [Publication #7](https://github.com/trungtaottn/cf-agent-hub/issues/7) is closed. This identity records published source, not deployment provenance or acceptance of subsequent working changes.

Track unavailable-Agents preference fallback in [#8](https://github.com/trungtaottn/cf-agent-hub/issues/8), safe client validation locations in [#12](https://github.com/trungtaottn/cf-agent-hub/issues/12), and profile navigation in [#13](https://github.com/trungtaottn/cf-agent-hub/issues/13). The baseline contains validation-location and navigation implementations; an open issue is not proof that its original source defect is still present, nor does source presence prove acceptance. Exact candidate checks and independent review must reconcile each issue. [Toolchain #11](https://github.com/trungtaottn/cf-agent-hub/issues/11), [provenance #14](https://github.com/trungtaottn/cf-agent-hub/issues/14), and [integrated acceptance #17](https://github.com/trungtaottn/cf-agent-hub/issues/17) remain separate gates. The [dated amendment](superpowers/plans/2026-10-26-r1-source-reconciliation.md) supersedes obsolete historical command and migration assumptions without rewriting their review receipts.

## Source and executable checks

| R1 scope | Implementation | Main checks |
| --- | --- | --- |
| Human identity, static credentials and workspace routing | [Authentication](../src/auth), [catalog/configuration](../src/config), [application ingress](../src/index.ts), [operator ingress](../workers/operator/src/index.ts) | Actual signed-provider/session tests, operator installation/transport tests and the seven-lane route matrix |
| Durable messaging, inbox/thread/event reads and recipient ACK | [Messages](../src/messages), [workspace commands](../src/workspace/commands.ts), [HTTP reads](../src/http/read-routes.ts) | Atomic acceptance/replay, recipient-only ACK, restart, cursor and cross-workspace tests |
| Notification delivery and scheduling | [Outbox](../src/outbox) | Persisted attempt budget, exact notification signing, receiver deduplication, crash/lease/alarm and stale-completion tests |
| Truthful browser dashboard and settings | [UI](../src/ui), [browser client](../packages/client/src/client.ts) | Actual HTTPS browser journeys, hostile text, policy restrictions, uncertain writes, version review, cache clearing, thread identity and pagination races |
| Protected health and workspace projection | [Health](../src/health), [workspace route](../src/http/workspace-routes.ts), [readiness route](../src/http/readiness-routes.ts) | Missing/stale/mismatched probes, current human authorization, read-only diagnostics, schema mismatch and independent delivery degradation |
| Logical SQL recovery | [Recovery](../src/recovery), [registry/barrier tests](../test/recovery/r1-recovery.test.ts), [core flow](../test/recovery/core-flow.test.ts), [operator transport](../test/recovery/operator-transport.test.ts) | Actual typed R2 chunks/SQLite restore, interruption, current ledger overlay, revoked authority, resolution, probes, retirement and resume |
| Protected recovery CLI | [Entrypoint](../scripts/recover-workspace.mjs), [controller and IO](../scripts/lib), [CLI tests](../test/cli), [operator runbook](runbooks/r1-recovery.md) | All eight commands through local HTTPS and separate Worker authorities; encrypted files, protected key descriptors, exact pending requests, guarded initialization and real process-death continuation |
| Deployment observation | [Observer](../scripts/verify-r1-deployment.mjs), [tests](../test/deployment/verify-r1-deployment.test.mjs), [deployment verification runbook](runbooks/r1-deployment-verification.md) | Exact HTTPS targets, bounded responses, redacted evidence and explicit pending status when external workflow proof is missing |
| Evidence and promotion rules | [Release verifier](../scripts/verify-release.mjs), [evidence schema](../validation/runtime-evidence.schema.json), [promotion tests](../test/acceptance/promotion-recovery.test.ts) | Exact source/build bytes, mandatory feature/route/recovery gates, independent review, compatible rollback and failure on missing evidence |

The [foundation matrix](../test/acceptance/r1-foundation.test.ts) runs 20 R1 operations across seven authority lanes: ungranted human, valid human, expired session, valid native, revoked native, wrong workspace and conflicting credentials. Each cell checks HTTP semantics, canonical DTO/identity and persistent effects. The [isolation suite](../test/acceptance/r1-isolation.test.ts) checks the unavailable later-round routes and current schema/epoch boundaries. Test provider and transport fault adapters are explicitly synthetic; their results are local runtime evidence.

## Reproduce the local candidate gates

Use the exact runtime and locked dependencies described in the [toolchain runbook](runbooks/toolchain.md):

```sh
npm ci
npm run build:ui
npm run check
npm run check:runtime
npm run test:ui
python -B scripts/validate_docs.py
```

`npm run check` includes generated contract consistency, five TypeScript projects, contract checks, Node tests, application Workers tests, the separate operator Worker tests, deployment-observer tests and the recovery CLI tests. The browser gate remains separate and requires the bundled browser and host libraries. Runtime boot checks real Worker startup, the JSON liveness contract, schema 7 and closed uninstalled authority. Successful checks establish their recorded local scope; they do not silently run deployment or publication.

The CLI smoke exercises the complete recovery sequence against local HTTPS and separate real Worker/SQLite/R2 fixtures. Additional child-process tests terminate immediately after acknowledged response persistence or immutable file publication, then restart with the same protected inputs. These checks cover local process death and uncertain transport; they do not prove an external deployment or machine power-loss behavior.

## Acceptance still required before Verified

| Gate | Required observation |
| --- | --- |
| Exact candidate identity | Reviewed immutable source inventory and actual built artifact bytes; the deployed version must match |
| Dependency/toolchain review | Complete locked and embedded dependency inventory for the pinned Node/npm/SDK toolchain, with blocking advisories resolved |
| Deployed identity journey | Actual isolated provider login and signature/issuer/audience rejection, including allowed and forbidden human grants |
| Public ingress and revocation | Exact-host HTTP checks, alternate-host denial/exposure review, CSRF/origin checks and a current installation acknowledgement followed by revoked-token denial |
| Deployed recovery | Authenticated operator denial, interrupted continuation and complete capture → restore → resolution → probe → retirement → resume on disposable isolated authorities |
| Final release evidence | The single [release verifier](runtime-evidence.md) accepts all required actual evidence for the reviewed revision/build/environment; missing or failed gates keep R1 unpromoted |

No deployed acceptance receipt is established by this document. External workflows remain pending until an explicitly authorized target and protected inputs are available and actual receipts are reviewed. The 2026-10-26 clean install reported zero installed-tree audit findings; this does not clear the distinct embedded/toolchain inventory gate. The package manifest includes Undici/Zod overrides, while bundled distributions require separate inspection under #11. A passing local suite or installed-tree audit does not clear that gate. The first real rehearsal must use a separately authorized disposable source and target, with the current ledger and signing/encryption material held outside captured SQL and the checkout.

No feature is promoted to Verified or Released from this document. R2–R4 features remain unavailable. In particular, R1 has no task engine, runtime enrollment/claims, artifact API, team administration, MCP or A2A implementation, and its recovery binding does not establish artifact-byte recovery.

## Resume and publication boundary

The execution checkpoint retains the base revision, source/patch hashes, scoped review findings and actual command receipts. Continue from those identities rather than repeating completed tasks or replacing evidence. A failed scenario resumes with the same durable operation/job identity. Commit, push, tag, deployment and publication remain separate actions under the repository's authorized workflow; this candidate has not been promoted merely by passing local tests.
