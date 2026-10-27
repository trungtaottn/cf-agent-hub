# Issue 24 stacked publication reconciliation

Status: Reviewed source prepared for a draft stacked PR; new-head CI and live acceptance pending. No released capability is claimed.

## Immutable sources and ancestry

The reviewed local implementation is `982bbe61c9a88e35490134de229b589bd566ffb7`, tree `2e5bd2f6e4bb05282596e210ce5ec3aeaa6d2276`, originally based on synthetic local #23 `3ea0fbf9a2d541919b611ac1e299b069e0bbb2c2`. Its [execution receipt](issue-024-execution.md), schema manifest, migration and test coverage accounting are retained unchanged.

The actual predecessor is draft [PR #98](https://github.com/trungtaottn/cf-agent-hub/pull/98), head `0144240101ee81ecaf8453efff1fec673b839b6e`, tree `0af8fe9a920c9d52f8bb34b2cddfb32f8d206bd2`. Run `40467293374` succeeded for source and dependencies; release evidence was skipped. The synthetic merge `fdec3707c1b92f9cb5b65063780f94c332c5c825` has the same tree. PR #98 remains draft and unmerged. Its pending process-only PR-body correction does not alter those verified source bytes; the unsuccessful metadata update is not claimed completed or retried here.

Preserve existing #24 planning head `aa2bc102700cfd3216d24991b24766a693015568`, tree `b2ebf67321487ad4ce75f497a55d1733bd95e8c5`, as the second parent, with actual #23 as first parent. The original #24 plan blob `59f74befdd2162059d9956e12589e18368b1412b` is unchanged. Publication uses existing `docs/r2-024-plan`, expected-old-ref protection and no force, with draft PR base `docs/r2-023-plan`.

## Equivalence and boundaries

No product source, generated output, migrations, schemas, tests, runtime configuration, package or lock bytes differ from reviewed local #24. Only the inherited owner research instruction in `AGENTS.md`, predecessor stack receipts, preservation of the original #22 plan newline and this new receipt differ. Prior implementation research and rejected deferred-FK experiment remain in the historical execution receipt; no unfamiliar feature is implemented during reconciliation.

The isolated checkout is a `--no-hardlinks` clone of the complete local #24 source with independently copied dependencies and hash-verified remote Git objects. No original checkout is modified. Node 24.22.1 and task-local npm 11.19.1 remain pinned, with own XDG/temp paths and telemetry disabled.

Schema8 is a storage boundary, not activated task/runtime/artifact commands. Original migrations1–7 remain byte-identical. V1/schema7 recovery remains a frozen historical codec/test lane; current schema8 operational recovery is explicitly unavailable until downstream implementation. The prior CLI smoke transport assertions were not locally verified because the outside-checkout protection rejected fixture inputs. No safety guard, historical receipt, skipped acceptance or failed check is erased.

## Verification and review

Focused migration/bootstrap/registry, generated freshness, TypeScript, documentation and historical plan checks are rerun on the reconciled bytes; results and independent equivalence review are recorded in the publication manifest. The original aggregate local run failed (8 CLI passes / 18 failures) and is not relabeled green by this source reconciliation. Exact new-head CI must establish the remote source gate.

No merge, auto-merge, deployment, credential/provisioning operation, security-setting change, Cloud Harness action or release is authorized. Live acceptance stays deferred until the owner's post-R4 stage and is not passed. Downstream commands consume the one reviewed schema; corrections after integration require forward migration allocation, not rewriting migration8.

Focused reconciliation results: generated freshness and all TypeScript projects passed; the exact migration/bootstrap/frozen-registry suite passed 49 Workers tests across 3 files. Documentation and historical plan checks passed. Independent exhaustive equivalence review reported 0 Critical / 0 Important / 0 Minor findings, with precisely the six permitted inherited-document/receipt differences and no product drift. The final commit parent order and remote tree are verified separately before the non-force ref update.
