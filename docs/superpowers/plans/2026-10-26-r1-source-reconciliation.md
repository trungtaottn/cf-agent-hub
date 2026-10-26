# R1 source reconciliation amendment — 2026-10-26

Status: Documentation amendment · R1 Implemented; isolated acceptance and release pending.

## Scope and authority

This additive amendment supersedes the stale assumptions named below in the historical [R1 plan](2026-10-23-r1-foundation.md), [R2 plan](2026-10-23-r2-durable-work.md), and [plan index](README.md). Those files and their original review receipts remain byte-for-byte historical records. It does not approve new product behavior, close issues, authorize deployment, or change any acceptance/release gate.

The observed published baseline is [`fcbe6139c65f9baafee9804a5c50867a1fcc0968`](https://github.com/trungtaottn/cf-agent-hub/commit/fcbe6139c65f9baafee9804a5c50867a1fcc0968) on `dev`. Publication is distinct from deployed provenance; subsequent diffs need their own immutable source/build identity and review. See [current implementation and gates](../../r1-implementation.md) and [feature matrix](../../feature-matrix.md).

## Superseded assumptions

1. **Product status:** historical “all capabilities Specified” and “implementation pending” statements describe the planning baseline. Current source has 14 R1 capabilities Implemented; 28 later-round capabilities remain Specified. None are Verified or Released. Browser settings source exists in [settings.ts](../../../src/ui/settings.ts); local fixtures do not establish deployed behavior.
2. **Migration allocation:** the [registered R1 migrations](../../../src/storage/migrations.ts) already occupy versions 1–7, including session epoch, preference owner, message admission, cursor retention, scheduler diagnostics and maintenance generation. R2's proposed `0002-durable-work.sql` after foundation is obsolete. If the accepted base remains schema 7, allocate the first R2 migration as version **8** (for example `0008-durable-work.sql`). Re-read the accepted base and allocate the next unused monotonic version if it advances. Never replace, renumber or replay an applied R1 migration; preserve transaction/version bookkeeping, frozen-admission guards and recovery compatibility checks.
3. **Deployment observer CLI:** R1 Task 11's `--base-url` / `--evidence` observer example and environment-credential assumption are obsolete. The actual [parser](../../../scripts/verify-r1-deployment.mjs) accepts `--config-fd N --output PATH`; the [runbook](../../runbooks/r1-deployment-verification.md) owns the closed configuration and protected descriptor format. This correction does not change the separate release verifier's arguments.

## Current observer invocation

Only after the owner authorizes an isolated target and prepares protected inputs outside the checkout:

```sh
umask 077
node scripts/verify-r1-deployment.mjs \
  --config-fd 3 --output isolated-observations.json \
  3<protected/deployment.json \
  4<protected/allowed-session \
  5<protected/forbidden-session \
  6<protected/native-bearer
```

Each descriptor must be an already-open owner-only regular file (0600 or stricter, current owner, one hard link); the configuration maps the credential descriptors. Inputs contain no credentials in arguments or environment variables. Keep protected files outside source control and captured logs. Output is exclusive and never overwritten. No command here authorizes execution against an unapproved target.

For a no-network missing-input receipt, choose a fresh output path:

```sh
node scripts/verify-r1-deployment.mjs --output blocked-observations.json
```

Exit 2 means pending, not pass. HTTP subset observations cannot attest the real OIDC provider journey, acknowledged next-request revocation, actual operator recovery or deployed bytes. Those external workflow gates remain pending for independent verification, even when supplied receipt bytes match their hashes. The observer never emits an overall release pass. Keep the existing isolated deployment, recovery, toolchain, provenance and final release-verifier gates unchanged.

## Historical digest chain and review boundary

The preserved base hashes below identify the exact historical artifacts; they are not approval of this amendment. The new amendment must receive a separately recorded independent documentation review tied to its own SHA-256. No existing approval receipt is rewritten to appear to approve new text.

| Preserved artifact | SHA-256 |
| --- | --- |
| R1 plan | `beec9d0ca34e10297774754a1f75d1310b3b5728ff1f16efcae9a36c9d30724e` |
| R2 plan | `7bd7520370bf058ca4e69218210666bce4544d468cb2312f7f813bc320cc6c1b` |
| Historical review | `6b48f8e8a5b9455a142bdbeb435a72bb91cc9be4fd0f24dc247c1ded7e896e86` |
| Plan register | `8673e2bcf66db60c6b7b66da3aed14a804ee6e7852c30f5144dbacec41d0d2f0` |
| Prior R1 recovery amendment review | `9c52ca7c7d8fc9e134504317c2869dbca9b2c4a993579b99bc60c24e8a18516c` |
| Plan index | `ade7c4fb7a3a0042c4eb36af62b0745767fd316bc991242388d62394ca13a2ed` |

The [machine-readable plan register](../../../validation/implementation-plan-register.json) and its historical review chain retain their original scope and pending planning status. Existing documentation/plan validators check structure, links and the registered historical identities; they do **not** certify this amendment's independent review, product tests, installed/embedded dependency security, deployment, recovery or release.
