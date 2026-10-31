# Branching, beta and stable promotion

Status: R1/R2 source integrated on dev as of 2026-10-31; acceptance pending; no released beta/stable artifact or deployment is asserted. Active protection and intended policy differ as recorded below.

## Canonical branches

| Branch | Purpose | Permitted inbound path | Release channel |
| --- | --- | --- | --- |
| `dev` | Integration after completed, reviewed changes | PRs from work branches (including hotfix backports) | Beta candidates only |
| `main` | Stable branch | PR from same-repo `dev` or `hotfix/*` only | Stable candidates only |
| `feature/*`, `fix/*`, `chore/*`, `docs/*` | Bounded work | PR to `dev` | Never publish |
| `hotfix/*` | Emergency stable correction, branch off current `main` | PR to `main`, followed by a separate sync PR to `dev` | Hotfix stable only after acceptance |

Keep `main` as the GitHub default branch. `dev` contains the reviewed R1/R2 source, including the ordered R2 PR #94–123 integration. `main` was not changed by that operation; see the [exact integration record](r2-source-integration-2026-10-31.md). Do **not** fast-forward unfinished R1 or other rounds directly into `dev` and do not treat a Draft PR as releasable.

## Required review and CI

1. No direct push, force push, deletion or bypass to `dev` or `main`. Use GitHub branch Rulesets with the PR requirement and no bypass actors.
2. The reviewed dev target is strict up-to-date checks requiring `branch-policy`, `source`, `dependencies`, `native-source`, `local-sandbox`, `native-build` and `native-service`. These are actual unconditional PR jobs. Do not require conditional manual `release-evidence` or a nonexistent job. Apply equivalent main requirements only after confirming its promotion/hotfix candidates carry the relevant workflows; this needs separately scoped administrative approval. `branch-policy` checks that a PR targeting `main` originates **inside this repository** from `dev` or `hotfix/*`. It also checks all PRs targeting `dev`.
3. Keep full security auditing: the R1 `dependencies` job runs `npm audit --audit-level=low`; do not downgrade, suppress the job or hide findings to obtain a green check. The `source` job includes Worker, CLI, document, and browser gates; GitHub checks must be read at the exact PR head SHA.
4. Require conversation resolution and up-to-date checks; no `allow force push`, no emergency admin bypass. The provided Ruleset definitions use **zero mandatory approvals** because a sole maintainer cannot approve their own PR; a second reviewer permits tightening this to one or more approvals.
5. Changes to workflow, policy code or Ruleset definitions deserve owner review. The `pull_request` workflow executes untrusted PR code with a read-only GitHub token and without secrets. It does not by itself prevent a PR author from altering the gate; repository Rulesets, required checks and review are the actual protection boundaries.
6. The branch-policy check alone does not validate the application or release evidence. R1's remaining embedded-toolchain and evidence obligations remain tracked in [R1-TOOLCHAIN #11](https://github.com/trungtaottn/cf-agent-hub/issues/11).

## Promotion process

1. Work on an isolated `feature/*`, `fix/*`, `chore/*` or `hotfix/*` branch; link the owning issue/plan. Open PR to `dev`, resolve review and all required status checks, merge through GitHub PR. Completed source merges do not close the separate live acceptance issues.
2. For a **beta**, build and verify an exact commit already merged into `dev`; record the release evidence, review, toolchain, security inventory, runtime readiness and rollback path. Only then create an annotated prerelease tag `vX.Y.Z-beta.N` pointing to that accepted `dev` commit and publish an explicitly marked *prerelease* GitHub Release if desired. No beta is currently authorized.
3. For **stable**, open `dev → main` PR after full acceptance with exact evidence; all required status checks must pass. Merge through PR only, then tag the accepted `main` commit `vX.Y.Z` and publish stable release. A branch merge is **not** itself a production deployment.
4. For a **hotfix**, branch `hotfix/<issue>` from current `main`, fix and validate the minimum change, open PR to `main`, pass all required checks, merge and create an appropriate patch stable tag. Then open a separate PR into `dev` to carry the fix forward; never silently overwrite or force-update either branch.
5. If an incident, failed CI, missing source authorization or incomplete release evidence exists, keep the candidate as PR/Draft and block release. Deployment credentials, environments, approval steps and promotion verification are separate from this repository policy.

## Active enforcement readback — 2026-10-31

Rulesets `25820686` (dev) and `25820767` (main) are active and scoped to their named branches. Both require PRs and resolved conversations, block deletion/non-fast-forward updates, have zero mandatory approvals and no bypass actors. Both currently require **only `branch-policy`** (GitHub Actions integration `15368`); `strict_required_status_checks_policy` is false. This does not enforce the intended complete CI/up-to-date policy above. Final R2 integration independently checked the exact source head's successful CI; that is not proof that every future merge is server-enforced.

An authorized admin must reconcile the existing rules, not create duplicates or remove protections. The proposed dev amendment changes only the required-status-check parameters to the seven actual contexts above and strict=true; preserve `do_not_enforce_on_create=false` and every other rule. Main requires a separate applicability check to avoid blocking older workflow/hotfix candidates. Do not add conditional manual evidence as an unconditional merge requirement.

The JSON examples in `docs/github-rulesets/` are historical proposals, not authoritative readback. Administrative changes require explicit action-time authorization through the authorized administration integration; Cloud Harness repository write access is not Administration permission. Do not elevate its credentials or route around a denied operation. After an authorized update, read back the exact rule ID, branch condition, enforcement and contexts. Until then, report this enforcement gap honestly; never disable a gate to obtain a merge.
