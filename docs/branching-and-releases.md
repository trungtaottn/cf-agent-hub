# Branching, beta and stable promotion

Status: R1/R2 source integrated on dev as of 2026-10-31; acceptance pending; no released beta/stable artifact or deployment is asserted. Dev source protection is active as recorded below; main remains separately scoped.

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

After explicit owner approval, the dev ruleset `25820686` was updated through GitHub administration on 2026-10-31. Fresh API readback confirms active scope `refs/heads/dev`, strict up-to-date checks, and exactly `branch-policy`, `source`, `dependencies`, `native-source`, `local-sandbox`, `native-build` and `native-service`, each bound to GitHub Actions integration `15368`. `do_not_enforce_on_create=false` is retained. The other rules, branch conditions and empty bypass array were unchanged: PRs and resolved conversations required, deletion/non-fast-forward blocked, zero mandatory approvals. Source merge still does not establish live acceptance.

Main ruleset `25820767` was not changed: it remains active for `refs/heads/main`, requiring only `branch-policy` with strict checks disabled. Its complete-check applicability and a separately authorized administration change remain future promotion work; older main/hotfix candidates may lack the newer jobs. Never add conditional manual evidence as an unconditional source merge requirement.

The earlier same-day readback required only branch-policy on dev as well; the applied amendment above supersedes that observed enforcement gap. The JSON examples in `docs/github-rulesets/` are historical proposals, not authoritative readback. Further administrative changes require explicit action-time authorization and verified readback through an authorized administration interface; Cloud Harness repository write access is not Administration permission. Never elevate its credentials, route around a denied operation, add a bypass or disable a gate to obtain a merge.
