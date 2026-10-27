# Issue 27 stacked draft reconciliation

Status: Source-equivalent draft preparation; remote checks and live acceptance pending. No released capability.

## Exact ancestry and scope

Immutable local #27 is `3bc7bba3d05672f8895f0796677334a819bcec51`, tree `efa0be61ae78f278c3136744b71da9443f0a5085`, on synthetic #26 `393ad95e2fe1756ae96ff741eec4765bab8f5260`. Its [execution ledger](issue-027-execution.md), research and failed/passed receipts remain historical and unchanged.

The publication tree uses actual predecessor #26 draft [PR101](https://github.com/trungtaottn/cf-agent-hub/pull/101), head `d3ef7903ae2bec28c266126a6b6a37d0696023d6`, tree `bbfc09cbb3b842becb8563ca07efa89d53c09f23`. This is the first parent. The fresh original `docs/r2-027-plan` head `cdd887778cc51615e4387a552394cf5af1b05d14` is preserved as second parent. Its corrected plan blob `a779f1ed981c2960e4fbe8626cde34dddd0a23ae` already matches the immutable implementation. A fresh expected ref and non-force update are required immediately before publication. Draft base is `docs/r2-026-plan`, not dev or main.

Only #27 task metadata/query operations and its reviewed bounded-authority prerequisite are implemented. Claim, lease, submission, review, approval, cancellation and requeue remain successor-owned. No migration, package/dependency change or new control plane is introduced. Existing authorization, result-admission and successor scheduler obligations in the execution ledger remain binding.

## Equivalence and environment

All product, test, schema, generated and lock bytes are preserved exactly from reviewed local #27. Differences from that snapshot are only inherited AGENTS research guidance, predecessor corrected plans/stack receipts, and this reconciliation note. The issue-only patch applies without source conflict to actual #26. This publication preparation introduces no unfamiliar implementation needing another design choice.

The independent clone uses no hardlinks, no remote, independently copied locked dependencies, Node 24.22.1 and task-local npm 11.19.1, isolated XDG and workspace-local temporary storage. Neither immutable source nor predecessor is changed. Verified GitHub commit objects retain genuine remote ancestry; absent historical objects are not fabricated.

## Evidence and publication boundaries

Historical implementation evidence: 813 Node, 649 Workers, 18 operator and 13 deployment-verifier tests passed; generated/types/UI/runtime/docs/plans passed. The aggregate exited 1 at the protected-output recovery CLI guard, with 8 passed and 18 failed; no bypass and no green aggregate claim. Current schema 8 operational recovery awaits #39/#43. These exact-source results may be reused but are not called freshly rerun.

Preparation refreshes focused task/authority Workers checks, types, generated consistency, docs/plans and independent source-equivalence review. The draft body and external publication manifest record actual fresh results. Remote CI and review are exact-head gates after publication; source-level checks are not post-R4 live acceptance. No screenshots are relevant to these non-UI domain/query changes.

The owner explicitly authorizes public reviewed code and technical/security design documents for remaining R2 tasks #26–50 through draft PRs, excluding secrets/private data and merge/deploy authority. Publication still waits for predecessor terminal CI, controller baton and mandatory tool approvals. A pending or denied operation must not be bypassed. No optional external comments, live credentials, provisioning, deployment, Cloud Harness, merge or release are performed. Live acceptance remains deferred until after R4.
