# Private recovery anchor provider

Status: Local source implementation; deployed provider and live recovery acceptance pending.

This source-only component owns authority observations outside restored WorkspaceDO storage. It has its own SQLite DO namespace and private schema version1. No production provider, credentials, writer bindings or namespace has been provisioned by this change. Empty checked-in policies deliberately deny all identities.

## Capabilities

- Default service binding: only `POST /current` with the exact workspace/environment/object identity. No mutation RPC method exists on this entrypoint. A missing record returns503 and never bootstraps authority.
- `RecoveryAnchorBootstrap.create`: separately granted deployment capability; explicit create-if-absent with `expected:null` sets generation1. Existing state cannot be overwritten or reset.
- `RecoveryAnchorWriter.publish`: separately granted deployment capability; exact prior epoch/hash/generation comparison and strictly higher next epoch. A higher epoch may retain the same ledger hash; it is an explicit authority epoch change, not a no-op.

The selected named entrypoint is a role capability. It does **not** establish individual-human audit identity, and Access identity does not automatically propagate. Caller JSON cannot choose a role. Only the provider Worker receives its `ANCHORS` namespace binding. The product Worker receives only the default read binding. The ordinary operator gateway receives no provider binding. Neither consumer receives the namespace, writer or bootstrap bindings. Do not expose public routes, workers.dev or preview URLs.

Closed deployment `ANCHOR_POLICY` contains `environment_id`, `identities:[{workspace_id,object_name}]` and `writers:{rotation:[same],bootstrap:[same]}`. Writer lists must be subsets of identities; duplicates, unknown keys and wrong environments deny. Each policy is bounded to128 identities and64KiB; each identity maps to a distinct DO. Namespace identity and capability mappings remain deployment-owned configuration, not request data.

Publications have exact identity, `operation_id`, `expected` prior tuple or null, and `next:{authority_epoch,ledger_sha256}`. A single synchronous transaction binds the DO to one immutable identity, checks exact replay/CAS, checks capacity, updates the tuple and retains an immutable receipt. No awaits or external effects occur inside that transaction. Exactly repeated operations return the original historical receipt even after subsequent rotations. This is not a fresh-current observation; use `/current` for that. Conflicting operation reuse denies.

Each record contains the complete canonical publication and receipt, at most2048bytes. Each identity retains at most1024 records and2MiB total. At capacity exact replay and reads remain possible, but new authority events fail closed. There is no pruning, reset, import or delete API; expansion/archival requires a separately reviewed maintenance change.

## Operational limits

Fresh reads depend on continuity of the deployment-owned namespace. SQLite generation is **not** a global external anti-rollback floor and cannot detect malicious infrastructure rollback, restored/PITR namespace state or namespace replacement on a fresh admission. Re-anchoring requires separately authorized stopped ingress, preserved uncertainty evidence, reconciled independent ledger/rotation records and reviewed non-reused binding identity. Never silently resume old pending jobs across replacement.

`OPERATOR_POLICY` is an expected-anchor allowlist, not observed freshness. Rotation and policy updates must be coordinated; mismatch fails closed. A read does not lock the provider across an external object PUT. Existing recovery pre/post checks and unknown-effect holds remain necessary; exact object bytes do not prove an uncertain PUT completed.

## Local evidence

The focused store suite uses real Node SQLite with a synchronous storage adapter; it checks SQL/CAS/policy/capacity semantics but is not a service-binding or workerd deployment proof. The dedicated current-provider integration runner owns genuine local Worker/SQLite DO/service-binding evidence separately. Neither constitutes live production acceptance (deferred until afterR4).

Run focused checks from repository root:

```
npx vitest run --config workers/recovery-anchor/vitest.store.config.ts
npx tsc -p workers/recovery-anchor/tsconfig.json
```
