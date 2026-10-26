# Execution policy and catalog contract progress

Status: Partial contract implementation; catalog, semantic integration and acceptance pending. No released capability is claimed.

The [original issue #20 plan](issue-020.md) is retained byte-for-byte. The [owner development amendment](owner-development-amendment-2026-10-26.md) supersedes its historical #17 development-start restriction. This change begins from PR #94, not from a sibling plan branch's stale source. The eventual stacked draft PR targets `docs/r2-019-plan`; it must preserve the existing `docs/r2-020-plan` history without force-pushing. No merge or deployment is authorized.

## First bounded contract slice

[Execution policy schema](../../spec/execution-policy.schema.json) defines the closed policy shape and numeric bounds. [Contract tests](../../test/contracts/r2-policy-catalog.test.ts) validate independent accepted/rejected boundaries against that schema. The test values are fixtures, not selected production defaults. The first run collected 48 tests and failed because the schema was absent; the same focused command passed 48 after adding it. Typechecking passed on pinned Node/npm. These are local contract tests, not a functioning policy engine or deployed evidence.

Schema validity does not prove exact-tuple conflict detection, current agent eligibility, evidence applicability, or precedence of unknown outcomes. Those semantic checks and their integration are not implemented by this slice. Catalog preview/apply, scope declarations, credential-epoch and history amendments, generated integration and the remaining #20 review are still pending. No working API endpoint or complete #20 acceptance is claimed.

The owner subsequently delegated technical option selection after evidence-based research, comparison and experiments. Earlier documents that call those technical choices owner-pending are historical; decisions must still be recorded and reviewed before their consumers are implemented. This delegation does not expand merge, deployment, credential or release authority.
